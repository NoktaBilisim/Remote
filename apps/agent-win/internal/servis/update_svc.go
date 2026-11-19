package servis

import (
	"context"
	"errors"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"sync"
	"time"

	"remote-support/agent-win/internal/update"
)

// Servis güncelleyicisi (mimari-p29 §5.3 sol sütun, §14.3; AC-475, 477, 479, 480, 481, 487, 489, 493). Akış:
// update.offer → Verify (maxSeen kalıcı) → Decide → olaylar kuyruğa (durum.json) → policy=auto ise 0–120 dk rastgele gecikme
// → update.token.request → update.token → yeni.bin (CREATE_NEW, paylaşımsız) + Download (Bearer, yazarken SHA) → platform
// imzası → phase=staged + apply.nonce → oturum yok anında update.state{installing} + 2 sn → gözetmen (`--update-apply`).
// Servis gözetmeni başlattıktan sonra çıkmaz; SERVICE_STOPPED'a yalnız gözetmenin Control(Stop)'u ile geçer (T-4).

// UpdateSys servis güncellemesinin platform işleri (Windows: update_windows.go; testte sahte).
type UpdateSys interface {
	// PrepareDir `Guncelleme\`'yi doğrular (VerifyDir, T-6) ya da güvenli oluşturur; recreated: güvensizdi, yeniden oluşturuldu.
	PrepareDir() (recreated bool, err error)
	// CreateStaged önceki artığı siler ve yeni.bin'i CREATE_NEW + paylaşımsız açar (TOCTOU, §5.1).
	CreateStaged() (StagedFile, error)
	// RemoveStaged yeni.bin ve apply.nonce'u siler.
	RemoveStaged()
	// WriteNonce `Guncelleme\apply.nonce` (T-4).
	WriteNonce(nonce string) error
	// PlatformSignature K-P29-13: çalışan ikili Authenticode imzalıysa yeni.bin aynı yayıncıyla geçerli imzalı olmalı.
	PlatformSignature() error
	// SupervisorAlive Global\NoktaDestekServisUpdate var mı (gözetmen ya da kurtarma çalışıyor).
	SupervisorAlive() bool
	// LaunchSupervisor kurulu ikiliyi `--update-apply` ile job dışı SYSTEM alt süreci olarak başlatır; wait süreç bitince döner.
	LaunchSupervisor() (wait func(), err error)
	// RestoreFailureActions SCM kurtarma eylemlerini yedekten geri yükler; yedek nil ise ve kayıtlı komut bizim kurtarma
	// komutumuzsa kurulum varsayılanına döner (R2-1).
	RestoreFailureActions(b *RecoveryBackup) error
	// Cleanup exe.eski, exe.bozuk, exe.yeni artıklarını siler (kullanımdaysa hata; sonraki dönemde yeniden denenir).
	Cleanup() error
	// SetDisplayVersion Uninstall `DisplayVersion` öz-onarımı (AC-481).
	SetDisplayVersion(v string)
}

// StagedFile indirme hedefi: Commit = FlushFileBuffers + kapat; Abort = kapat + sil.
type StagedFile interface {
	io.Writer
	Commit() error
	Abort()
}

// updateLink cihaz kanalı (DeviceClient).
type updateLink interface {
	UpdateGate() bool
	SendWait(msg any, d time.Duration) error
}

// updateSession kurulum kapısı (Core).
type updateSession interface {
	UpdateBegin() bool
	UpdateCommit() bool
	UpdateEnd()
}

type updTiming struct {
	tokenDelayMax, commitWait, poll, tokenWait, healthWait, retryMin, sendWait time.Duration
}

func (t updTiming) withDefaults() updTiming {
	def := func(v *time.Duration, d time.Duration) {
		if *v == 0 {
			*v = d
		}
	}
	def(&t.tokenDelayMax, 120*time.Minute) // §4.3, §8: indirme sapması
	def(&t.commitWait, 2*time.Second)      // K-P29-12
	def(&t.poll, 15*time.Second)
	def(&t.tokenWait, 2*time.Minute)
	def(&t.healthWait, 90*time.Second) // gözetmen 60 sn + durdurma/başlatma payı
	def(&t.retryMin, 5*time.Minute)    // §4.4: 503 + Retry-After 300
	def(&t.sendWait, 10*time.Second)
	return t
}

// İstemci tarafı hız sınırları (sunucu fazlasını sessizce atar; §4.3): olay 10/sa, belirteç 4/sa, denetim 4/sa.
const (
	eventsPerHour  = 10
	tokensPerHour  = 4
	checksPerHour  = 4
	maxTokenRetry  = 3
	updatePlatform = update.PlatformWindows
	updateArch     = "amd64"
)

// Updater servis güncelleyicisi.
type Updater struct {
	Trust     update.Trust
	Running   update.Version
	HTTP      *http.Client
	Origin    *url.URL
	UserAgent string
	Store     *StateStore
	Sys       UpdateSys
	Events    EventSink
	Link      updateLink
	Session   updateSession

	now   func() time.Time
	rnd   func() float64
	sleep func(ctx context.Context, d time.Duration) bool
	tm    updTiming

	ctx      context.Context
	wg       sync.WaitGroup // arka plan işleri (Wait: test/kapanış)
	off      bool
	mu       sync.Mutex
	pending  *pendingInstall
	applying bool
	kick     chan struct{}
	evLim    rateWindow
	tokLim   rateWindow
	chkLim   rateWindow
}

type pendingInstall struct {
	m        update.Manifest
	gotToken bool
	retries  int
}

// rateWindow kayan bir saatlik pencere.
type rateWindow struct {
	at []time.Time
}

func (r *rateWindow) allow(now time.Time, max int) bool {
	keep := r.at[:0]
	for _, t := range r.at {
		if now.Sub(t) < time.Hour {
			keep = append(keep, t)
		}
	}
	r.at = keep
	if len(r.at) >= max {
		return false
	}
	r.at = append(r.at, now)
	return true
}

func (u *Updater) clock() time.Time {
	if u.now != nil {
		return u.now()
	}
	return time.Now()
}

func (u *Updater) wait(d time.Duration) bool {
	if u.sleep != nil {
		return u.sleep(u.ctx, d)
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-u.ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func (u *Updater) random() float64 {
	if u.rnd != nil {
		return u.rnd()
	}
	return rand.Float64() //nolint:gosec // zamanlama sapması, güvenlik amaçlı değil
}

func (u *Updater) running() update.Running {
	return update.Running{Platform: updatePlatform, Arch: updateArch, Component: update.ComponentService, Version: u.Running}
}

func (u *Updater) kickLoop() {
	select {
	case u.kick <- struct{}{}:
	default:
	}
}

// Startup servis açılışında (WS'den önce) çağrılır: klasör, DisplayVersion öz-onarımı ve faz uzlaştırması (§5.3
// "Gözetmensiz durumlar", R2-1: önce FailureActions geri yükle, sonra artıkları sil).
func (u *Updater) Startup(ctx context.Context) {
	u.ctx = ctx
	u.tm = u.tm.withDefaults()
	u.kick = make(chan struct{}, 1)
	recreated, err := u.Sys.PrepareDir()
	if recreated {
		u.Events.Write(evUpdateFolder())
	}
	if err != nil {
		u.off = true // klasör hazırlanamıyor: güncelleme kapalı (servis çalışmaya devam eder)
		return
	}
	u.Sys.SetDisplayVersion(u.Running.String())
	alive := u.Sys.SupervisorAlive()
	now := u.clock()
	var plan startupPlan
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		plan = planStartup(*s, u.Running, alive)
		if !plan.write {
			return false
		}
		applyPlan(s, plan, now)
		return true
	})
	if plan.removeStaged {
		u.Sys.RemoveStaged()
	}
	if plan.rolledBack != "" {
		u.Events.Write(evUpdateRolledBack(plan.rolledBack, update.ReasonInstall))
	}
	if plan.finalize {
		u.finalize()
	}
	if plan.awaitSupervisor {
		u.wg.Go(u.finishAfterHealthy)
	}
}

// startupPlan açılış uzlaştırması (saf; tablo testi).
type startupPlan struct {
	write, removeStaged, finalize, awaitSupervisor bool
	newPhase                                       string
	rolledBack                                     string // rolled_back(INSTALL) hedef sürümü
}

// planStartup durum + çalışan sürüm + gözetmen canlılığı → yapılacaklar. Toplamdır: her faz için tanımlıdır.
func planStartup(s UpdateState, running update.Version, supervisorAlive bool) startupPlan {
	self := running.String()
	if supervisorAlive {
		// Gözetmen (ya da kurtarma) işi yürütüyor; healthy yazımı Ready kancasındadır.
		return startupPlan{awaitSupervisor: s.Phase == phaseHealthy && s.Target == self}
	}
	switch s.Phase {
	case phaseStaged:
		return startupPlan{write: true, newPhase: "", removeStaged: true, finalize: true}
	case phaseSwapping, phaseSwapped:
		switch self {
		case s.Target:
			return startupPlan{} // yeni servis: device.ready sonrası healthy (Ready kancası) ve kendisi tamamlar
		case s.Prev:
			return startupPlan{write: true, newPhase: phaseRolledBack, rolledBack: s.Target, removeStaged: true,
				finalize: true}
		}
		return startupPlan{write: true, newPhase: "", removeStaged: true, finalize: true} // elle başka sürüm kuruldu
	case phaseHealthy:
		if self == s.Target {
			return startupPlan{write: true, newPhase: phaseDone, removeStaged: true, finalize: true}
		}
		return startupPlan{write: true, newPhase: "", removeStaged: true, finalize: true}
	}
	return startupPlan{finalize: true} // "", done, rolled_back
}

func applyPlan(s *UpdateState, p startupPlan, now time.Time) {
	target, prev := s.Target, s.Prev
	s.clearPhase(p.newPhase)
	if p.rolledBack != "" {
		s.block(target, now)
		s.addEvents(update.NewEvent(update.EventRolledBack, target, prev, update.ReasonInstall, now))
	}
}

// Run periyodik işler: 24 sa ± 2 sa update.check + artık temizliği, kuyruk gönderimi, bekleyen kurulum denemesi.
func (u *Updater) Run(ctx context.Context) {
	if u.off {
		return
	}
	first := true
	go update.RunChecks(ctx, nil, u.rnd, func(context.Context) {
		if first { // açılış denetimi sunucunun device.ready sonrası update.offer'ıdır
			first = false
			return
		}
		u.check()
	})
	t := time.NewTicker(u.tm.poll)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-u.kick:
		}
		u.flush()
		u.tryInstall()
	}
}

func (u *Updater) check() {
	u.finalize() // artık silme 24 sa'te bir yeniden denenir (§5.3)
	u.mu.Lock()
	ok := u.chkLim.allow(u.clock(), checksPerHour)
	u.mu.Unlock()
	if ok && u.Link.UpdateGate() {
		_ = u.Link.SendWait(&UpdateCheck{}, u.tm.sendWait)
	}
}

// Ready device.ready sonrası (her bağlantı): yeni servis swapped fazında kendi sürümü hedefse healthy yazar (§5.3).
func (u *Updater) Ready() {
	if u.off {
		return
	}
	u.wg.Go(u.markHealthy)
}

func (u *Updater) markHealthy() {
	self := u.Running.String()
	now := u.clock()
	var from string
	var s UpdateState
	var err error
	// Yazılamazsa gözetmen sağlıklı sürümü geri alır: pencere (60 sn) içinde yeniden denenir.
	for i := 0; i < 20; i++ {
		s, err = u.Store.Update(func(s *UpdateState) bool {
			if (s.Phase != phaseSwapped && s.Phase != phaseSwapping) || s.Target != self {
				return false
			}
			from = s.Prev
			s.Phase = phaseHealthy // nonce korunur: gözetmen healthy(nonce) bekler
			s.addEvents(update.NewEvent(update.EventInstalled, self, from, "", now))
			return true
		})
		if err == nil || !u.wait(2*time.Second) {
			break
		}
	}
	if err != nil || s.Phase != phaseHealthy || from == "" {
		return
	}
	u.Events.Write(evUpdateInstalled(from, self))
	u.kickLoop()
	u.finishAfterHealthy()
}

// finishAfterHealthy gözetmenin done yazmasını bekler; gözetmen yoksa tamamlamayı kendisi yapar, sonra artıkları siler.
func (u *Updater) finishAfterHealthy() {
	deadline := u.clock().Add(u.tm.healthWait)
	for u.clock().Before(deadline) {
		if !u.Sys.SupervisorAlive() {
			break
		}
		if !u.wait(time.Second) {
			return
		}
	}
	if u.Sys.SupervisorAlive() {
		return // gözetmen hâlâ çalışıyor: sonraki dönemde finalize
	}
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		if s.Phase != phaseHealthy || s.Target != u.Running.String() {
			return false
		}
		s.clearPhase(phaseDone)
		return true
	})
	u.Sys.RemoveStaged()
	u.finalize()
}

// finalize R2-1 sırası: gözetmen yokken ve faz boşta/done/rolled_back iken önce SCM FailureActions yedekten geri yüklenir,
// ancak başarılıysa exe.eski/exe.bozuk/exe.yeni silinir (silinmeyen eski ikiliye işaret eden kurtarma komutu kalmaz).
func (u *Updater) finalize() {
	s := u.Store.Load()
	switch s.Phase {
	case phaseStaged, phaseSwapping, phaseSwapped, phaseHealthy:
		return
	}
	if u.Sys.SupervisorAlive() {
		return
	}
	if err := u.Sys.RestoreFailureActions(s.Recovery); err != nil {
		return
	}
	if s.Recovery != nil {
		_, _ = u.Store.Update(func(s *UpdateState) bool {
			if s.Recovery == nil {
				return false
			}
			s.Recovery = nil
			return true
		})
	}
	_ = u.Sys.Cleanup()
}

// Offer `update.offer` (okuma döngüsünden; bloklamaz).
func (u *Updater) Offer(m *UpdateOffer) {
	if u.off {
		return
	}
	now := u.clock()
	s := u.Store.Load()
	maxSeen, _ := update.ParseVersion(s.MaxSeen)
	r := update.VerifyEncoded(u.Trust, m.Manifest, m.Signature, u.running(), maxSeen, now)
	if r.Outcome == update.OutcomeDisabled {
		u.kickLoop()
		return
	}
	v := r.Manifest.Version
	blocked := r.Outcome == update.OutcomeAccept && s.blocked(v, now)
	d := update.Decide(r, update.ParsePolicy(m.Policy), u.Running, now)
	var added []update.Event
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		if r.MaxSeen.Compare(maxSeen) > 0 {
			if cur, err := update.ParseVersion(s.MaxSeen); err != nil || r.MaxSeen.Compare(cur) > 0 {
				s.MaxSeen = r.MaxSeen.String()
			}
		}
		if !blocked {
			added = s.addEvents(d.Events...)
		}
		return true
	})
	u.logRejected(added)
	if !blocked && d.Action == update.ActionInstall {
		u.schedule(r.Manifest)
	}
	u.kickLoop()
}

// None `update.none`: kapı açıldı, kuyruk gönderilebilir.
func (u *Updater) None() {
	if !u.off {
		u.kickLoop()
	}
}

func (u *Updater) logRejected(evs []update.Event) {
	for _, e := range evs {
		if e.Type == update.EventFailed && e.Reason.Security() {
			u.Events.Write(evUpdateRejected(e.Version, e.Reason))
		}
	}
}

// schedule kabul edilen manifest için belirteç isteğini 0–120 dk rastgele gecikmeyle planlar (her offer'da yeniden
// başlatılmaz; bekleyen ya da sahnelenmiş kurulum varken yenisi açılmaz).
func (u *Updater) schedule(m update.Manifest) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.applying || u.pending != nil {
		return
	}
	switch u.Store.Load().Phase {
	case "", phaseDone, phaseRolledBack:
	default:
		return
	}
	p := &pendingInstall{m: m}
	u.pending = p
	delay := time.Duration(u.random() * float64(u.tm.tokenDelayMax))
	u.wg.Go(func() {
		if !u.wait(delay) {
			u.clearPending(p)
			return
		}
		u.requestToken(p)
	})
}

func (u *Updater) clearPending(p *pendingInstall) {
	u.mu.Lock()
	if u.pending == p {
		u.pending = nil
	}
	u.mu.Unlock()
}

func (u *Updater) requestToken(p *pendingInstall) {
	u.mu.Lock()
	ok := u.pending == p && u.tokLim.allow(u.clock(), tokensPerHour)
	u.mu.Unlock()
	if !ok || !u.Link.UpdateGate() ||
		u.Link.SendWait(&UpdateTokenRequest{Version: p.m.Version}, u.tm.sendWait) != nil {
		u.clearPending(p) // sonraki offer (yeniden bağlanma / 24 sa denetimi) yeniden planlar
		return
	}
	u.wg.Go(func() { // yanıt update.none ise belirteç gelmez: bekleyiş düşer
		if !u.wait(u.tm.tokenWait) {
			return
		}
		u.mu.Lock()
		stale := u.pending == p && !p.gotToken
		u.mu.Unlock()
		if stale {
			u.clearPending(p)
		}
	})
}

// Token `update.token`: yalnız bekleyen sürüm için, tek indirme.
func (u *Updater) Token(m *UpdateToken) {
	if u.off {
		return
	}
	u.mu.Lock()
	p := u.pending
	if p == nil || p.gotToken || m.Version != p.m.Version {
		u.mu.Unlock()
		return
	}
	p.gotToken = true
	u.mu.Unlock()
	u.wg.Go(func() { u.download(p, m.Token) })
}

func (u *Updater) fail(p *pendingInstall, reason update.Reason) {
	u.clearPending(p)
	u.failVersion(p.m.Version, reason)
}

// failVersion failed(reason) kuyruğa + S-P29-K-3 bloğu (INSTALL/HASH_MISMATCH/PLATFORM_SIGNATURE → 24 sa).
func (u *Updater) failVersion(version string, reason update.Reason) {
	now := u.clock()
	var added []update.Event
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		added = s.addEvents(update.NewEvent(update.EventFailed, version, u.Running.String(), reason, now))
		s.blockOnFail(version, reason, now)
		return true
	})
	u.logRejected(added)
	u.kickLoop()
}

// Wait arka plan işlerinin bitmesini bekler (bağlam iptalinden sonra; kapanış ve testler).
func (u *Updater) Wait() { u.wg.Wait() }

// download §5.3 adım 2–4.
func (u *Updater) download(p *pendingInstall, token string) {
	recreated, err := u.Sys.PrepareDir()
	if recreated {
		u.Events.Write(evUpdateFolder())
	}
	if err != nil {
		u.fail(p, update.ReasonInstall)
		return
	}
	f, err := u.Sys.CreateStaged()
	if err != nil {
		u.fail(p, update.ReasonInstall)
		return
	}
	err = update.Download(u.ctx, update.DownloadRequest{Client: u.HTTP, Origin: u.Origin, Path: update.PathServiceFile,
		Bearer: token, UserAgent: u.UserAgent, Manifest: p.m, Dst: f})
	if err != nil {
		f.Abort()
		u.downloadFailed(p, err)
		return
	}
	if err := f.Commit(); err != nil {
		u.Sys.RemoveStaged()
		u.fail(p, update.ReasonInstall)
		return
	}
	if err := u.Sys.PlatformSignature(); err != nil {
		u.Sys.RemoveStaged()
		u.fail(p, update.ReasonPlatformSignature)
		return
	}
	if err := u.stage(p.m); err != nil {
		u.Sys.RemoveStaged()
		u.fail(p, update.ReasonInstall)
		return
	}
	u.clearPending(p)
	u.kickLoop()
}

func (u *Updater) downloadFailed(p *pendingInstall, err error) {
	if errors.Is(err, context.Canceled) || u.ctx.Err() != nil {
		u.clearPending(p) // servis duruyor: olay yok
		return
	}
	reason := update.ReasonDownload
	var de *update.DownloadError
	if errors.As(err, &de) {
		reason = de.Reason
		if de.Status == http.StatusServiceUnavailable && p.retries < maxTokenRetry {
			p.retries++
			u.mu.Lock()
			p.gotToken = false
			u.mu.Unlock()
			if u.wait(max(de.RetryAfter, u.tm.retryMin)) { // §4.4: Retry-After'dan önce yeniden istenmez
				u.requestToken(p)
			} else {
				u.clearPending(p)
			}
			return
		}
	}
	u.fail(p, reason)
}

// stage phase=staged + apply.nonce (her denemede yeni nonce, T-4).
func (u *Updater) stage(m update.Manifest) error {
	nonce, err := newNonce()
	if err != nil {
		return err
	}
	if _, err := u.Store.Update(func(s *UpdateState) bool {
		s.Phase, s.Target, s.Prev, s.SHA256, s.Nonce = phaseStaged, m.Version, u.Running.String(), m.SHA256, nonce
		return true
	}); err != nil {
		return err
	}
	if err := u.Sys.WriteNonce(nonce); err != nil {
		_, _ = u.Store.Update(func(s *UpdateState) bool { s.clearPhase(""); return true })
		return err
	}
	return nil
}

// flush kuyruktaki olayları (kapı açıkken, 10/sa) gönderir; yalnız yazıldığı doğrulananlar kuyruktan çıkar.
func (u *Updater) flush() {
	if !u.Link.UpdateGate() {
		return
	}
	var sent []update.Event
	for _, e := range u.Store.Load().Queue {
		u.mu.Lock()
		ok := u.evLim.allow(u.clock(), eventsPerHour)
		u.mu.Unlock()
		if !ok || u.Link.SendWait(&UpdateEventMsg{Event: e}, u.tm.sendWait) != nil {
			break
		}
		sent = append(sent, e)
	}
	if len(sent) == 0 {
		return
	}
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		q := s.queue()
		q.Ack(sent)
		s.saveQueue(q)
		return true
	})
}

// tryInstall §5.3 adım 5–6: sahnelenmiş sürüm, WS kapısı açık, gözetmen yok ve oturum yokken.
func (u *Updater) tryInstall() {
	u.mu.Lock()
	busy := u.applying
	u.mu.Unlock()
	if busy {
		return
	}
	s := u.Store.Load()
	if s.Phase != phaseStaged {
		return
	}
	if t, err := update.ParseVersion(s.Target); err != nil || t.Compare(u.Running) <= 0 {
		u.Sys.RemoveStaged()
		_, _ = u.Store.Update(func(s *UpdateState) bool { s.clearPhase(""); return true })
		return
	}
	if !u.Link.UpdateGate() || u.Sys.SupervisorAlive() || !u.Session.UpdateBegin() {
		return
	}
	if u.Link.SendWait(&UpdateStateMsg{Phase: UpdatePhaseInstalling, Version: s.Target}, u.tm.sendWait) != nil ||
		!u.wait(u.tm.commitWait) {
		u.Session.UpdateEnd()
		return
	}
	if !u.Session.UpdateCommit() {
		return // 2 sn içinde connect geldi: kurulum iptal, oturumdan sonra yeniden (K-P29-12)
	}
	u.mu.Lock()
	u.applying = true
	u.mu.Unlock()
	wait, err := u.Sys.LaunchSupervisor()
	if err != nil {
		u.endApply()
		u.Sys.RemoveStaged()
		_, _ = u.Store.Update(func(s *UpdateState) bool { s.clearPhase(""); return true })
		u.failVersion(s.Target, update.ReasonInstall)
		return
	}
	u.wg.Go(func() {
		wait() // gözetmen bu servisi durdurmadan çıktıysa (nonce/kopya hatası) servis normal çalışmayı sürdürür
		u.supervisorExited(s.Target)
	})
}

// supervisorExited gözetmen servisi durdurmadan çıktı. Faz hâlâ staged ise (mutex/nonce/jeton reddi, çökme) sahne
// temizlenir ve failed(INSTALL) yazılır; aksi halde tryInstall ~2 sn'de bir yeni gözetmen ve update.state üretirdi.
func (u *Updater) supervisorExited(target string) {
	stale := false
	_, _ = u.Store.Update(func(s *UpdateState) bool {
		if s.Phase != phaseStaged {
			return false
		}
		stale = true
		s.clearPhase("")
		now := u.clock()
		s.addEvents(update.NewEvent(update.EventFailed, target, u.Running.String(), update.ReasonInstall, now))
		s.blockOnFail(target, update.ReasonInstall, now)
		return true
	})
	if stale {
		u.Sys.RemoveStaged()
	}
	u.endApply()
	u.kickLoop()
}

func (u *Updater) endApply() {
	u.Session.UpdateEnd()
	u.mu.Lock()
	u.applying = false
	u.mu.Unlock()
}

// ---- Core kurulum kapısı (K-P29-12) ----

type updGate int

const (
	updIdle updGate = iota
	updWaiting
	updInstalling
)

// UpdateBegin oturum (yardımcı, yeniden katılım bekleyişi, bekleyen oturum kapatma) yoksa 2 sn'lik bekleme kapısını açar.
func (c *Core) UpdateBegin() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cur != nil || c.rejoinLocked() != nil || c.logoff != nil || c.upd != updIdle {
		return false
	}
	c.upd = updWaiting
	return true
}

// UpdateCommit bekleme sırasında connect gelmediyse kurulum kapısına geçer (connect → busy); geldiyse false.
func (c *Core) UpdateCommit() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.upd != updWaiting || c.cur != nil || c.rejoinLocked() != nil || c.logoff != nil {
		c.upd = updIdle
		return false
	}
	c.upd = updInstalling
	return true
}

// UpdateEnd kapıyı kapatır.
func (c *Core) UpdateEnd() {
	c.mu.Lock()
	c.upd = updIdle
	c.mu.Unlock()
}

// updateConnectLocked Connect başında (kilit altında): bekleme kapısını iptal eder; kurulum sürüyorsa true (busy).
func (c *Core) updateConnectLocked() bool {
	switch c.upd {
	case updWaiting:
		c.upd = updIdle
	case updInstalling:
		return true
	}
	return false
}

// ServiceVersion boru `status` yanıtındaki sürüm (K-P29-21).
func (c *Core) ServiceVersion() string { return c.Version }
