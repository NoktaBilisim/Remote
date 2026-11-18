//go:build linux

package input

import (
	"context"
	"runtime"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/portal"
)

// P28g §5.2a `localClick()` Linux kararının m.3–m.5 kısmı (tek tanım; m.1–m.2 — aynı denetimde sol basış + bırakma,
// send_event 0 — GTK tarafında, ui/gtk classifyClick). Beyaz liste, fail-closed:
//
//  3. Basış ve bırakmanın kaynak aygıt kimliği (gdk_x11_device_get_id) XTEST alt aygıt kimliklerinden biri değildir.
//     Kimlik listesi yoksa ya da aygıt kimliği okunamadıysa (−1) ret. X11 ve XWayland.
//  4. Enjektör duraklatılmış durumdadır (korunan denetim açıkken arayüz SetInjectPause(true) çağırır; enjektör hiç
//     kurulmadıysa zaten enjeksiyon yoktur) ve son enjeksiyondan bu yana ≥ 1,5 sn geçmiştir.
//  5. Bekleme tıklaması / Fare Tuşları oturum sırasında kapalıdan açığa geçmemiştir (A11yChanged; başta açıksa kabul).
//     Başlangıç durumu okunamadıysa "kapalı" varsayılır (D-P28g-K1-1, fail-closed): sonraki ilk bilinen "açık" okuma
//     geçiş sayılır ve mandal kurulur (başta gerçekten açık idiyse korunan denetim bu oturumda reddeder; müşteri yeniden başlatır).
//
// Zaman tabanlı yedek yoktur (S-P28g-7): m.4'teki süre yalnız ek koşuldur, tek başına kabul üretmez.

// ClickQuiet m.4: son enjeksiyondan bu yana en kısa süre (diyalog kilidiyle aynı).
const ClickQuiet = 1500 * time.Millisecond

// a11yPoll m.5 ayar yoklama aralığı.
const a11yPoll = time.Second

// LinuxClickGuard korunan denetim kararı (cmd/noktadestek gtk.ClickGuard'a uyarlar).
type LinuxClickGuard struct {
	injector atomic.Bool // enjektör kuruldu (kontrol bağlandı)
	paused   atomic.Bool
	changed  atomic.Bool // m.5 mandalı

	once sync.Once
	gate atomic.Pointer[control.Gate]
	mk   atomic.Int32 // Fare Tuşları: 0 bilinmiyor, 1 kapalı, 2 açık (HostProbe)
	ids  func() []int32
	now  func() time.Time
}

// NewLinuxClickGuard karar nesnesi. ids XTEST kimlik kaynağı (nil → XTestIDs).
func NewLinuxClickGuard(ids func() []int32) *LinuxClickGuard {
	if ids == nil {
		ids = XTestIDs
	}
	return &LinuxClickGuard{ids: ids, now: time.Now}
}

// SetInjector enjektör bağlandı (bundan sonra kapı açıkken m.4 duraklatma şartı aranır).
func (g *LinuxClickGuard) SetInjector(gate *control.Gate) {
	g.gate.Store(gate)
	g.injector.Store(true)
}

func (g *LinuxClickGuard) gateOpen() bool {
	gt := g.gate.Load()
	return gt == nil || gt.IsOpen()
}

// MouseKeys Fare Tuşları açık mı (son yoklama); bilinmiyorsa true (fail-closed; HostProbe).
func (g *LinuxClickGuard) MouseKeys() bool { return g.mk.Load() != 1 }

// SetPaused arayüzün SetInjectPause bildirimi (Applier.Pause/Resume ile birlikte çağrılır).
func (g *LinuxClickGuard) SetPaused(p bool) { g.paused.Store(p) }

// Decide m.3–m.4 kararı; pressDev/releaseDev GDK kaynak aygıt kimlikleri (−1 okunamadı).
func (g *LinuxClickGuard) Decide(pressDev, releaseDev int32) bool {
	ids := g.ids()
	if len(ids) == 0 || pressDev < 0 || releaseDev < 0 || slices.Contains(ids, pressDev) || slices.Contains(ids, releaseDev) {
		return false
	}
	if g.injector.Load() && !g.paused.Load() && g.gateOpen() {
		return false // kapı kapalıyken Applier hiçbir şey enjekte etmez: duraklatılmış sayılır
	}
	if last := lastInject.Load(); last != 0 && g.now().Sub(time.Unix(0, last)) < ClickQuiet {
		return false
	}
	return true
}

// A11yChanged m.5 mandalı.
func (g *LinuxClickGuard) A11yChanged() bool { return g.changed.Load() }

// WatchA11y m.5: başlangıç durumu (izleyici goroutine'inde) okunur; kapalıyken açığa geçerse mandal kurulur (oturum boyunca). ctx bitince durur.
// Bir kez başlatılır.
func (g *LinuxClickGuard) WatchA11y(ctx context.Context, read func() portal.A11yState) {
	g.once.Do(func() {
		go func() {
			base := read() // ana döngü başladıktan sonra (libgio yedeği ana iş parçacığında okur)
			g.setMouseKeys(base)
			t := time.NewTicker(a11yPoll)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
				}
				cur := read()
				g.setMouseKeys(cur)
				if a11yTurnedOn(base, cur) {
					g.changed.Store(true) // mandal; yoklama Fare Tuşları için sürer
				}
			}
		}()
	})
}

func (g *LinuxClickGuard) setMouseKeys(st portal.A11yState) {
	switch {
	case !st.Known:
		g.mk.Store(0)
	case st.MouseKeys:
		g.mk.Store(2)
	default:
		g.mk.Store(1)
	}
}

// a11yTurnedOn başta kapalı ya da bilinmiyor (D-P28g-K1-1: bilinmeyen = kapalı) → şimdi bilinen açık.
func a11yTurnedOn(base, cur portal.A11yState) bool {
	return (!base.Known || !base.On) && cur.Known && cur.On
}

// queryXTestIDs XWayland/X11'de XTEST alt aygıt kimliklerini tek seferlik okur (Wayland'de XI2 izleyici çalışmaz;
// m.3 yine uygulanır). Kısa ömürlü ayrı Display, kilitli iş parçacığı.
func queryXTestIDs() []int32 {
	if bindX() != nil {
		return nil
	}
	ch := make(chan []int32, 1)
	go func() {
		runtime.LockOSThread() // goroutine kilitli biter → iş parçacığı da sonlanır
		d := openXDisplay()
		if d == 0 {
			ch <- nil
			return
		}
		defer xl.closeDisplay(d)
		ch <- xtestDevices(d)
	}()
	return <-ch
}
