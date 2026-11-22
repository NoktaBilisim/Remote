//go:build darwin

package input

import (
	"errors"
	"os"
	"sync"
	"unsafe"

	"remote-support/agent-win/internal/darwin/cgwin"
	"remote-support/agent-win/internal/darwin/objc"
)

// P33 K2 (mimari-p33 §6.4; S-P33-T-3): macQuery'nin macOS uygulaması. CG pencere listesi ortak cgwin paketinden;
// sayfa ve ön plan Accessibility (AX) ile okunur. Mac'te uzaktan kontrol zaten Erişilebilirlik izni ister (V-P33-A3).
// AX çağrıları Applier kilidi altında her tuş/tıklamada yapılır: süreç geneli AX ileti zaman aşımı kısa tutulur
// (axTimeout); zaman aşımı dahil her AX hatası olayı düşürür (fail-closed). Pencere başlığı okunmaz.

const axTimeout = 0.25 // saniye (AXUIElementSetMessagingTimeout; float32)

// AXValueType (AXValue.h).
const (
	axValueCGPoint = 1
	axValueCGSize  = 2
)

var errAX = errors.New("input: Accessibility sorgusu başarısız")

var ax struct {
	systemWide func() uintptr
	createApp  func(pid int32) uintptr
	copyAttr   func(el, attr uintptr, out *uintptr) int32
	getPid     func(el uintptr, pid *int32) int32
	setTimeout func(el uintptr, secs float32) int32
	valueGet   func(v uintptr, typ uint32, out unsafe.Pointer) bool
	valueTID   func() uintptr
	typeID     func(p uintptr) uintptr
	strTID     func() uintptr
	arrTID     func() uintptr
	count      func(a uintptr) int
	at         func(a uintptr, i int) uintptr
	release    func(p uintptr)

	sys uintptr // sistem geneli öğe (süreç ömrü)
	// süreç ömrü öznitelik adları (NSString ↔ CFString köprülü)
	focusedApp, focusedWin, role, pos, size, parent, windows, children objc.ID
}

var bindAX = sync.OnceValue(func() error {
	as, err := objc.Framework("ApplicationServices")
	if err != nil {
		return errors.Join(errAX, err)
	}
	cf, err := objc.Framework("CoreFoundation")
	if err != nil {
		return errors.Join(errAX, err)
	}
	if err := errors.Join(
		objc.Func(&ax.systemWide, as, "AXUIElementCreateSystemWide"),
		objc.Func(&ax.createApp, as, "AXUIElementCreateApplication"),
		objc.Func(&ax.copyAttr, as, "AXUIElementCopyAttributeValue"),
		objc.Func(&ax.getPid, as, "AXUIElementGetPid"),
		objc.Func(&ax.setTimeout, as, "AXUIElementSetMessagingTimeout"),
		objc.Func(&ax.valueGet, as, "AXValueGetValue"),
		objc.Func(&ax.valueTID, as, "AXValueGetTypeID"),
		objc.Func(&ax.typeID, cf, "CFGetTypeID"),
		objc.Func(&ax.strTID, cf, "CFStringGetTypeID"),
		objc.Func(&ax.arrTID, cf, "CFArrayGetTypeID"),
		objc.Func(&ax.count, cf, "CFArrayGetCount"),
		objc.Func(&ax.at, cf, "CFArrayGetValueAtIndex"),
		objc.Func(&ax.release, cf, "CFRelease"),
	); err != nil {
		return errors.Join(errAX, err)
	}
	if _, err := objc.Framework("Foundation"); err != nil {
		return errors.Join(errAX, err)
	}
	objc.Pool(func() {
		for _, a := range []struct {
			dst  *objc.ID
			name string
		}{{&ax.focusedApp, "AXFocusedApplication"}, {&ax.focusedWin, "AXFocusedWindow"}, {&ax.role, "AXRole"},
			{&ax.pos, "AXPosition"}, {&ax.size, "AXSize"}, {&ax.parent, "AXParent"}, {&ax.windows, "AXWindows"},
			{&ax.children, "AXChildren"}} {
			s, e := objc.NSString(a.name)
			if e != nil {
				err = e
				return
			}
			*a.dst = s.Send(objc.Sel("retain"))
		}
	})
	if err != nil {
		return errors.Join(errAX, err)
	}
	ax.sys = ax.systemWide()
	if ax.sys == 0 {
		return errAX
	}
	ax.setTimeout(ax.sys, axTimeout) // sistem geneli öğede: süreç geneli zaman aşımı
	return nil
})

// NewMacWindowAPI paylaşılan pencere (CGWindowID) için pencere kapsamı sorguları (deps_darwin.go SetInputWindow).
func NewMacWindowAPI(target uintptr) WindowAPI {
	return MacWindowAPI{q: macOSQuery{}, target: uint32(target)}
}

type macOSQuery struct{}

func toCG(w cgwin.Win) cgWin {
	return cgWin{ID: w.ID, PID: w.PID, Layer: w.Layer, OnScreen: w.OnScreen,
		B: FRect{X: w.Bounds.Origin.X, Y: w.Bounds.Origin.Y, W: w.Bounds.Size.W, H: w.Bounds.Size.H}}
}

func (macOSQuery) Win(id uint32) (cgWin, bool) {
	w, ok := cgwin.Get(id)
	return toCG(w), ok
}

func (macOSQuery) OnScreen() []cgWin {
	ws := cgwin.OnScreen()
	out := make([]cgWin, len(ws))
	for i, w := range ws {
		out[i] = toCG(w)
	}
	return out
}

func (macOSQuery) SelfPID() int32 { return int32(os.Getpid()) }

func (macOSQuery) Flags() uint64 {
	if bind() != nil {
		return flagShift | flagControl | flagAlternate | flagCommand // okunamazsa hepsi basılı (fail-closed)
	}
	return cg.flagsState(cgCombinedSessionStat)
}

func (macOSQuery) Cursor() (float64, float64, bool) { return cursorPos() }
func (macOSQuery) Sticky() bool                     { return StickyKeysOn() }
func (macOSQuery) MouseKeys() bool                  { return MouseKeysOn() }

// attr öğenin özniteliği (+1; çağıran bırakır). Hata ya da boş → 0.
func attr(el uintptr, name objc.ID) uintptr {
	var v uintptr
	if el == 0 || ax.copyAttr(el, uintptr(name), &v) != 0 {
		return 0
	}
	return v
}

// roleOf AXRole metni ("" okunamazsa).
func roleOf(el uintptr) string {
	v := attr(el, ax.role)
	if v == 0 {
		return ""
	}
	defer ax.release(v)
	if ax.typeID(v) != ax.strTID() {
		return ""
	}
	s, err := objc.GoString(objc.ID(v))
	if err != nil {
		return ""
	}
	return s
}

// frameOf AXPosition + AXSize (nokta; CG ile aynı uzay).
func frameOf(el uintptr) (FRect, bool) {
	var p objc.CGPoint
	var s objc.CGSize
	if !axValue(el, ax.pos, axValueCGPoint, unsafe.Pointer(&p)) || !axValue(el, ax.size, axValueCGSize, unsafe.Pointer(&s)) {
		return FRect{}, false
	}
	return FRect{X: p.X, Y: p.Y, W: s.W, H: s.H}, true
}

func axValue(el uintptr, name objc.ID, typ uint32, out unsafe.Pointer) bool {
	v := attr(el, name)
	if v == 0 {
		return false
	}
	defer ax.release(v)
	return ax.typeID(v) == ax.valueTID() && ax.valueGet(v, typ, out)
}

func (macOSQuery) Focused() (axWin, error) {
	if bindAX() != nil {
		return axWin{}, errAX
	}
	var out axWin
	var err error = errAX
	objc.Pool(func() {
		app := attr(ax.sys, ax.focusedApp)
		if app == 0 {
			return
		}
		defer ax.release(app)
		if ax.getPid(app, &out.PID) != 0 {
			return
		}
		win := attr(app, ax.focusedWin)
		if win == 0 {
			return
		}
		defer ax.release(win)
		out.Role = roleOf(win)
		f, ok := frameOf(win)
		if !ok || out.Role == "" {
			return
		}
		out.Frame = f
		if out.Role == axSheet {
			if p := attr(win, ax.parent); p != 0 {
				out.Parent, out.HasParent = frameOf(p)
				ax.release(p)
			}
		}
		err = nil
	})
	return out, err
}

func (macOSQuery) Sheets(pid int32, frame FRect) ([]FRect, error) {
	if bindAX() != nil || pid <= 0 {
		return nil, errAX
	}
	var out []FRect
	var err error = errAX
	objc.Pool(func() {
		app := ax.createApp(pid)
		if app == 0 {
			return
		}
		defer ax.release(app)
		wins := attr(app, ax.windows)
		if wins == 0 {
			return
		}
		defer ax.release(wins)
		if ax.typeID(wins) != ax.arrTID() {
			return
		}
		for i := range ax.count(wins) {
			w := ax.at(wins, i)
			if f, ok := frameOf(w); !ok || !sameFrame(f, frame) {
				continue
			}
			kids := attr(w, ax.children)
			if kids == 0 {
				continue
			}
			if ax.typeID(kids) == ax.arrTID() {
				for j := range ax.count(kids) {
					k := ax.at(kids, j)
					if roleOf(k) == axSheet {
						if f, ok := frameOf(k); ok {
							out = append(out, f)
						}
					}
				}
			}
			ax.release(kids)
		}
		err = nil
	})
	return out, err
}
