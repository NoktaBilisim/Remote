//go:build linux

package input

import (
	"context"
	"sync"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/portal"
)

// P28g K3 kontrol koşulları ve telafiler (mimari-p28g §5.2, §5.2b m.1–2 ve m.6, §13 S-P28g-1/2, §15 D-P28g-T2-1):
//
//   - Ortak: oturum veri yolu adresi D-P28g-T2-1 kuralına uyar (BusOK) ve kilit ekranı durumu okunabilir (Known) ve
//     kilitli değil. Kilit etkin olur ya da durum okunamaz hale gelirse kapı ≤ 100 ms kapanır (REVOKED; akış
//     VIEW{SYSTEM}); yeniden kontrol yeni onay ister.
//   - X11: XTest enjektörü, XI2 izleyici (XTEST kimlikleri) ve kapatma kısayolu kurulu.
//   - Wayland: portal oturumu klavye+işaretçi izni verdi (CanControl) ve kilit kısayolu koruması geçerli (kısayol boş
//     değil, disable-lock-screen kapalı). Koruma kapı açıkken 1 sn'de bir yeniden okunur; bozulursa kapı kapanır.
//     Portal oturumu kapanırsa (üst çubuk "Durdur", §14 m.8) kapı kapanır ve oturum biter (onEnd).
//
// Koşul sağlanmazsa ControlReady/Arm false → akış VIEW{WAYLAND_NO_CONTROL} (flow.Deps.NoControlSource).

// guardPoll Wayland kilit kısayolu korumasının kapı açıkken yoklama aralığı.
const guardPoll = time.Second

// LinuxHostConfig LinuxHost'un bağımlılıkları (cmd/noktadestek bağlar; testte sahte).
type LinuxHostConfig struct {
	Gate    *control.Gate
	Wayland bool
	BusOK   bool
	// Lock kilit izleyicisinin son durumu (portal.LockWatcher.State); nil → bilinmiyor.
	Lock func() portal.LockState
	// Guard kilit kısayolu koruması (Wayland; portal + libgio yedeği); nil → geçersiz.
	Guard func() portal.LockGuard
	// OnLost kapı bu katmanca kapatıldıktan sonra (kilit, koruma, Notify hatası, XTEST kimliği kaybı): EvControlSystem.
	OnLost func()
	// OnEnd portal oturumu kapandı: EvEnd.
	OnEnd func()
	// OnHotkey X11 kapatma kısayolu (kapı zaten kapandı): EvControlHotkey.
	OnHotkey func()
}

// LinuxHost Linux girdi katmanı (Applier'ın enjektörü + kontrol koşulları).
type LinuxHost struct {
	cfg LinuxHostConfig
	inj *LinuxInjector

	// X11
	xt     *xtestSink
	xi     *xi2Watcher
	Hotkey control.Hotkey
	// HotkeyErr X11'de kısayol kaydedilemedi (G-21: kontrol verilmez).
	HotkeyErr error

	// Wayland
	ps   *portalSink
	mu   sync.Mutex
	sess interface{ CanControl() bool }

	stop chan struct{}
	once sync.Once
}

// StartLinux girdi katmanını kurar. X11'de XTest + XI2 + kısayol (kısayol ANA iş parçacığında kaydedilir; çağıran ana
// iş parçacığındadır, GTK döngüsü başlamadan). Kurulamayan parça kontrolü kapatır (ControlReady false); hata dönmez.
func StartLinux(cfg LinuxHostConfig) *LinuxHost {
	h := &LinuxHost{cfg: cfg, stop: make(chan struct{})}
	if cfg.Wayland {
		if ids := queryXTestIDs(); len(ids) > 0 { // localClick m.3 (XWayland); izleyici yok (§5.2 AC-104 Wayland'de yok)
			xtestIDs.Store(&ids)
		}
		h.ps = newPortalSink(h.lose)
		h.inj = newLinuxInjector(h.ps, true) // §5.2b m.3 değiştirici bütçesi
		cfg.Gate.OnOpen(func() { go h.opened() })
		return h
	}
	h.HotkeyErr = control.ErrNoHotkey
	xt, err := newXTestSink()
	if err != nil {
		return h
	}
	h.xt = xt
	h.inj = newLinuxInjector(xt, false)
	if h.xi, err = startXI2(cfg.Gate, h.lose); err != nil {
		h.xi = nil
		return h
	}
	fn := h.hotkey
	hotkeyFn.Store(&fn)
	h.Hotkey, h.HotkeyErr = control.RegisterHotkey(grabHotkey)
	return h
}

// Cursor X11 canlı imleç (HostProbe; XTest bağlantısında XQueryPointer). Wayland'de ya da hata → ok false.
func (h *LinuxHost) Cursor() (float64, float64, bool) {
	if h.xt == nil {
		return 0, 0, false
	}
	return h.xt.cursor()
}

// Injector Applier'a verilecek enjektör (nil → kontrol yok).
func (h *LinuxHost) Injector() *LinuxInjector { return h.inj }

// hotkey kapatma kısayolu (ana iş parçacığı, GDK süzgeci): kapı atomik kapanır, bildirim ayrı goroutine'de.
func (h *LinuxHost) hotkey() { h.cfg.Gate.Shut(h.cfg.OnHotkey) }

// lose kapıyı atomik kapatır ve akışa bildirir (yalnız kapı açıksa bildirim üretir; Shut zaten öyle).
func (h *LinuxHost) lose() { h.cfg.Gate.Shut(h.cfg.OnLost) }

// LockChanged kilit izleyicisinin değişiklik bildirimi (izleyici goroutine'i): kilit ya da bilinmeyen durum → REVOKED.
func (h *LinuxHost) LockChanged(st portal.LockState) {
	if !st.Known || st.Locked {
		h.lose()
	}
}

// OnSession Wayland: yeni portal oturumu (capture.ConfigureWayland geri çağrısı). Oturum kapanınca kapı kapanır ve
// akış biter.
func (h *LinuxHost) OnSession(s *portal.Session) {
	if h.ps == nil || s == nil {
		return
	}
	h.mu.Lock()
	h.sess = s
	h.mu.Unlock()
	h.ps.setSession(s)
	go func() {
		select {
		case <-s.Closed():
			h.cfg.Gate.Shut(nil)
			if h.cfg.OnEnd != nil {
				h.cfg.OnEnd()
			}
		case <-h.stop:
		}
	}()
}

// ControlReady kontrol verilebilir mi (her istekte ve "İzin ver"de yoklanır).
func (h *LinuxHost) ControlReady() bool {
	if !h.cfg.BusOK || h.inj == nil || h.cfg.Lock == nil {
		return false
	}
	if st := h.cfg.Lock(); !st.Known || st.Locked {
		return false
	}
	if h.cfg.Wayland {
		h.mu.Lock()
		s := h.sess
		h.mu.Unlock()
		return s != nil && s.CanControl() && h.cfg.Guard != nil && h.cfg.Guard().OK()
	}
	return h.xi != nil && h.HotkeyErr == nil && len(XTestIDs()) > 0
}

// Arm "İzin ver"de kapı açılmadan hemen önce: koşullar yeniden yoklanır (aradaki kilit/koruma değişimi).
func (h *LinuxHost) Arm() bool { return h.ControlReady() }

// opened Wayland: kontrol verildi → ısınma + koruma yoklaması (kapı kapanana dek).
func (h *LinuxHost) opened() {
	h.ps.warm()
	t := time.NewTicker(guardPoll)
	defer t.Stop()
	for h.cfg.Gate.IsOpen() {
		select {
		case <-h.stop:
			return
		case <-t.C:
		}
		if !h.cfg.Gate.IsOpen() {
			return
		}
		if h.cfg.Guard == nil || !h.cfg.Guard().OK() {
			h.lose()
			return
		}
	}
}

// Stop iş parçacıklarını durdurur (süreç kapanışı).
func (h *LinuxHost) Stop() {
	h.once.Do(func() {
		close(h.stop)
		if h.xi != nil {
			h.xi.close()
		}
		if h.xt != nil {
			h.xt.close()
		}
	})
}

// WatchLockInto kilit izleyicisini başlatır ve değişiklikleri host'a verir (bus yoksa nil).
func WatchLockInto(ctx context.Context, b portal.Bus, h *LinuxHost) *portal.LockWatcher {
	if b == nil {
		return nil
	}
	return portal.WatchLock(ctx, b, h.LockChanged)
}
