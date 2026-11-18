//go:build linux

package gtk

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/linux/glib"
	"remote-support/agent-win/internal/linux/x11"
	"remote-support/agent-win/internal/ui/uicore"
)

// ErrNoGTK GTK yüklenemedi ya da X11 arka ucu açılamadı (arayüz kurulamaz; fail-closed).
var ErrNoGTK = errors.New("ui/gtk: GTK başlatılamadı")

// Options arayüz kurulum bilgileri.
type Options struct {
	Host, Version, Fingerprint string
	// ServerURL gömülü sunucu adresi ve TestFlag config.TestBuild: "TEST" metni bunlardan türetilir (S-P28g-9).
	ServerURL string
	TestFlag  bool
	// Wayland oturum türü (GTK yine X11 arka ucuyla, XWayland üzerinde çalışır; §1 kısıtlar).
	Wayland bool
	// Gate izin kapısı (flow.Deps.Gate ile aynı).
	Gate *control.Gate
	// Guard §5.2a kararı (K3). nil → korunan denetimler reddeder.
	Guard ClickGuard
}

// UI flow.UI'nin GTK3 uygulaması. Akış goroutine'inden gelen çağrılar glib.Post ile ana döngüye iletilir; engelleyen
// çağrılar (AskCode, Welcome(Rec), ChooseShare, PortalFailed, ShowRoster) sonucu kanaldan bekler.
type UI struct {
	events  chan flow.Event
	footer  string
	version string // config.Version: pencere başlıklarında (uicore.VersionedTitle, 2026-11-18)
	gate    *control.Gate
	guard   ClickGuard
	test    bool
	wayland bool
	dark    bool
	forms   map[*form]bool

	lobby, ended, licenses, about, portal *form
	sess                                  *sessionWin
	ind                                   *indicator
	endNote                               string

	ctlDlg, monDlg, offer, printDlg, removeDlg, endDlg, voiceDlg *prompt
	offerFID, printPID, voiceAskID                               string
	protectedOpen                                                int

	techName    string
	granted     bool
	hotkeyLabel string
	fileServer  bool
	recView     flow.RecView
	voiceOn     bool
	voiceMuted  bool
	health      uicore.Health // gösterge (§5.2b)
	sessHealth  uicore.Health // oturum penceresi (S-P28g-8)

	pause atomic.Pointer[func(paused bool)]
	stop  chan struct{}
}

// New GTK'yı ana iş parçacığında başlatır (çağıran kilitli ana iş parçacığıdır): XInitThreads (her Xlib çağrısından
// önce, §5.4 m.5) → yalnız x11 arka ucu → gtk_init_check → sabit tema + CSS sağlayıcı → 1 sn tik.
func New(o Options) (*UI, <-chan flow.Event, error) {
	if err := load(); err != nil {
		return nil, nil, errors.Join(ErrNoGTK, err)
	}
	if err := x11.InitThreads(); err != nil { // her Xlib çağrısından önce (§5.4 m.5); K3 aynı tek çağrıyı paylaşır
		return nil, nil, errors.Join(ErrNoGTK, err)
	}
	gdkSetAllowedBackends(cstr("x11"))
	if !gtkInitCheck(0, 0) {
		return nil, nil, ErrNoGTK
	}
	gate := o.Gate
	if gate == nil {
		gate = &control.Gate{}
	}
	u := &UI{events: make(chan flow.Event, 16), footer: uicore.FooterText(o.Host, o.Version, o.Fingerprint),
		version: o.Version, gate: gate, guard: o.Guard, test: testBuild(o.ServerURL, o.TestFlag), wayland: o.Wayland,
		forms: map[*form]bool{}, stop: make(chan struct{})}
	if err := u.applyTheme(); err != nil {
		return nil, nil, errors.Join(ErrNoGTK, err)
	}
	go u.ticker()
	return u, u.events, nil
}

// Run GTK ana döngüsü (ana iş parçacığında; Quit'e kadar engeller).
func (u *UI) Run() { gtkMain() }

// Quit ana döngüyü bitirir (her goroutine'den).
func (u *UI) Quit() {
	close(u.stop)
	_ = glib.Post(gtkMainQuit)
}

func testText() string { return flow.LinuxTexts.TestBand }

// winTitle pencere başlığı: uygulama adının yanında sürüm (2026-11-18), TEST derlemesinde sonda " — TEST".
func (u *UI) winTitle(t string) string {
	return title(uicore.VersionedTitle(t, u.version), u.test, testText())
}

// Events kullanıcı olayları (flow.Deps.Events).
func (u *UI) Events() <-chan flow.Event { return u.events }

func (u *UI) emit(e flow.Event) {
	select {
	case u.events <- e:
	default:
	}
}

// do fn'i ana döngüde çalıştırır.
func (u *UI) do(fn func()) { _ = glib.Post(fn) }

// await engelleyen ekranın sonucunu bekler; bağlam biterse zero.
func await[T any](ctx context.Context, ch <-chan T, zero T) T {
	select {
	case r := <-ch:
		return r
	case <-ctx.Done():
		return zero
	}
}

// SetHotkey K3 kapatma kısayolu etiketi (boş = kaydedilemedi, G-21; Wayland'de global kısayol yok).
func (u *UI) SetHotkey(label string) { u.do(func() { u.hotkeyLabel = label }) }

// HotkeyPressed K3 input host'undan (kapı zaten kapatıldı).
func (u *UI) HotkeyPressed() { u.emit(flow.Event{Kind: flow.EvControlHotkey}) }

// SetInjectPause korunan bir onay diyaloğu açıkken enjektör duraklar (true), son diyalog kapanınca sürer (false).
// Çağrı ana iş parçacığındandır, engellememelidir (K3 bağlar; mac ile aynı ad).
func (u *UI) SetInjectPause(fn func(paused bool)) {
	if fn != nil {
		u.pause.Store(&fn)
	}
}

func (u *UI) protectedDelta(d int) {
	before := u.protectedOpen
	u.protectedOpen = max(0, u.protectedOpen+d)
	if fn := u.pause.Load(); fn != nil && (before == 0) != (u.protectedOpen == 0) {
		(*fn)(u.protectedOpen > 0)
	}
}

// applyTheme O-P28g-T2-1: tema adı sabit "Adwaita" (gömülü kaynak), koyu yalnız bool; kendi CSS sağlayıcımız ekran
// düzeyinde PRIORITY_USER+1. Tema adı değişirse (notify) yeniden "Adwaita" yazılır.
func (u *UI) applyTheme() error {
	st := gtkSettingsGetDefault()
	if st == 0 {
		return ErrNoGTK
	}
	prefer := boolProp(st, "gtk-application-prefer-dark-theme")
	u.dark = darkFrom(stringProp(st, "gtk-theme-name"), prefer)
	setStringProp(st, "gtk-theme-name", themeName)
	setBoolProp(st, "gtk-application-prefer-dark-theme", u.dark)
	onEvent(st, sigNotify, func(uintptr) bool {
		if name := stringProp(st, "gtk-theme-name"); name != themeName {
			u.dark = darkFrom(name, prefer)
			setStringProp(st, "gtk-theme-name", themeName)
			setBoolProp(st, "gtk-application-prefer-dark-theme", u.dark)
			u.loadCSS()
		}
		return false
	})
	return u.loadCSS()
}

// themeName sabit tema: GTK'nın gömülü kaynağı (dosya sisteminden yüklenmez; O-P28g-T2-1).
const themeName = "Adwaita"

var cssProvider uintptr

func (u *UI) loadCSS() error {
	if cssProvider == 0 {
		cssProvider = gtkCSSProviderNew()
		gtkStyleContextAddScreen(gdkScreenGetDefault(), cssProvider, priorityUserPlus1)
	}
	css := themeCSS(u.dark)
	var gerr uintptr
	if !gtkCSSProviderLoadData(cssProvider, cstr(css), len(css), &gerr) {
		if gerr != 0 {
			gErrorFree(gerr)
		}
		return ErrNoGTK
	}
	return nil
}

// ticker 1 sn tiki (Go zamanlayıcısı; iş ana döngüde).
func (u *UI) ticker() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			u.do(u.tick)
		case <-u.stop:
			return
		}
	}
}

// tick: gösterge öne alınır ve denetlenir (§2.1 overlay), oturum penceresi geri getirilir (S-P28g-8), pencere
// çerçeveleri enjektöre verilir (X11).
func (u *UI) tick() {
	if u.ind != nil {
		u.indicatorTick()
	}
	if s := u.sess; s != nil && !s.finished {
		u.sessionTick(s)
	}
	u.syncOwnWindows()
}

// syncOwnWindows X11: görünür pencerelerimizin çerçeveleri (GDK mantıksal piksel × ölçek = X aygıt pikseli, kök
// koordinatı) enjektöre verilir; imleç bunların üstündeyken enjekte tıklama düşer. Wayland'de pencere dikdörtgeni
// kuralı yoktur (§5.2) — boş liste.
func (u *UI) syncOwnWindows() {
	if u.wayland {
		input.SetOwnWindows(nil)
		return
	}
	rs := make([]input.FRect, 0, len(u.forms))
	for f := range u.forms {
		if f.closed || !gtkWidgetGetMapped(f.win) {
			continue
		}
		var x, y, w, h int32
		gtkWindowGetPosition(f.win, &x, &y)
		gtkWindowGetSize(f.win, &w, &h)
		sc := float64(max(1, gtkWidgetGetScaleFactor(f.win)))
		// Pencere yöneticisi çerçevesi (başlık çubuğu) için her yönde 40 mantıksal piksel pay.
		rs = append(rs, input.FRect{X: (float64(x) - 40) * sc, Y: (float64(y) - 40) * sc,
			W: (float64(w) + 80) * sc, H: (float64(h) + 80) * sc})
	}
	input.SetOwnWindows(rs)
}

// Ended son ekran (AC-107: çağıran 2,5 sn sonra Quit çağırır).
func (u *UI) Ended(m flow.Message) { u.do(func() { u.showEnded(m) }) }

// EndedNote oturum sonu bilgi satırı.
func (u *UI) EndedNote(note string) { u.do(func() { u.endNote = note }) }

var _ flow.UI = (*UI)(nil)
