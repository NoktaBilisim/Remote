//go:build windows

package win

import (
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// AC-248 (P17 I4): pencere modu için üst düzey pencere sorguları — paylaşım listesi (EnumWindows) ve S17-1 girdi
// kapsamı (WindowFromPoint kökü, ön plan kökü, sahip zinciri, simge durumu, görünür sınırlar).

var (
	pIsIconic         = user32.NewProc("IsIconic")
	pWindowFromPoint  = user32.NewProc("WindowFromPoint")
	pGetWindow        = user32.NewProc("GetWindow")
	pGetWindowLongPtr = user32.NewProc("GetWindowLongPtrW")
	pGetWindowRect    = user32.NewProc("GetWindowRect")
)

// AC-248 paylaşım seçim ekranı denetimleri.
const (
	BS_AUTORADIOBUTTON = 0x0009
	WS_GROUP           = 0x00020000
	LB_RESETCONTENT    = 0x0184
)

const (
	gwOwner    = 4
	gwlExStyle = ^uintptr(19) // GWL_EXSTYLE = -20
	titleMax   = 256
	classMax   = 64
)

// TopWindow EnumWindows'un verdiği üst düzey pencerenin süzgeç için gereken özellikleri. Başlık yalnız yerel
// listede gösterilir; ağa, loga gönderilmez.
type TopWindow struct {
	HWND    uintptr
	Title   string
	PID     uint32
	Visible bool   // WS_VISIBLE
	Tool    bool   // WS_EX_TOOLWINDOW (görev çubuğunda olmayan yardımcı pencere)
	Cloaked bool   // DWM tarafından gizlenmiş (başka sanal masaüstü, askıdaki UWP)
	Iconic  bool   // simge durumunda
	Class   string // pencere sınıfı (S-P17-4: kabuk pencereleri listeden çıkarılır)
}

var (
	enumOnce sync.Once
	enumCB   uintptr
	enumMu   sync.Mutex
	enumOut  []uintptr
)

// TopWindows üst düzey pencereleri Z sırasıyla (üstteki önce) döner.
func TopWindows() []TopWindow {
	enumOnce.Do(func() {
		enumCB = windows.NewCallback(func(h uintptr, _ uintptr) uintptr {
			enumOut = append(enumOut, h) // enumMu altında (EnumWindows eşzamanlı çağırır)
			return 1
		})
	})
	enumMu.Lock()
	enumOut = enumOut[:0]
	_ = windows.EnumWindows(enumCB, nil)
	hs := append([]uintptr(nil), enumOut...)
	enumMu.Unlock()
	out := make([]TopWindow, 0, len(hs))
	for _, h := range hs {
		_, pid := ThreadProcess(h)
		out = append(out, TopWindow{HWND: h, Title: windowTitle(h), PID: pid,
			Visible: windows.IsWindowVisible(windows.HWND(h)), Tool: ExStyle(h)&WS_EX_TOOLWINDOW != 0,
			Cloaked: Cloaked(h), Iconic: IsIconic(h), Class: ClassName(h)})
	}
	return out
}

func windowTitle(h uintptr) string {
	buf := make([]uint16, titleMax)
	n, _, _ := pGetWindowTextW.Call(h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	return windows.UTF16ToString(buf[:n])
}

// IsWindow pencere hâlâ var mı.
func IsWindow(h uintptr) bool { return h != 0 && windows.IsWindow(windows.HWND(h)) }

// IsIconic pencere simge durumunda mı.
func IsIconic(h uintptr) bool {
	r, _, _ := pIsIconic.Call(h)
	return r != 0
}

// ExStyle GWL_EXSTYLE.
func ExStyle(h uintptr) uint32 {
	r, _, _ := pGetWindowLongPtr.Call(h, gwlExStyle)
	return uint32(r)
}

// Cloaked DWMWA_CLOAKED (sorgu başarısızsa false).
func Cloaked(h uintptr) bool {
	var v uint32
	if windows.DwmGetWindowAttribute(windows.HWND(h), windows.DWMWA_CLOAKED, unsafe.Pointer(&v), 4) != nil {
		return false
	}
	return v != 0
}

// ThreadProcess pencereyi oluşturan iş parçacığı ve süreç kimliği (pencere yoksa 0, 0).
func ThreadProcess(h uintptr) (tid, pid uint32) {
	tid, _ = windows.GetWindowThreadProcessId(windows.HWND(h), &pid)
	return tid, pid
}

// Owner GetWindow(GW_OWNER); sahipsizse 0.
func Owner(h uintptr) uintptr {
	r, _, _ := pGetWindow.Call(h, gwOwner)
	return r
}

// ClassName pencere sınıfı adı (ör. açılır menü "#32768").
func ClassName(h uintptr) string {
	buf := make([]uint16, classMax)
	n, err := windows.GetClassName(windows.HWND(h), &buf[0], int32(len(buf)))
	if err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:n])
}

// RootAt fiziksel ekran noktasındaki pencerenin kök (GA_ROOT) penceresi; nokta boşsa 0.
func RootAt(x, y int32) uintptr {
	var h uintptr
	if unsafe.Sizeof(uintptr(0)) == 8 { // POINT değerle: amd64/arm64'te tek yazmaç (X düşük 32 bit)
		h, _, _ = pWindowFromPoint.Call(uintptr(uint32(x)) | uintptr(uint32(y))<<32)
	} else {
		h, _, _ = pWindowFromPoint.Call(uintptr(x), uintptr(y))
	}
	if h == 0 {
		return 0
	}
	return Root(h)
}

// ForegroundRoot ön plandaki pencerenin kökü (yoksa 0).
func ForegroundRoot() uintptr {
	h := Foreground()
	if h == 0 {
		return 0
	}
	return Root(h)
}

// WindowBounds pencerenin görünen sınırları: DWM genişletilmiş çerçeve (WGC'nin yakaladığı alan, Windows 10'un
// görünmez yeniden boyutlandırma kenarı hariç); alınamazsa GetWindowRect.
func WindowBounds(h uintptr) (RECT, bool) {
	var r RECT
	if windows.DwmGetWindowAttribute(windows.HWND(h), windows.DWMWA_EXTENDED_FRAME_BOUNDS, unsafe.Pointer(&r),
		uint32(unsafe.Sizeof(r))) == nil && r.Right > r.Left && r.Bottom > r.Top {
		return r, true
	}
	if ok, _, _ := pGetWindowRect.Call(h, uintptr(unsafe.Pointer(&r))); ok == 0 || r.Right <= r.Left || r.Bottom <= r.Top {
		return RECT{}, false
	}
	return r, true
}

// B2U BOOL değerli mesaj parametresi (BM_SETCHECK).
func B2U(b bool) uintptr { return b2u(b) }
