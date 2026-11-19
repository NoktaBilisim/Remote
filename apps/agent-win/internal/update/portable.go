package update

import (
	"context"
	"errors"
	"io"
	"sync"
	"time"
)

// Taşınabilir istemci orkestrasyonu (P29 K8; mimari-p29 §5.2, K-P29-12/14/17, AC-478/479/482–485/487). Windows
// taşınabilir, Linux ELF ve macOS paketi aynı akışı kullanır; platform farkı yalnız SelfReplacer'dadır. maxSeen ve olay
// kuyruğu yalnız süreç belleğindedir (iz bırakmama, AC-484; D-4). Kurulum yalnız açık pencere kapsamı / oturum yokken
// yapılır; oturum sürerken bulunan sürüm indirilip doğrulanır, kurulum oturum bitince (End) yapılır.

// Offer sunucu teklifi (GET /public/agent/update 200 gövdesi; api.UpdateOffer ile aynı alanlar, kodlu).
type Offer struct {
	Manifest  string
	Signature string
	Policy    string
}

// İstek süreleri: denetim ve politika (bindings/status) dönem başına bir kez; olay gönderimi arka planda.
const (
	portableCheckTimeout = 30 * time.Second
	portableSendTimeout  = 10 * time.Second
)

// PortableDeps orkestratör bağımlılıkları (cmd/noktadestek bağlar; testte sahte).
type PortableDeps struct {
	Trust   Trust
	Running Running
	// Check teklifi sorar; (nil, nil) = yayın yok / eski sunucu (AC-493). Hata sessizdir (AC-478).
	Check func(ctx context.Context) (*Offer, error)
	// Policy kayıtlı bilgisayar politikası (kapalı kazanır) ve olay kimliği için kayıt anahtarları (≤ 5). Hata → bu dönem
	// karar verilmez (kapalı olabilir; AC-485 fail-closed). nil → auto, anahtarsız (macOS, Linux, kayıtsız).
	Policy func(ctx context.Context) (Policy, []string, error)
	// Send olayları bildirir; nil hata → kuyruktan düşülür (Ack yalnız başarıda).
	Send func(ctx context.Context, keys []string, events []Event) error
	// Download aynı kökenden indirir ve dst'ye yazarken doğrular (update.Download).
	Download func(ctx context.Context, m Manifest, dst io.Writer) error
	Replacer SelfReplacer
	// Link AC-483 indirme bağlantısı (sunucu karşılama adresi).
	Link string
	// Notify bilgiyi hemen gösterebiliyorsa (tepsi balonu) gösterir ve true döner; nil/false → Notice ile bekler.
	Notify func(text string) bool
	Now    func() time.Time
	Timer  Timer
	Rand   func() float64
}

// Portable taşınabilir istemcinin güncelleyicisi. Eşzamanlı kullanıma güvenlidir.
type Portable struct {
	d      PortableDeps
	q      *Queue
	sendMu sync.Mutex

	mu        sync.Mutex
	busy      int
	maxSeen   Version
	keys      []string
	pending   Staging // indirme sürüyor
	staged    Staging // doğrulandı, kurulum bekliyor
	stagedVer string
	installed bool
	closed    bool
	notice    string
	noticeKey string
	cancel    context.CancelFunc
	done      chan struct{}
}

// NewPortable orkestratör; Start çağrılana kadar ağ isteği yok.
func NewPortable(d PortableDeps) *Portable {
	if d.Now == nil {
		d.Now = time.Now
	}
	return &Portable{d: d, q: NewQueue(QueueState{})}
}

// Start açılış denetimini ve 24 sa ± 2 sa dönemini başlatır (AC-478). Gömülü anahtar yoksa hiçbir şey yapmaz.
func (p *Portable) Start(ctx context.Context) {
	if !p.d.Trust.Enabled() {
		return
	}
	p.mu.Lock()
	if p.cancel != nil || p.closed {
		p.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	p.cancel, p.done = cancel, done
	p.mu.Unlock()
	go func() {
		defer close(done)
		RunChecks(ctx, p.d.Timer, p.d.Rand, p.check)
	}()
}

// Begin bir pencere kapsamı / oturum başladı: kurulum ertelenir (AC-479).
func (p *Portable) Begin() {
	p.mu.Lock()
	p.busy++
	p.mu.Unlock()
}

// End kapsam bitti; başka kapsam yoksa bekleyen doğrulanmış sürüm şimdi kurulur. Bilgi satırı Notice ile alınır (son
// ekran); olaylar arka planda gönderilir.
func (p *Portable) End() {
	p.mu.Lock()
	if p.busy > 0 {
		p.busy--
	}
	commit := p.busy == 0 && p.staged != nil && !p.closed
	if commit {
		p.commitLocked()
	}
	p.mu.Unlock()
	if commit {
		go p.flushTimeout(portableSendTimeout)
	}
}

// Notice gösterilmemiş bilgi satırı (bir kez; "" yok). Windows ana ekranı ve son ekran çağırır.
func (p *Portable) Notice() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := p.notice
	p.notice = ""
	return n
}

// Abort sinyal ile çıkış (os.Exit, defer yok): geçici dosyalar eşzamanlı silinir, sonraki iş yapılmaz (AC-484).
func (p *Portable) Abort() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	if p.cancel != nil {
		p.cancel()
	}
	for _, s := range []Staging{p.pending, p.staged} {
		if s != nil {
			s.Abort()
		}
	}
	p.pending, p.staged = nil, nil
}

// Close normal çıkış: döngü ve süren indirme iptal edilir (olay yok), kurulmamış geçici dosya silinir, kuyruk en çok
// timeout içinde gönderilir (AC-107 kapanış süresini aşmamak için kısa).
func (p *Portable) Close(timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	p.mu.Lock()
	done := p.done
	p.mu.Unlock()
	p.Abort()
	if done != nil {
		t := time.NewTimer(timeout)
		select {
		case <-done:
		case <-t.C:
		}
		t.Stop()
	}
	if rem := time.Until(deadline); rem > 0 {
		p.flushTimeout(rem)
	}
}

// check bir denetim dönemi (§5.2): teklif → Verify → politika → Decide → olaylar → (indir + kur | bildir) → gönder.
func (p *Portable) check(ctx context.Context) {
	p.mu.Lock()
	stop := p.installed || p.staged != nil || p.closed
	maxSeen := p.maxSeen
	p.mu.Unlock()
	if stop { // süreç başına bir kurulum: yeni sürüm sonraki açılışta çalışır
		p.flush(ctx)
		return
	}
	cctx, cancel := context.WithTimeout(ctx, portableCheckTimeout)
	offer, err := p.d.Check(cctx)
	cancel()
	if err != nil || offer == nil {
		return
	}
	now := p.d.Now()
	r := VerifyEncoded(p.d.Trust, offer.Manifest, offer.Signature, p.d.Running, maxSeen, now)
	p.mu.Lock()
	if r.MaxSeen.Compare(p.maxSeen) > 0 {
		p.maxSeen = r.MaxSeen
	}
	p.mu.Unlock()
	if r.Outcome == OutcomeDisabled || r.Outcome == OutcomeNone {
		return
	}
	policy, ok := p.policy(ctx, ParsePolicy(offer.Policy))
	if !ok {
		return
	}
	dec := Decide(r, policy, p.d.Running.Version, now)
	for _, e := range dec.Events {
		p.q.Add(e)
	}
	switch dec.Action {
	case ActionNotify:
		p.show(p.announce(EventAvailable+"/"+r.Manifest.Version, p.availableText()))
	case ActionInstall:
		p.stage(ctx, r.Manifest)
	}
	p.flush(ctx)
}

// policy sunucu teklifinin politikası (ref) ile kayıtlı bilgisayar politikalarını birleştirir; kayıt anahtarlarını olay
// kimliği için saklar. Kayıt durumu okunamadıysa false (bu dönem karar yok).
func (p *Portable) policy(ctx context.Context, offer Policy) (Policy, bool) {
	if p.d.Policy == nil {
		return offer, true
	}
	cctx, cancel := context.WithTimeout(ctx, portableCheckTimeout)
	bp, keys, err := p.d.Policy(cctx)
	cancel()
	if err != nil {
		return "", false
	}
	p.mu.Lock()
	p.keys = append([]string(nil), keys...)
	p.mu.Unlock()
	return MergePolicy(offer, bp), true
}

// stage hazırlık (yazılabilirlik) → indirme + doğrulama → oturum yoksa hemen kurulum.
func (p *Portable) stage(ctx context.Context, m Manifest) {
	from := p.d.Running.Version.String()
	st, err := p.d.Replacer.Prepare()
	switch {
	case errors.Is(err, ErrNotWritable):
		p.skip(m.Version, from, ReasonNotWritable)
		return
	case errors.Is(err, ErrManualOnly):
		p.skip(m.Version, from, ReasonManualOnly)
		return
	case err != nil: // ErrBusy ve beklenmeyen hata: sessiz, sonraki dönem
		return
	}
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		st.Abort()
		return
	}
	p.pending = st
	p.mu.Unlock()

	err = p.d.Download(ctx, m, st)

	p.mu.Lock()
	owned := p.pending == st
	p.pending = nil
	if owned && err == nil {
		p.staged, p.stagedVer = st, m.Version
		var text string
		if p.busy == 0 {
			text = p.commitLocked()
		}
		p.mu.Unlock()
		p.show(text)
		return
	}
	p.mu.Unlock()
	if !owned { // Abort/Close aldı ve sildi
		return
	}
	st.Abort()
	if ctx.Err() != nil { // iptal edilen indirme olay üretmez
		return
	}
	reason := ReasonDownload
	var de *DownloadError
	if errors.As(err, &de) {
		reason = de.Reason
	}
	p.q.Add(NewEvent(EventFailed, m.Version, from, reason, p.d.Now()))
}

// skip available zaten kuyrukta; skipped(reason) + "Yeni sürüm var" bilgisi.
func (p *Portable) skip(version, from string, reason Reason) {
	p.q.Add(NewEvent(EventSkipped, version, from, reason, p.d.Now()))
	p.show(p.announce(EventAvailable+"/"+version, p.availableText()))
}

// commitLocked (p.mu altında) bekleyen sürümü kurar; başarıda installed olayı (eski süreç gönderir, K-P29-17) ve "Yeni
// sürüm hazır" bilgisi. Dönen metin hemen gösterilebilecek bilgidir.
func (p *Portable) commitLocked() string {
	st, v := p.staged, p.stagedVer
	p.staged, p.stagedVer = nil, ""
	from := p.d.Running.Version.String()
	if err := st.Commit(); err != nil {
		reason := ReasonInstall
		if errors.Is(err, ErrPlatformSignature) { // AC-476/489: güvenlik olayı
			reason = ReasonPlatformSignature
		}
		p.q.Add(NewEvent(EventFailed, v, from, reason, p.d.Now()))
		return ""
	}
	p.installed = true
	p.q.Add(NewEvent(EventInstalled, v, from, "", p.d.Now()))
	return p.announceLocked(EventInstalled+"/"+v, MessageReady(v))
}

func (p *Portable) announce(key, text string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.announceLocked(key, text)
}

// announceLocked bilgi satırını bekletir; aynı anahtar (tür/sürüm) bir kez.
func (p *Portable) announceLocked(key, text string) string {
	if key == p.noticeKey {
		return ""
	}
	p.noticeKey, p.notice = key, text
	return text
}

// show bilgiyi hemen gösterebilen yüzey varsa (tepsi) gösterir ve bekleyen bilgiden düşer.
func (p *Portable) show(text string) {
	if text == "" || p.d.Notify == nil || !p.d.Notify(text) {
		return
	}
	p.mu.Lock()
	if p.notice == text {
		p.notice = ""
	}
	p.mu.Unlock()
}

func (p *Portable) availableText() string { return MessageAvailableLink(p.d.Link) }

func (p *Portable) flushTimeout(d time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	p.flush(ctx)
}

// flush kuyruğu gönderir; yalnız başarıda Ack (AC-487). Gönderimler sıralıdır (aynı olay iki kez gitmez).
func (p *Portable) flush(ctx context.Context) {
	p.sendMu.Lock()
	defer p.sendMu.Unlock()
	ev := p.q.Pending()
	if len(ev) == 0 || p.d.Send == nil {
		return
	}
	p.mu.Lock()
	keys := append([]string(nil), p.keys...)
	p.mu.Unlock()
	if p.d.Send(ctx, keys, ev) == nil {
		p.q.Ack(ev)
	}
}
