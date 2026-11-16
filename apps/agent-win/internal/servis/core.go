package servis

import (
	"errors"
	"io"
	"sync"
	"time"

	"remote-support/agent-win/internal/servis/helperio"
)

// Yardımcı yaşam döngüsü ve yerel anahtar (mimari-p27 §5.2 r2 O-P27-2 d, §5.4, AC-295). Tek kural: `helperMu`
// altında "LocalEnabled okuması → yardımcı başlatma → süreç kaydı"; `disable` (boru) ve kayıt defteri değişikliği aynı
// kilidi alıp değeri yazar/okur ve varsa yardımcıyı keser. Böylece "kapatıldı" yanıtından sonra yeni yardımcı
// başlayamaz. Kesme sunucuya bağlı değildir (ağ yoksa da görüntü/girdi yerelde durur, ≤ 2 sn).

// LocalSwitch HKLM `LocalEnabled` (Windows: registry_windows.go).
type LocalSwitch interface {
	Enabled() (bool, error)
	Disable() error
}

// Process başlatılmış yardımcı. Wait çıkış kodunu döner (bir kez çağrılır); Kill idempotenttir.
type Process interface {
	Wait() uint32
	Kill() error
	// WinSession yardımcının Windows oturum kimliği (başlatma anındaki konsol oturumu; D-P28u-3 müdahale hedefi).
	WinSession() uint32
	// Command giriş borusuna tek komut satırı yazar (§7.4).
	Command(cmd helperio.Command) error
	// StatusPipe durum borusunun okuma ucu (yardımcı → servis); süreç bitince EOF. nil olabilir.
	StatusPipe() io.Reader
}

// Launcher yardımcıyı konsol oturumunda başlatır (Windows: launch_windows.go).
type Launcher interface {
	Launch(in helperio.Input) (Process, error)
}

// ErrNoConsole etkin konsol oturumu yok (WTSGetActiveConsoleSessionId = 0xFFFFFFFF).
var ErrNoConsole = errors.New("servis: konsol oturumu yok")

// Kesme nedenleri (`session.closed.reason`).
const (
	KillLocalDisabled  = "local_disabled"
	KillRevoked        = "device_revoked"
	KillServer         = "server"
	KillSessionChanged = helperio.ReasonSessionChanged
	KillServiceStop    = "service_stop"
)

// Core servis çekirdeği. Send `/ws/device`'a sıraya alır (çevrimdışıyken düşebilir; durum auth'ta yeniden bildirilir).
type Core struct {
	Switch LocalSwitch
	Launch Launcher
	Events EventSink
	Send   func(msg any)
	// State `/ws/device` bağlantı durumu (boru `status`); nil ise "offline".
	State func() string
	// OnUnregister kaldırma isteği (boruda yönetici); sunucuya `device.unregister` gönderir.
	OnUnregister func() error
	// Consent1 bu sokette `device.features` alındı mı (P28u kip kararı; nil = P27 sunucusu).
	Consent1 func() bool
	// Sessions konsol oturumu okuma + oturum kapatma (Windows: winSessions). nil: durum `active`, müdahale `no_session`.
	Sessions Sessions
	// Locker oturum kilitleme yolu (nil: yardımcıya boru komutu — K-P28u-5b geri dönüş noktası).
	Locker Locker
	now    func() time.Time
	tm     timing
	users  *userWatch

	mu      sync.Mutex // helperMu
	cur     *running
	rejoin  *rejoinState // rejoinPending (logoff kabulünden 45 sn)
	logoff  *pendingLogoff
	enabled bool // son bildirilen yerel değer (çift device.state/olay önlenir)
	known   bool
}

type running struct {
	sessionID  string
	techName   string
	conn       *Connect // rejoin girdisi için teknisyen/firma/IP (rejoin mesajı taşımaz)
	mode       string   // asked | no_user | silent
	proc       Process
	started    time.Time
	killReason string
	st         helperStatus
	lockTimer  stopper
	// guardLogon `asked` odada logoff kabul edildi: konsolda yeni kullanıcı oturumu = session_changed (K-P28u-17).
	guardLogon bool
}

func (c *Core) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}

// LocalEnabled kayıt defterindeki değer; okunamazsa kapalı sayılır (fail-closed).
func (c *Core) LocalEnabled() bool {
	on, err := c.Switch.Enabled()
	return err == nil && on
}

// Init açılışta yerel değeri sessizce öğrenir (her açılışta device.state/olay 1003 üretilmez; değer auth'ta gider).
func (c *Core) Init() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.enabled, c.known = c.LocalEnabled(), true
}

// Connect sunucunun bağlantı isteği. Ret `connect.result{ok:false}` ve olay 1004 ile bildirilir.
func (c *Core) Connect(m *Connect) {
	c.mu.Lock()
	defer c.mu.Unlock()
	features := c.Consent1 != nil && c.Consent1()
	if features && !connectConsent(m) {
		c.reject(m.SessionID, RejectProtocol) // D-P28u-5: yardımcı başlatılmaz
		return
	}
	if !features && !legacyConnect(m) {
		c.reject(m.SessionID, helperio.ReasonHelperFailed) // features'sız sokette onay alanı: sözleşme dışı
		return
	}
	if !c.LocalEnabled() {
		c.reject(m.SessionID, RejectLocalDisabled)
		return
	}
	if c.cur != nil || c.rejoinLocked() != nil {
		c.reject(m.SessionID, RejectBusy)
		return
	}
	consent, mode := c.decideMode(m)
	in := helperio.Input{V: helperio.Version, SessionID: m.SessionID, Ticket: m.Ticket, TechName: m.TechName,
		TenantName: m.TenantName, TechIP: m.TechIP, IndicatorText: m.IndicatorText,
		ExpiresInSec: m.ExpiresInSec, Consent: consent, Mode: mode, IndicatorControl: m.IndicatorControl}
	if c.start(m, in) != nil && features && m.Consent == helperio.ConsentAsk && mode == helperio.ModeNoUser {
		c.Send(&ConsentResult{SessionID: m.SessionID, Mode: helperio.ModeNoUser})
	}
}

// decideMode kip kararı cihazdadır (§7.2, K-P28u-2): ask + canlı `active` → diyalog; locked/none → no_user;
// silent → diyalog yok. P27 (features'sız) bağlantı no_user gibi yürür (diyalog yok, P27 göstergesi).
func (c *Core) decideMode(m *Connect) (consent, mode string) {
	switch {
	case m.Consent == ConsentSilent:
		return helperio.ConsentNone, helperio.ModeSilent
	case m.Consent == helperio.ConsentAsk && c.userState() == UserActive:
		return helperio.ConsentAsk, helperio.ModeAsked
	}
	return helperio.ConsentNone, helperio.ModeNoUser
}

// start yardımcıyı başlatır ve kaydeder (kilit altında); hata `connect.result{ok:false}` ile bildirilir.
func (c *Core) start(m *Connect, in helperio.Input) *running {
	proc, err := c.Launch.Launch(in)
	if err != nil {
		reason := helperio.ReasonHelperFailed
		if errors.Is(err, ErrNoConsole) {
			reason = helperio.ReasonNoConsole
		}
		c.reject(m.SessionID, reason)
		return nil
	}
	return c.register(m, in, proc)
}

// register başlatılmış yardımcıyı kaydeder, çıkışını ve durum borusunu izler (kilit altında).
func (c *Core) register(m *Connect, in helperio.Input, proc Process) *running {
	r := &running{sessionID: m.SessionID, techName: m.TechName, conn: m, mode: in.Mode, proc: proc,
		started: c.clock(), st: helperStatus{consent: in.Consent}} // control=off başlatmada (D-P28u-1)
	c.cur = r
	c.Events.Write(evStarted(m, in.Mode))
	go c.watch(r)
	if sp := proc.StatusPipe(); sp != nil {
		go c.readStatus(r, sp)
	}
	return r
}

// reject kilit altında çağrılır.
func (c *Core) reject(sessionID, reason string) {
	c.Send(&ConnectResult{SessionID: sessionID, OK: false, Reason: reason})
	c.Events.Write(EvReject(reason, "oturum "+sessionID))
}

// watch yardımcı çıkınca kaydı temizler ve sunucuya/olay günlüğüne bildirir. Logoff kabul edildiyse (rejoinPending)
// yardımcının ölümü beklenendir: `session.closed` gönderilmez (§7.5), oda yeniden katılımı bekler.
func (c *Core) watch(r *running) {
	code := r.proc.Wait()
	c.mu.Lock()
	if c.cur == r {
		c.cur = nil
	}
	reason := r.killReason
	c.exitedLocked(r) // control=off, bekleyen kilit no_session
	rj := c.rejoinLocked()
	pending := reason == "" && rj != nil && rj.sessionID == r.sessionID
	c.mu.Unlock()
	if pending {
		return
	}
	if reason == "" {
		reason = helperio.Reason(code)
	}
	if helperio.PreJoin(reason) {
		c.Send(&ConnectResult{SessionID: r.sessionID, OK: false, Reason: reason})
	}
	c.Send(&Closed{SessionID: r.sessionID, Reason: reason})
	c.Events.Write(evEnded(r.sessionID, reason, c.clock().Sub(r.started)))
}

// killLocked etkin yardımcıyı keser (kilit altında). Kayıt watch'ta temizlenir.
func (c *Core) killLocked(reason string) {
	if c.cur == nil {
		return
	}
	if c.cur.killReason == "" {
		c.cur.killReason = reason
	}
	_ = c.cur.proc.Kill()
}

// endLocked oturumu verilen nedenle bitirir: yardımcı varsa keser (watch session.closed gönderir); yalnız yeniden
// katılım bekleniyorsa bekleyişi düşürür ve session.closed'ı kendisi gönderir (yerel anahtar her kipte geçerli, AC-295).
func (c *Core) endLocked(reason string) {
	rj := c.rejoin
	c.rejoin = nil
	if c.cur != nil {
		c.killLocked(reason)
		return
	}
	if rj != nil {
		c.Send(&Closed{SessionID: rj.sessionID, Reason: reason})
		c.Events.Write(evEnded(rj.sessionID, reason, 0))
	}
}

// Disable borudan standart kullanıcı kapatması: değer yazılır, yardımcı kesilir, sunucuya ve günlüğe bildirilir.
func (c *Core) Disable(user string) error {
	c.mu.Lock()
	if err := c.Switch.Disable(); err != nil {
		c.mu.Unlock()
		return err
	}
	c.endLocked(KillLocalDisabled)
	changed := !c.known || c.enabled
	c.enabled, c.known = false, true
	c.mu.Unlock()
	if changed {
		c.Send(&State{LocalEnabled: false})
		c.Events.Write(evLocal(false, user))
	}
	return nil
}

// LocalChanged kayıt defteri izleyicisi (RegNotifyChangeKeyValue) değişiklik bildirdiğinde.
func (c *Core) LocalChanged() {
	c.mu.Lock()
	on := c.LocalEnabled()
	if !on {
		c.endLocked(KillLocalDisabled)
	}
	changed := !c.known || c.enabled != on
	c.enabled, c.known = on, true
	c.mu.Unlock()
	if changed {
		c.Send(&State{LocalEnabled: on})
		c.Events.Write(evLocal(on, ""))
	}
}

// Disconnect sunucu tarafı bitiş (yedek yol).
func (c *Core) Disconnect(m *Disconnect) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cur != nil && c.cur.sessionID == m.SessionID {
		c.killLocked(KillServer)
	}
	if rj := c.rejoinLocked(); rj != nil && rj.sessionID == m.SessionID {
		c.rejoin = nil
	}
}

// Kill etkin yardımcıyı ve varsa yeniden katılım bekleyişini verilen nedenle bitirir (iptal, servis durdurma).
func (c *Core) Kill(reason string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.endLocked(reason)
}

// Status boru `status`: bağlantı durumu ve varsa bağlı teknisyen.
func (c *Core) Status() (string, string) {
	c.mu.Lock()
	tech := ""
	if c.cur != nil {
		tech = c.cur.techName
	} else if rj := c.rejoinLocked(); rj != nil {
		tech = rj.base.TechName
	}
	c.mu.Unlock()
	state := "offline"
	if c.State != nil {
		state = c.State()
	}
	if tech != "" {
		state = "session"
	}
	return state, tech
}

// Unregister boru `unregister` (yalnız yönetici).
func (c *Core) Unregister() error {
	c.Kill(KillRevoked)
	if c.OnUnregister == nil {
		return errors.New("servis: kaldırma desteklenmiyor")
	}
	return c.OnUnregister()
}

// Active etkin yardımcı var mı (test ve durdurma beklemesi).
func (c *Core) Active() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cur != nil
}
