//go:build darwin

package mac

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/ui/uicore"
)

// ErrNoMainQueue ana dispatch kuyruğu bağlanamadı (arayüz kurulamaz; fail-closed).
var ErrNoMainQueue = errors.New("ui/mac: ana kuyruk yok")

// Options arayüz kurulum bilgileri.
type Options struct {
	Host, Version, Fingerprint string
	// TestBuild config.TestBuild (S-P28f-7): TEST bandı için ek koşul; bant imzadan her durumda türetilir.
	TestBuild bool
	// TeamID config.TeamID (D-P28f-K3): beklenen Developer Team ID; boşsa bant her zaman gösterilir.
	TeamID string
	// Gate izin kapısı (flow.Deps.Gate ile aynı): "Kontrolü kapat" ve gösterge fail-closed'u kapıyı UI iş
	// parçacığında, akışı beklemeden kapatır (AC-101, §5.2b).
	Gate *control.Gate
}

// UI flow.UI'nin AppKit uygulaması. Akış goroutine'inden gelen çağrılar ana kuyruğa iletilir; engelleyen çağrılar
// (AskCode, Welcome(Rec), ChooseShare, PermGuide, ShowRoster) sonucu kanaldan bekler.
type UI struct {
	q      objc.Queue
	app    objc.ID
	events chan flow.Event
	footer string
	// version config.Version: pencere başlıklarında uygulama adının yanında (uicore.VersionedTitle, 2026-11-18).
	version string
	gate    *control.Gate
	band    bool
	dark    bool
	forms   map[*form]bool
	quit    func() // ön plandaki ekranın kapatma yolu (Cmd+Q, uygulama menüsü)

	lobby, ended, licenses, about *form
	sess                          *sessionWin
	ind                           *indicator
	bands                         []objc.ID
	endNote                       string

	// İzin diyalogları (prompt_darwin.go): kontrol, monitör, dosya teklifi, yazdırma, roster "Çıkar", oturum bitirme.
	ctlDlg, monDlg, offer, printDlg, removeDlg, endDlg, accessDlg *prompt
	offerFID, printPID                                            string
	protectedOpen                                                 int

	techName    string
	granted     bool
	hotkeyLabel string
	fileServer  bool
	recView     flow.RecView
	health      uicore.Health

	pause atomic.Pointer[func(paused bool)] // SetInjectPause
	stop  chan struct{}
}

// New arayüzü ana iş parçacığında kurar (NSApplication, menü, TEST bandı, 1 sn gösterge tiki). Olaylar
// flow.Deps.Events'e verilir.
func New(o Options) (*UI, <-chan flow.Event, error) {
	if rtErr != nil {
		return nil, nil, rtErr
	}
	q, err := objc.MainQueue()
	if err != nil {
		return nil, nil, errors.Join(ErrNoMainQueue, err)
	}
	gate := o.Gate
	if gate == nil {
		gate = &control.Gate{}
	}
	u := &UI{q: q, events: make(chan flow.Event, 16), footer: uicore.FooterText(o.Host, o.Version, o.Fingerprint),
		version: o.Version, gate: gate, forms: map[*form]bool{}, stop: make(chan struct{})}
	u.app = cls("NSApplication").Send(selSharedApp)
	u.app.Send(objc.Sel("setActivationPolicy:"), nsRegular)
	u.dark = isDark(u.app)
	u.band = showTestBand(signingInfo(), o.TestBuild, o.TeamID)
	u.buildMenu()
	screensHook = u.screensChanged
	movedHook = u.syncOwnWindows
	cls("NSNotificationCenter").Send(objc.Sel("defaultCenter")).Send(objc.Sel("addObserver:selector:name:object:"),
		target, objc.Sel("ekranlarDegisti:"), nsstr("NSApplicationDidChangeScreenParametersNotification"), objc.ID(0))
	u.syncBands()
	go u.ticker()
	return u, u.events, nil
}

// Events kullanıcı olayları (flow.Deps.Events).
func (u *UI) Events() <-chan flow.Event { return u.events }

func (u *UI) emit(e flow.Event) {
	select {
	case u.events <- e:
	default:
	}
}

// do fn'i ana kuyrukta bir autorelease havuzu içinde çalıştırır.
func (u *UI) do(fn func()) { _ = objc.Async(u.q, func() { objc.Pool(fn) }) }

// await engelleyen ekranın sonucunu bekler; bağlam biterse zero (ekran açık kalır, Windows ile aynı).
func await[T any](ctx context.Context, ch <-chan T, zero T) T {
	select {
	case r := <-ch:
		return r
	case <-ctx.Done():
		return zero
	}
}

// SetHotkey K3 kapatma kısayolu etiketi (boş = kaydedilemedi, G-21). Active'den önce çağrılır.
func (u *UI) SetHotkey(label string) { u.do(func() { u.hotkeyLabel = label }) }

// HotkeyPressed K3 input host'undan (kapı zaten kapatıldı): akışa control.state{VIEW, HOTKEY}.
func (u *UI) HotkeyPressed() { u.emit(flow.Event{Kind: flow.EvControlHotkey}) }

// SetInjectPause §5.2a ikinci katman: korunan bir onay diyaloğu açıkken enjektör duraklar (true), son diyalog kapanınca
// sürer (false). K3 enjektörü bağlar; çağrı ana iş parçacığındandır, engellememelidir.
func (u *UI) SetInjectPause(fn func(paused bool)) {
	if fn != nil {
		u.pause.Store(&fn)
	}
}

// protectedDelta korunan diyalog sayacı (0↔1 geçişinde enjektör duraklatma kancası).
func (u *UI) protectedDelta(d int) {
	before := u.protectedOpen
	u.protectedOpen = max(0, u.protectedOpen+d)
	if fn := u.pause.Load(); fn != nil && (before == 0) != (u.protectedOpen == 0) {
		(*fn)(u.protectedOpen > 0)
	}
}

// buildMenu uygulama menüsü (Hakkında, Lisanslar, Çık) ve Düzen menüsü (metin alanlarında kopyala/yapıştır). "Gizle",
// "Diğerlerini Gizle" ve "Pencere" menüsü yoktur (§5.2b).
func (u *UI) buildMenu() {
	bar := cls("NSMenu").Send(selNew)
	appMenu := newMenu(uicore.AppTitle)
	u.menuItem(appMenu, uicore.AppTitle+" Hakkında", "", u.showAbout)
	u.menuItem(appMenu, "Lisanslar…", "", u.showLicenses)
	appMenu.Send(objc.Sel("addItem:"), cls("NSMenuItem").Send(objc.Sel("separatorItem")))
	u.menuItem(appMenu, uicore.AppTitle+"'ten Çık", "q", u.quitApp)
	addSubmenu(bar, appMenu)
	edit := newMenu("Düzen")
	for _, it := range []struct{ title, sel, key string }{
		{"Geri Al", "undo:", "z"}, {"Kes", "cut:", "x"}, {"Kopyala", "copy:", "c"}, {"Yapıştır", "paste:", "v"},
		{"Tümünü Seç", "selectAll:", "a"},
	} {
		mi := cls("NSMenuItem").Send(selAlloc).Send(objc.Sel("initWithTitle:action:keyEquivalent:"),
			nsstr(it.title), objc.Sel(it.sel), nsstr(it.key))
		edit.Send(objc.Sel("addItem:"), mi)
		mi.Send(selRelease)
	}
	addSubmenu(bar, edit)
	u.app.Send(objc.Sel("setMainMenu:"), bar)
	bar.Send(selRelease)
}

func newMenu(title string) objc.ID {
	return cls("NSMenu").Send(selAlloc).Send(objc.Sel("initWithTitle:"), nsstr(title))
}

func addSubmenu(bar, menu objc.ID) {
	it := cls("NSMenuItem").Send(selNew)
	it.Send(objc.Sel("setSubmenu:"), menu)
	bar.Send(objc.Sel("addItem:"), it)
	it.Send(selRelease)
	menu.Send(selRelease)
}

func (u *UI) menuItem(menu objc.ID, title, key string, fn func()) {
	mi := cls("NSMenuItem").Send(selAlloc).Send(objc.Sel("initWithTitle:action:keyEquivalent:"),
		nsstr(title), selAction, nsstr(key))
	mi.Send(selSetTarget, target)
	actions[mi] = func(objc.ID) { fn() }
	menu.Send(objc.Sel("addItem:"), mi)
	mi.Send(selRelease)
}

// quitApp Cmd+Q: ön plandaki ekranın kapatma yolu (oturumda onaylı bitirme); ekran yoksa akışa bitiş.
func (u *UI) quitApp() {
	if u.quit != nil {
		u.quit()
		return
	}
	u.emit(flow.Event{Kind: flow.EvEnd})
}

// isDark sistem görünümü koyu mu (NSApp.effectiveAppearance adı "…DarkAqua").
func isDark(app objc.ID) bool {
	return strings.Contains(goText(app.Send(objc.Sel("effectiveAppearance")).Send(objc.Sel("name"))), "Dark")
}

// ticker §5.2b 1 sn tiki (Go zamanlayıcısı; NSTimer düğme izleme döngüsünde durabilir).
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

// tick: uygulama gizlendiyse geri açılır, tema değişimi uygulanır, TEST bandı ve gösterge her ekranda öne alınır ve
// göstergenin görünürlüğü denetlenir.
func (u *UI) tick() {
	if sendBool(u.app, objc.Sel("isHidden")) {
		u.app.Send(objc.Sel("unhide:"), objc.ID(0))
	}
	if d := isDark(u.app); d != u.dark {
		u.dark = d
		for f := range u.forms {
			f.recolor(d)
		}
	}
	u.syncBands()
	u.syncOwnWindows()
	if u.ind != nil {
		u.indicatorTick()
	}
}

// syncOwnWindows Y-P28f-K1: görünür pencerelerimizin (oturum penceresi, diyaloglar, karşılama/son ekranlar) çerçeveleri
// enjektöre (input.SetOwnWindows) verilir; imleç bunların üstündeyken enjekte tıklama ve tuş takımı düşer. Gösterge,
// işaretleme katmanı ve TEST bandı tıklama geçirgen olduğundan (ve ekran boyutunda olduğundan) dahil değildir.
// Pencere açılınca/kapanınca/taşınınca (windowDidMove:) ve 1 sn tikte çağrılır; ana iş parçacığında.
func (u *UI) syncOwnWindows() {
	arr := cls("NSScreen").Send(objc.Sel("screens"))
	if sendInt(arr, objc.Sel("count")) == 0 {
		return
	}
	primaryH := sendRect(arr.Send(objc.Sel("objectAtIndex:"), uint(0)), objc.Sel("frame")).Size.H
	rs := make([]input.FRect, 0, len(u.forms))
	for f := range u.forms {
		if f.closed || !sendBool(f.win, objc.Sel("isVisible")) {
			continue
		}
		fr := sendRect(f.win, objc.Sel("frame"))
		rs = append(rs, flipRect(fr.Origin.X, fr.Origin.Y, fr.Size.W, fr.Size.H, primaryH))
	}
	input.SetOwnWindows(rs)
}

func (u *UI) screensChanged() {
	u.syncBands()
	if u.ind != nil {
		u.ind.sync(u)
	}
}

// Ended son ekran (AC-107: çağıran 3 sn içinde uygulamayı sonlandırır). Boş mesaj: kullanıcı kapattı, yalnız
// göstergeler kalkar.
func (u *UI) Ended(m flow.Message) {
	u.do(func() { u.showEnded(m) })
}

// EndedNote oturum sonu bilgi satırı (Windows ile aynı; macOS'ta bilgisayar kaydı olmadığı için akış çağırmaz).
func (u *UI) EndedNote(note string) { u.do(func() { u.endNote = note }) }

var _ flow.UI = (*UI)(nil)
