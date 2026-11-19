package servis

import (
	"sync"
	"time"
)

// Konsol kullanıcı durumu (mimari-p28u §7.2, AC-429). Kaynak SERVICE_CONTROL_SESSIONCHANGE olayıdır; olay yalnız
// tetikleyicidir (EventData'ya güvenilmez), durum her seferinde WTS okumasıyla yeniden hesaplanır. Kural: konsol yok ∨
// kullanıcı adı boş → none; LOCK → locked; aksi active. Okunamazsa active. r3 (K-P28u-r3-11): durum yalnız panel
// bilgisidir; bağlantı kararını etkilemez.

// SessionInfo tek Windows oturumunun okunan hâli.
type SessionInfo struct {
	User   bool // UserName dolu (ad loga/olaya yazılmaz)
	Locked bool // SessionFlags = WTS_SESSIONSTATE_LOCK
}

// Sessions WTS erişimi (Windows: winSessions; testte sahte).
type Sessions interface {
	// Console etkin konsol oturumu; ok=false: konsol oturumu yok (0xFFFFFFFF).
	Console() (id uint32, ok bool)
	// Info oturum bilgisi; hata: oturum yok ya da okunamadı.
	Info(id uint32) (SessionInfo, error)
	// Logoff WTSLogoffSession(bWait=FALSE) — uygulamalar beklenmeden kapanır (V-PU7).
	Logoff(id uint32) error
}

// userStateOf saf karar.
func userStateOf(s Sessions) string {
	if s == nil {
		return UserActive
	}
	id, ok := s.Console()
	if !ok {
		return UserNone
	}
	info, err := s.Info(id)
	switch {
	case err != nil:
		return UserActive
	case !info.User:
		return UserNone
	case info.Locked:
		return UserLocked
	}
	return UserActive
}

// userState canlı okuma (device.user bildirimi).
func (c *Core) userState() string { return userStateOf(c.Sessions) }

// DeviceUserDebounce `device.user` değişim bildiriminin sönümlemesi (contracts deviceUserDebounceMs).
const DeviceUserDebounce = 500 * time.Millisecond

// userWatch değişimde (sönümlü) ve her device.features sonrası bir kez `device.user` gönderir.
type userWatch struct {
	read     func() string
	send     func(any)
	debounce time.Duration

	mu    sync.Mutex
	last  string
	timer *time.Timer
}

// Announce features alındığında o anki durumu hemen bildirir.
func (w *userWatch) Announce() {
	s := w.read()
	w.mu.Lock()
	w.last = s
	w.mu.Unlock()
	w.send(&DeviceUser{State: s})
}

// Changed oturum olayı: sönüm süresi sonunda yeniden okur, değiştiyse bildirir.
func (w *userWatch) Changed() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timer != nil {
		w.timer.Stop()
	}
	w.timer = time.AfterFunc(w.debounce, w.fire)
}

func (w *userWatch) fire() {
	s := w.read()
	w.mu.Lock()
	changed := s != w.last
	w.last = s
	w.mu.Unlock()
	if changed {
		w.send(&DeviceUser{State: s}) // features'sız sokette writer düşürür (K-P28u-8)
	}
}

// Features DeviceHandler: sunucu consent1'i doğruladı → durum bir kez bildirilir.
func (c *Core) Features() { c.watcher().Announce() }

// UserChanged kullanıcı durumu değişmiş olabilir (svc oturum olayı).
func (c *Core) UserChanged() { c.watcher().Changed() }

func (c *Core) watcher() *userWatch {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.users == nil {
		d := c.tm.userDebounce
		if d == 0 {
			d = DeviceUserDebounce
		}
		c.users = &userWatch{read: c.userState, send: func(m any) { c.Send(m) }, debounce: d}
	}
	return c.users
}
