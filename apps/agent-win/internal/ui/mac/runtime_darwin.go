//go:build darwin

package mac

import (
	"strings"
	"unicode/utf8"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/input"
)

// AppKit çalışma zamanı: çerçeveler, Go'da kayıtlı üç ObjC sınıfı ve geri çağrı tabloları. FFI kuralları
// (internal/darwin/objc paket belgesi): sınıflar (ve onların IMP geri çağrıları) yalnız bu init'te bir kez kaydedilir
// (kural 2); C tarafına Go işaretçisi verilmez — geri çağrılar gönderen nesnenin kimliğiyle (ObjC işaretçisi, Go belleği
// değil) Go tablolarından bulunur (kural 1). Tablolar yalnız ana iş parçacığında okunur/yazılır.

// Kayıtlı sınıflar.
const (
	classTarget = "NKDestekHedef"     // NSObject: eylem, metin değişimi, pencere temsilcisi, ekran bildirimi
	classButton = "NKDestekDugme"     // NSButton: basış olayını localClick için kaydeder (§5.2a m.1)
	classView   = "NKDestekGorunum"   // NSView: ters çevrilmiş (üst-sol orijinli) düzen + isteğe bağlı çizim
	classPanel  = "NKDestekPencere"   // NSWindow: kenarlıksız göstergenin anahtar/ana olmaması
	nsStateOn   = 1                   // NSControlStateValueOn
	nsTitled    = 1                   // NSWindowStyleMaskTitled
	nsClosable  = 2                   // NSWindowStyleMaskClosable
	nsBuffered  = 2                   // NSBackingStoreBuffered
	levelFloat  = 3                   // NSFloatingWindowLevel
	levelSaver  = 1000                // NSScreenSaverWindowLevel (gösterge, TEST bandı)
	occVisible  = 1 << 1              // NSWindowOcclusionStateVisible
	behaviorInd = 1 | 16 | 64 | 256   // canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary
	nsAlignCtr  = 1                   // NSTextAlignmentCenter (macOS 10.11+; 2 = sağ)
	nsScaleDown = 0                   // NSImageScaleProportionallyDown
	nsWidthSize = 2                   // NSViewWidthSizable
	nsRegular   = 0                   // NSApplicationActivationPolicyRegular
	keyEnter    = "\r"                // varsayılan düğme
	keyEsc      = "\x1b"              // Esc
	textLimit   = objc.MaxStringBytes // NSString üst sınırı (FFI kuralı 3)
)

var (
	rtErr error // init başarısızsa New bu hatayı döner (fail-closed: arayüzsüz akış yok)

	clsTarget, clsButton, clsView, clsPanel objc.Class
	target                                  objc.ID // tek hedef/temsilci nesnesi (süreç ömrü)

	// Geri çağrı tabloları (yalnız ana iş parçacığı). Anahtar: gönderen ObjC nesnesi.
	actions     = map[objc.ID]func(sender objc.ID){}
	textChanged = map[objc.ID]func(){}
	closers     = map[objc.ID]func(){}
	becameKey   = map[objc.ID]func(){}
	drawers     = map[objc.ID]func(view objc.ID){}
	screensHook func()
	movedHook   func() // Y-P28f-K1: pencere taşındı → çerçeveler enjektöre
	// downs basışı localClick koşullarıyla kaydedilen düğmeler (NKDestekDugme mouseDown: sırasında dolu).
	downs = map[objc.ID]input.ClickEvent{}
)

// Seçiciler (objc runtime'a bir kez kaydedilir).
var (
	selAlloc, selNew                 = objc.Sel("alloc"), objc.Sel("new")
	selRelease                       = objc.Sel("release")
	selMouseDown                     = objc.Sel("mouseDown:")
	selAction                        = objc.Sel("eylem:")
	selSetStringValue, selStringVal  = objc.Sel("setStringValue:"), objc.Sel("stringValue")
	selSetFrame, selAddSubview       = objc.Sel("setFrame:"), objc.Sel("addSubview:")
	selSetEnabled, selSetHidden      = objc.Sel("setEnabled:"), objc.Sel("setHidden:")
	selSetState, selState            = objc.Sel("setState:"), objc.Sel("state")
	selSetFont, selSetTextColor      = objc.Sel("setFont:"), objc.Sel("setTextColor:")
	selSetNeedsDisplay               = objc.Sel("setNeedsDisplay:")
	selSetKeyEquivalent              = objc.Sel("setKeyEquivalent:")
	selSetTarget, selSetAction       = objc.Sel("setTarget:"), objc.Sel("setAction:")
	selObject                        = objc.Sel("object")
	selSharedApp                     = objc.Sel("sharedApplication")
	selOrderFrontRegardless          = objc.Sel("orderFrontRegardless")
	selSetDelegate                   = objc.Sel("setDelegate:")
	selSetSelectable, selSetEditable = objc.Sel("setSelectable:"), objc.Sel("setEditable:")
)

func init() { rtErr = setupRuntime() }

// setupRuntime çerçeveleri izin listeli mutlak yoldan açar ve sınıfları kaydeder (FFI kuralı 2 ve 7).
func setupRuntime() error {
	for _, fw := range []string{"Foundation", "AppKit", "CoreGraphics"} {
		if _, err := objc.Framework(fw); err != nil {
			return err
		}
	}
	var err error
	if clsTarget, err = register(classTarget, "NSObject", []pobjc.MethodDef{
		{Cmd: selAction, Fn: onAction},
		{Cmd: objc.Sel("controlTextDidChange:"), Fn: onTextChange},
		{Cmd: objc.Sel("windowShouldClose:"), Fn: onShouldClose},
		{Cmd: objc.Sel("windowDidBecomeKey:"), Fn: onBecameKey},
		{Cmd: objc.Sel("windowDidMove:"), Fn: onMoved},
		{Cmd: objc.Sel("ekranlarDegisti:"), Fn: onScreens},
	}); err != nil {
		return err
	}
	if clsButton, err = register(classButton, "NSButton", []pobjc.MethodDef{
		{Cmd: selMouseDown, Fn: onButtonDown},
	}); err != nil {
		return err
	}
	if clsView, err = register(classView, "NSView", []pobjc.MethodDef{
		{Cmd: objc.Sel("isFlipped"), Fn: func(objc.ID, objc.SEL) bool { return true }},
		// drawRect:'in NSRect argümanı okunmaz (yazmaçta/yığında kalır; çağrılan okumadığı için ABI güvenli).
		{Cmd: objc.Sel("drawRect:"), Fn: onDraw},
	}); err != nil {
		return err
	}
	if clsPanel, err = register(classPanel, "NSWindow", []pobjc.MethodDef{
		{Cmd: objc.Sel("canBecomeKeyWindow"), Fn: func(objc.ID, objc.SEL) bool { return false }},
		{Cmd: objc.Sel("canBecomeMainWindow"), Fn: func(objc.ID, objc.SEL) bool { return false }},
	}); err != nil {
		return err
	}
	target = objc.ID(clsTarget).Send(selNew)
	return nil
}

func register(name, super string, methods []pobjc.MethodDef) (objc.Class, error) {
	sc, err := objc.GetClass(super)
	if err != nil {
		return 0, err
	}
	return pobjc.RegisterClass(name, sc, nil, nil, methods)
}

func onAction(_ objc.ID, _ objc.SEL, sender objc.ID) {
	if fn := actions[sender]; fn != nil {
		fn(sender)
	}
}

func onTextChange(_ objc.ID, _ objc.SEL, note objc.ID) {
	if fn := textChanged[note.Send(selObject)]; fn != nil {
		fn()
	}
}

// onShouldClose pencere kapatma düğmesi: kayıtlı işleyici karar verir, pencereyi biz kapatırız (NO döner).
func onShouldClose(_ objc.ID, _ objc.SEL, w objc.ID) bool {
	if fn := closers[w]; fn != nil {
		fn()
		return false
	}
	return true
}

func onBecameKey(_ objc.ID, _ objc.SEL, note objc.ID) {
	if fn := becameKey[note.Send(selObject)]; fn != nil {
		fn()
	}
}

func onScreens(objc.ID, objc.SEL, objc.ID) {
	if screensHook != nil {
		screensHook()
	}
}

func onMoved(objc.ID, objc.SEL, objc.ID) {
	if movedHook != nil {
		movedHook()
	}
}

func onDraw(self objc.ID, _ objc.SEL) {
	if fn := drawers[self]; fn != nil {
		fn(self)
	}
}

// onButtonDown §5.2a m.1: basış olayı localClick koşullarıyla değerlendirilip kaydedilir; NSButton'ın izleme döngüsü
// (super mouseDown:) eylemi bırakmada, bu çağrının içinden gönderir. Döngü bitince kayıt silinir (bayat basış yok).
func onButtonDown(self objc.ID, _ objc.SEL, ev objc.ID) {
	downs[self] = input.EventClick(ev)
	self.SendSuper(selMouseDown, ev)
	delete(downs, self)
}

// nsstr güvenilmeyen ya da uzun metinden NSString (FFI kuralı 3): geçersiz UTF-8 "�" olur, MaxStringBytes'ta rün
// sınırında kesilir. Sınıf yoksa 0 (boş metin).
func nsstr(s string) objc.ID {
	s = clampText(s, textLimit)
	id, err := objc.NSString(s)
	if err != nil {
		return 0
	}
	return id
}

// clampText geçerli UTF-8'e çevirir ve n bayta rün sınırında keser.
func clampText(s string, n int) string {
	s = strings.ToValidUTF8(s, "�")
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

func goText(id objc.ID) string {
	s, err := objc.GoString(id)
	if err != nil {
		return ""
	}
	return s
}

func cls(name string) objc.ID {
	c, err := objc.GetClass(name)
	if err != nil {
		return 0
	}
	return objc.ID(c)
}

func sendBool(id objc.ID, sel objc.SEL, args ...any) bool {
	if id == 0 {
		return false
	}
	return pobjc.Send[bool](id, sel, args...)
}

func sendInt(id objc.ID, sel objc.SEL, args ...any) int {
	if id == 0 {
		return 0
	}
	return pobjc.Send[int](id, sel, args...)
}

func sendRect(id objc.ID, sel objc.SEL) objc.CGRect {
	if id == 0 {
		return objc.CGRect{}
	}
	return pobjc.Send[objc.CGRect](id, sel)
}
