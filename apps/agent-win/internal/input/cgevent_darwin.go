//go:build darwin

package input

import (
	"errors"
	"math"
	"sync"
	"time"

	"remote-support/agent-win/internal/darwin/objc"
)

// P28f K3 (ADR-0037 m.3, mimari-p28f §2 `input/*_darwin`): CGEvent enjeksiyonu. Çeviri inject_mac.go'da (saf, testli);
// burada yalnız CoreGraphics çağrıları. Olaylar NULL kaynakla (kCGEventSourceStateID = 0) kurulur ve HID konumuna
// gönderilir (spike K0s-3: ±0,00 px); her olaya kCGEventSourceUserData = Marker() yazılır (localClick m.4 ve olay
// musluğu bunu tanır). Sistem her sentetik olaya gönderenin PID'ini yazar (localClick m.3).
//
// FFI (S-P28f-11): semboller yalnız izin listeli mutlak yoldan (objc.Framework) ve objc.Func ile (panik yok); bağlama
// hatası → enjektör/kontrol yok (fail-closed). Go işaretçisi yalnız çağrı argümanı olarak geçer.

// CGEvent alan numaraları (CGEventTypes.h CGEventField).
const (
	fieldClickState = 1
	fieldSourcePID  = 41
	fieldUserData   = 42
	fieldStateID    = 45
)

const (
	cgHIDEventTap         = 0
	cgScrollUnitPixel     = 0
	cgCombinedSessionStat = 0 // kCGEventSourceStateCombinedSessionState
)

var (
	errBind     = errors.New("input: CoreGraphics bağlanamadı")
	errNoMarker = errors.New("input: olay işareti üretilemedi")
)

// cg CoreGraphics / CoreFoundation / ApplicationServices / Carbon işlevleri (bind ile bir kez bağlanır).
var cg struct {
	createMouse   func(src uintptr, typ uint32, p objc.CGPoint, btn uint32) uintptr
	createKey     func(src uintptr, vk uint16, down bool) uintptr
	createScroll  func(src uintptr, units, count uint32, w1, w2, w3 int32) uintptr
	create        func(src uintptr) uintptr
	location      func(ev uintptr) objc.CGPoint
	setType       func(ev uintptr, typ uint32)
	setFlags      func(ev uintptr, f uint64)
	setInt        func(ev uintptr, field uint32, v int64)
	getInt        func(ev uintptr, field uint32) int64
	setUnicode    func(ev uintptr, n uint, s *uint16)
	post          func(tap uint32, ev uintptr)
	flagsState    func(state int32) uint64
	activeDisps   func(maxN uint32, ids *uint32, n *uint32) int32
	displayBounds func(id uint32) objc.CGRect
	tapCreate     func(tap, place, opt uint32, mask uint64, cb uintptr, ref uintptr) uintptr
	tapEnable     func(tap uintptr, on bool)
	tapIsEnabled  func(tap uintptr) bool

	release        func(p uintptr)
	portSource     func(alloc uintptr, port uintptr, order int) uintptr
	portInvalidate func(port uintptr)
	rlCurrent      func() uintptr
	rlAddSource    func(rl, src, mode uintptr)
	rlRemoveSource func(rl, src, mode uintptr)
	rlRunInMode    func(mode uintptr, secs float64, returnAfter bool) int32
	defaultMode    uintptr

	axTrusted func() bool

	appTarget      func() uintptr
	installHandler func(target, handler uintptr, n uint32, types *eventTypeSpec, ud uintptr, out *uintptr) int32
	registerHotKey func(code, mods uint32, id hotKeyID, target uintptr, opts uint32, out *uintptr) int32
	unregisterHK   func(ref uintptr) int32
}

var (
	bindOnce sync.Once
	bindErr  error
)

// bind işlevleri bir kez bağlar; herhangi biri eksikse hata (kontrol verilmez).
func bind() error {
	bindOnce.Do(func() { bindErr = bindAll() })
	return bindErr
}

func bindAll() error {
	libs := map[string]uintptr{}
	for _, fw := range []string{"CoreGraphics", "CoreFoundation", "ApplicationServices", "Carbon"} {
		h, err := objc.Framework(fw)
		if err != nil {
			return errors.Join(errBind, err)
		}
		libs[fw] = h
	}
	g, f := libs["CoreGraphics"], libs["CoreFoundation"]
	syms := []struct {
		fn   any
		lib  uintptr
		name string
	}{
		{&cg.createMouse, g, "CGEventCreateMouseEvent"},
		{&cg.createKey, g, "CGEventCreateKeyboardEvent"},
		{&cg.createScroll, g, "CGEventCreateScrollWheelEvent2"}, // değişken argümanlı sürüm purego'da güvenli değil
		{&cg.create, g, "CGEventCreate"},
		{&cg.location, g, "CGEventGetLocation"},
		{&cg.setType, g, "CGEventSetType"},
		{&cg.setFlags, g, "CGEventSetFlags"},
		{&cg.setInt, g, "CGEventSetIntegerValueField"},
		{&cg.getInt, g, "CGEventGetIntegerValueField"},
		{&cg.setUnicode, g, "CGEventKeyboardSetUnicodeString"},
		{&cg.post, g, "CGEventPost"},
		{&cg.flagsState, g, "CGEventSourceFlagsState"},
		{&cg.activeDisps, g, "CGGetActiveDisplayList"},
		{&cg.displayBounds, g, "CGDisplayBounds"},
		{&cg.tapCreate, g, "CGEventTapCreate"},
		{&cg.tapEnable, g, "CGEventTapEnable"},
		{&cg.tapIsEnabled, g, "CGEventTapIsEnabled"},
		{&cg.release, f, "CFRelease"},
		{&cg.portSource, f, "CFMachPortCreateRunLoopSource"},
		{&cg.portInvalidate, f, "CFMachPortInvalidate"},
		{&cg.rlCurrent, f, "CFRunLoopGetCurrent"},
		{&cg.rlAddSource, f, "CFRunLoopAddSource"},
		{&cg.rlRemoveSource, f, "CFRunLoopRemoveSource"},
		{&cg.rlRunInMode, f, "CFRunLoopRunInMode"},
		{&cg.axTrusted, libs["ApplicationServices"], "AXIsProcessTrusted"},
		{&cg.appTarget, libs["Carbon"], "GetApplicationEventTarget"},
		{&cg.installHandler, libs["Carbon"], "InstallEventHandler"},
		{&cg.registerHotKey, libs["Carbon"], "RegisterEventHotKey"},
		{&cg.unregisterHK, libs["Carbon"], "UnregisterEventHotKey"},
	}
	for _, s := range syms {
		if err := objc.Func(s.fn, s.lib, s.name); err != nil {
			return errors.Join(errBind, err)
		}
	}
	mode, err := objc.Symbol(f, "kCFRunLoopDefaultMode")
	if err != nil || mode == 0 {
		return errors.Join(errBind, err)
	}
	cg.defaultMode = mode
	return nil
}

// CGInjector Injector'ın macOS uygulaması (Windows SendInputInjector'ın karşılığı).
type CGInjector struct {
	mu sync.Mutex
	t  *macTranslator
}

// NewCGInjector CoreGraphics'i bağlar; bağlanamaz ya da olay işareti yoksa hata (kontrol verilmez).
func NewCGInjector() (*CGInjector, error) {
	if err := bind(); err != nil {
		return nil, err
	}
	if marker == 0 {
		return nil, errNoMarker
	}
	return &CGInjector{t: newMacTranslator(time.Now, func() uint64 { return cg.flagsState(cgCombinedSessionStat) })}, nil
}

// SetVirtual Applier.SetTarget'e verilen sanal masaüstü dikdörtgeni (aynı değer; ters çevirme için).
func (c *CGInjector) SetVirtual(v Rect) {
	c.mu.Lock()
	c.t.virt = v
	c.mu.Unlock()
}

// Inject olayları çevirip sırayla HID konumuna gönderir. Kurulamayan olay atlanır ve hata döner.
func (c *CGInjector) Inject(evs []Event) error {
	c.mu.Lock()
	defer c.mu.Unlock() // çeviri durumu ile gönderim sırası birlikte korunur
	var err error
	for _, m := range c.t.translate(evs) {
		if !postMac(m) {
			err = errPartialMac
		}
	}
	return err
}

var errPartialMac = errors.New("input: CGEvent kurulamadı")

func postMac(m macEvent) bool {
	var ev uintptr
	switch m.typ {
	case cgKeyDown, cgKeyUp, cgFlagsChanged:
		ev = cg.createKey(0, m.vk, m.down)
		if ev == 0 {
			return false
		}
		cg.setType(ev, m.typ)
		if len(m.text) > 0 {
			cg.setUnicode(ev, uint(len(m.text)), &m.text[0])
		}
	case cgScrollWheel:
		ev = cg.createScroll(0, cgScrollUnitPixel, 2, m.wheelY, m.wheelX, 0)
	default:
		p := objc.CGPoint{X: m.x, Y: m.y}
		if m.here {
			cur := cg.create(0)
			if cur == 0 {
				return false
			}
			p = cg.location(cur)
			cg.release(cur)
		}
		ev = cg.createMouse(0, m.typ, p, m.button)
		if ev != 0 && m.click > 0 {
			cg.setInt(ev, fieldClickState, m.click)
		}
	}
	if ev == 0 {
		return false
	}
	cg.setFlags(ev, m.flags)
	cg.setInt(ev, fieldUserData, marker)
	cg.post(cgHIDEventTap, ev)
	cg.release(ev)
	return true
}

// VirtualScreen etkin ekranların birleşimi, nokta (point) koordinatında; birincil ekranın sol üstü (0,0), diğer
// ekranlar negatif olabilir. Bağlanamazsa boş dikdörtgen (Applier hedefsiz → fare olayı üretmez).
func VirtualScreen() Rect {
	var r Rect
	for i, b := range displayRects() {
		if i == 0 {
			r = b
			continue
		}
		r.Left, r.Top = min(r.Left, b.Left), min(r.Top, b.Top)
		r.Right, r.Bottom = max(r.Right, b.Right), max(r.Bottom, b.Bottom)
	}
	return r
}

// DisplayRect CGDirectDisplayID'nin sınırları (nokta). Ekran etkin değilse false.
func DisplayRect(id uint32) (Rect, bool) {
	if bind() != nil {
		return Rect{}, false
	}
	for _, d := range activeDisplays() {
		if d == id {
			return rectOf(cg.displayBounds(id)), true
		}
	}
	return Rect{}, false
}

func activeDisplays() []uint32 {
	var ids [32]uint32
	var n uint32
	if cg.activeDisps(uint32(len(ids)), &ids[0], &n) != 0 {
		return nil
	}
	return append([]uint32(nil), ids[:min(int(n), len(ids))]...)
}

func displayRects() []Rect {
	if bind() != nil {
		return nil
	}
	var out []Rect
	for _, id := range activeDisplays() {
		out = append(out, rectOf(cg.displayBounds(id)))
	}
	return out
}

func rectOf(b objc.CGRect) Rect {
	l, t := int32(math.Round(b.Origin.X)), int32(math.Round(b.Origin.Y))
	return Rect{Left: l, Top: t, Right: l + int32(math.Round(b.Size.W)), Bottom: t + int32(math.Round(b.Size.H))}
}
