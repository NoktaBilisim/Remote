//go:build linux

package main

import (
	"context"
	"errors"
	"os"

	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/linux/x11"
	"remote-support/agent-win/internal/portal"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/ui/gtk"
)

// P28g K3 bağlaması (mimari-p28g §5.2–§5.2b, §13 S-P28g-1/12/13, §15 D-P28g-T2-1; darwin controlDeps kalıbı):
//   - Oturum veri yolu yalnız D-P28g-T2-1 adresiyle (sessionBus) kontrol için kullanılır; uymazsa Wayland'de görüntü
//     ortamdaki adresle sürer ama kontrol verilmez, X11'de kilit izlenemediği için kontrol yok.
//   - Kilit izleyicisi (ScreenSaver) → host.LockChanged (REVOKED) ve capture.EnvProbe (AC-105).
//   - Wayland: portal oturumu capture.Monitors ile (K4 portal ekranı PortalMonitors sarar; üst pencere PortalParent);
//     yeni oturum host.OnSession'a verilir (Notify* enjektörü, Closed → EvEnd).
//   - Koşul sağlanmazsa VIEW{WAYLAND_NO_CONTROL} (sunucu Linux'tan OS_PERMISSION'ı yok sayar, S-P28g-12).
//   - localClick (§5.2a m.3–m.5) tek karar: clickGuard; arayüze gtkGuard uyarlayıcısıyla verilir (newUI).

// clickGuard §5.2a kararı; newUI'de arayüze, linuxControl'de enjektöre bağlanır (süreçte tek).
var clickGuard = input.NewLinuxClickGuard(nil)

// gtkGuard input kararını gtk.ClickGuard'a uyarlar (m.1–m.2 arayüzde, m.3–m.5 burada).
type gtkGuard struct{ g *input.LinuxClickGuard }

func (a gtkGuard) LocalClick(press, release gtk.ButtonEvent) bool {
	return a.g.Decide(press.DeviceID, release.DeviceID)
}

func (a gtkGuard) A11yChanged() bool { return a.g.A11yChanged() }

// portalUI K4 Wayland portal ekranı (gtk.UI).
type portalUI interface {
	PortalMonitors(ctx context.Context, open func() ([]signal.Monitor, error),
		classify func(error) (isPortal, missing bool)) ([]signal.Monitor, error)
	PortalParent() string
}

// classifyPortal capture hatası portal kaynaklı mı, portal bileşeni eksik mi (A-PG-2).
func classifyPortal(err error) (isPortal, missing bool) {
	var pe *capture.PortalError
	return errors.As(err, &pe), errors.Is(err, portal.ErrUnavailable)
}

// linuxControl girdi + kontrol koşulları + Wayland portal bağlaması. Ana iş parçacığında, GTK döngüsünden önce
// (X11 kısayolu GDK bağlantısında burada yakalanır).
func linuxControl(d *flow.Deps, u flow.UI, gate *control.Gate) {
	ctx := context.Background()
	wayland := sessionKind(os.Getenv) == "wayland"
	d.NoControlSource = "WAYLAND_NO_CONTROL"
	d.ControlLostText = flow.LinuxTexts.ControlLost
	envAddr := os.Getenv("DBUS_SESSION_BUS_ADDRESS")
	addr, busOK := sessionBus(envAddr, os.Getenv("XDG_RUNTIME_DIR"), os.Getuid())
	if !busOK {
		addr = envAddr // yalnız Wayland görüntüsü için (kontrol yok)
	}
	var bus portal.Bus
	if addr != "" {
		if b, err := portal.Connect(addr); err == nil {
			bus = b
		} else {
			busOK = false
		}
	}
	// Host olayları akışa doğrudan girer (arayüzün olay kanalıyla birleştirilir; darwin kalıbı).
	merged := make(chan flow.Event, 16)
	go func(in <-chan flow.Event) {
		for e := range in {
			merged <- e
		}
		close(merged)
	}(d.Events)
	d.Events = merged
	// Gate.Shut'ın after'ı ayrı goroutine'de çalışır: engelleyen gönderim olayı kaybetmez (darwin kalıbı).
	emit := func(k flow.EventKind) func() { return func() { merged <- flow.Event{Kind: k} } }
	var watcher *portal.LockWatcher
	host := input.StartLinux(input.LinuxHostConfig{
		Gate: gate, Wayland: wayland, BusOK: busOK,
		Lock: func() portal.LockState {
			if watcher == nil {
				return portal.LockState{}
			}
			return watcher.State()
		},
		Guard: func() portal.LockGuard {
			return portal.ReadLockGuardWith(settingsReader(bus))
		},
		OnLost: emit(flow.EvControlSystem), OnEnd: emit(flow.EvEnd), OnHotkey: emit(flow.EvControlHotkey),
	})
	if busOK {
		watcher = input.WatchLockInto(ctx, bus, host)
		capture.SetLockSource(watcher.State)
	}
	if wayland {
		var parent func() string
		if p, ok := u.(portalUI); ok {
			parent = p.PortalParent
			d.Monitors = func() ([]signal.Monitor, error) { return p.PortalMonitors(ctx, capture.Monitors, classifyPortal) }
		}
		capture.ConfigureWayland(bus, busOK, parent, host.OnSession)
	}
	clickGuard.WatchA11y(ctx, func() portal.A11yState { return portal.ReadA11y(settingsReader(bus)) })
	inj := host.Injector()
	if inj == nil || (!wayland && host.HotkeyErr != nil) {
		return // kontrol bildirilmez (G-21)
	}
	applier := input.NewApplier(gate, inj, nil)
	clickGuard.SetInjector(gate)
	if !wayland {
		applier.SetHostProbe(linuxProbe{g: clickGuard, cursor: host.Cursor}) // §5.2 kendi pencerelerimiz (X11)
	}
	d.Input = applier.Handle
	d.ControlReady = host.ControlReady
	d.ArmControl = host.Arm
	d.Hotkey = host.Hotkey.Label
	if wayland {
		d.Hotkey = flow.LinuxTexts.WaylandHotkey // global kısayol yok; "Durdur" yolu (§5.2)
	}
	d.SetInputMonitor = func(id int) {
		m, ok := capture.MonitorRect(id)
		if !ok {
			return
		}
		mon := control.Rect{Left: int32(m.X), Top: int32(m.Y), Right: int32(m.X + m.W), Bottom: int32(m.Y + m.H)}
		virt := mon // Wayland: koordinat portal akışına görelidir
		if !wayland {
			virt = x11Root()
		}
		inj.SetVirtual(virt)
		applier.SetTarget(mon, virt)
	}
	if h, ok := u.(interface{ SetHotkey(label string) }); ok {
		h.SetHotkey(d.Hotkey)
	}
	if p, ok := u.(interface{ SetInjectPause(fn func(paused bool)) }); ok {
		p.SetInjectPause(func(paused bool) {
			clickGuard.SetPaused(paused)
			if paused {
				applier.Pause()
			} else {
				applier.Resume()
			}
		})
	}
}

// settingsReader portal Settings.Read, şema sunulmuyorsa libgio (ana iş parçacığında).
func settingsReader(bus portal.Bus) portal.Reader {
	var pr portal.Reader
	if bus != nil {
		pr = portal.PortalReader(bus)
	}
	return portal.Fallback(pr, portal.GIOReader(x11.OnMain))
}

// x11Root kök pencere (tüm GDK monitörlerinin kapsayan dikdörtgeni; fiziksel piksel).
func x11Root() control.Rect {
	var r control.Rect
	for id := 1; id <= 16; id++ {
		m, ok := capture.MonitorRect(id)
		if !ok {
			break
		}
		r.Left, r.Top = min(r.Left, int32(m.X)), min(r.Top, int32(m.Y))
		r.Right, r.Bottom = max(r.Right, int32(m.X+m.W)), max(r.Bottom, int32(m.Y+m.H))
	}
	return r
}

// linuxProbe input.HostProbe (X11): Fare Tuşları son a11y yoklamasından, imleç XTest bağlantısından (XQueryPointer).
type linuxProbe struct {
	g      *input.LinuxClickGuard
	cursor func() (float64, float64, bool)
}

func (p linuxProbe) MouseKeys() bool                 { return p.g.MouseKeys() }
func (p linuxProbe) Cursor() (x, y float64, ok bool) { return p.cursor() }
