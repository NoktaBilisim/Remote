//go:build linux

package capture

import (
	"context"
	"fmt"
	"os"
	"sync"

	"remote-support/agent-win/internal/linux/x11"
	"remote-support/agent-win/internal/portal"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// P28g K2 monitörler ve kaynak açma (mimari-p28g §2 capture satırı, §2.1 choose satırı, §4.4).
//   - X11: GDK monitörleri (r2: RandR yerine gdk_display_get_monitor + geometri × ölçek; fiziksel piksel). Kimlik 1
//     tabanlı GDK sırası. DISPLAY biçimi doğrulanmazsa X11 yakalama yok (S-P28g-4).
//   - Wayland: kendi seçim ekranı yok. Monitors portal oturumunu açar (sistem diyaloğu monitörü seçtirir) ve portalın
//     tek akışını "Ekran 1" olarak döner; Open(1) aynı oturumun PipeWire akışını kullanır. Oturum kapanınca (Durdur)
//     kaynak hata döner ve bir sonraki Monitors yeni oturum (yeni diyalog) açar.

// Wayland yapılandırması (deps_linux.go kurar).
var wl struct {
	mu        sync.Mutex
	on        bool
	bus       portal.Bus
	control   bool
	parent    func() string
	onSession func(*portal.Session)
	sess      *portal.Session
}

// PortalError Wayland portal oturumu kurulamadı; Err portal.ErrCancelled / ErrDenied / ErrUnavailable / ErrProtocol.
// Arayüz (K4) "Paylaşım başlatılmadı / Tekrar dene" ve A-PG-2 metnini errors.Is ile seçer.
type PortalError struct{ Err error }

func (e *PortalError) Error() string { return "capture: portal: " + e.Err.Error() }
func (e *PortalError) Unwrap() error { return e.Err }

// ConfigureWayland Wayland oturumunda portal yolunu etkinleştirir. control false → yalnız ScreenCast (RemoteDesktop
// istenmez; §5.2b m.6–7). parent üst pencere tanıtıcısı ("x11:<XID>"; K4), onSession yeni oturum kurulunca (girdi K3).
func ConfigureWayland(bus portal.Bus, control bool, parent func() string, onSession func(*portal.Session)) {
	wl.mu.Lock()
	defer wl.mu.Unlock()
	wl.on, wl.bus, wl.control, wl.parent, wl.onSession = true, bus, control, parent, onSession
}

// waylandSession açık oturum ya da yenisi (sistem diyaloğu; kullanıcı karar verene kadar bekler).
func waylandSession() (*portal.Session, error) {
	wl.mu.Lock()
	defer wl.mu.Unlock()
	if wl.sess != nil {
		select {
		case <-wl.sess.Closed():
			wl.sess.Close()
			wl.sess = nil
		default:
			return wl.sess, nil
		}
	}
	if wl.bus == nil {
		return nil, &PortalError{Err: portal.ErrUnavailable}
	}
	parent := ""
	if wl.parent != nil {
		parent = wl.parent()
	}
	s, err := portal.Open(context.Background(), wl.bus, portal.Options{Parent: parent, Control: wl.control})
	if err != nil {
		return nil, &PortalError{Err: err}
	}
	wl.sess = s
	if wl.onSession != nil {
		wl.onSession(s)
	}
	return s, nil
}

func waylandOn() bool {
	wl.mu.Lock()
	defer wl.mu.Unlock()
	return wl.on
}

// Monitors share.state için monitör listesi (AC-106).
func Monitors() ([]signal.Monitor, error) {
	if waylandOn() {
		s, err := waylandSession()
		if err != nil {
			return nil, err
		}
		st := s.Stream()
		return []signal.Monitor{{ID: 1, Name: "Ekran 1", W: st.W, H: st.H, Primary: true}}, nil
	}
	ms, err := x11Monitors()
	if err != nil {
		return nil, err
	}
	out := make([]signal.Monitor, 0, len(ms))
	for i, m := range ms {
		out = append(out, signal.Monitor{ID: i + 1, Name: fmt.Sprintf("Ekran %d", i+1), W: m.W, H: m.H, Primary: m.Primary})
	}
	return out, nil
}

var errDisplay = &Error{Reason: ReasonNoOutput, Op: "DISPLAY"}

func x11Monitors() ([]x11.Monitor, error) {
	if !ValidDisplay(os.Getenv("DISPLAY")) {
		return nil, errDisplay
	}
	ms, err := x11.Monitors()
	if err != nil || len(ms) == 0 {
		return nil, &Error{Reason: ReasonNoOutput, Op: "GdkMonitors"}
	}
	return ms, nil
}

// MonitorRect kimliğin kök pencere fiziksel piksel dikdörtgeni (X11; girdi K3 ve gösterge K4). Wayland'de portal akış
// boyutu (köken 0,0; portal koordinatı akışa görelidir).
func MonitorRect(id int) (x11.Monitor, bool) {
	if waylandOn() {
		wl.mu.Lock()
		defer wl.mu.Unlock()
		if wl.sess == nil || id != 1 {
			return x11.Monitor{}, false
		}
		st := wl.sess.Stream()
		return x11.Monitor{W: st.W, H: st.H, Primary: true}, true
	}
	ms, err := x11Monitors()
	if err != nil || id < 1 || id > len(ms) {
		return x11.Monitor{}, false
	}
	return ms[id-1], true
}

// Open seçilen monitör için VP8 kaynağı.
func Open(monitorID int) (rtc.Source, error) {
	if waylandOn() {
		if monitorID != 1 {
			return nil, &Error{Reason: ReasonNoOutput, Op: "MonitorID"}
		}
		s, err := waylandSession()
		if err != nil {
			return nil, err
		}
		st := s.Stream()
		src, err := openGst(pipeSpec{Wayland: true, FD: s.FD(), Node: st.Node}, st.W, st.H, s.Closed())
		if err != nil {
			return nil, err
		}
		return src, nil
	}
	m, ok := MonitorRect(monitorID)
	if !ok {
		return nil, &Error{Reason: ReasonNoOutput, Op: "MonitorID"}
	}
	src, err := openGst(pipeSpec{X: m.X, Y: m.Y, W: m.W, H: m.H}, m.W, m.H, nil)
	if err != nil {
		return nil, err
	}
	return src, nil
}
