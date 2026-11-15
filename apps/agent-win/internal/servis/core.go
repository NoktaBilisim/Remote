package servis

import (
	"errors"
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
	now          func() time.Time

	mu      sync.Mutex // helperMu
	cur     *running
	enabled bool // son bildirilen yerel değer (çift device.state/olay önlenir)
	known   bool
}

type running struct {
	sessionID  string
	techName   string
	proc       Process
	started    time.Time
	killReason string
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
	if !c.LocalEnabled() {
		c.reject(m.SessionID, RejectLocalDisabled)
		return
	}
	if c.cur != nil {
		c.reject(m.SessionID, RejectBusy)
		return
	}
	in := helperio.Input{V: helperio.Version, SessionID: m.SessionID, Ticket: m.Ticket, TechName: m.TechName,
		TenantName: m.TenantName, TechIP: m.TechIP, IndicatorText: m.IndicatorText,
		ExpiresInSec: m.ExpiresInSec}
	proc, err := c.Launch.Launch(in)
	if err != nil {
		reason := helperio.ReasonHelperFailed
		if errors.Is(err, ErrNoConsole) {
			reason = helperio.ReasonNoConsole
		}
		c.reject(m.SessionID, reason)
		return
	}
	r := &running{sessionID: m.SessionID, techName: m.TechName, proc: proc, started: c.clock()}
	c.cur = r
	c.Events.Write(evStarted(m))
	go c.watch(r)
}

// reject kilit altında çağrılır.
func (c *Core) reject(sessionID, reason string) {
	c.Send(&ConnectResult{SessionID: sessionID, OK: false, Reason: reason})
	c.Events.Write(EvReject(reason, "oturum "+sessionID))
}

// watch yardımcı çıkınca kaydı temizler ve sunucuya/olay günlüğüne bildirir.
func (c *Core) watch(r *running) {
	code := r.proc.Wait()
	c.mu.Lock()
	if c.cur == r {
		c.cur = nil
	}
	reason := r.killReason
	c.mu.Unlock()
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

// Disable borudan standart kullanıcı kapatması: değer yazılır, yardımcı kesilir, sunucuya ve günlüğe bildirilir.
func (c *Core) Disable(user string) error {
	c.mu.Lock()
	if err := c.Switch.Disable(); err != nil {
		c.mu.Unlock()
		return err
	}
	c.killLocked(KillLocalDisabled)
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
		c.killLocked(KillLocalDisabled)
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
}

// Kill etkin yardımcıyı verilen nedenle keser (iptal, konsol değişimi, servis durdurma).
func (c *Core) Kill(reason string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.killLocked(reason)
}

// Status boru `status`: bağlantı durumu ve varsa bağlı teknisyen.
func (c *Core) Status() (string, string) {
	c.mu.Lock()
	tech := ""
	if c.cur != nil {
		tech = c.cur.techName
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
