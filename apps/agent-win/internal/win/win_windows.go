//go:build windows

package win

import (
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32  = windows.NewLazySystemDLL("user32.dll")
	gdi32   = windows.NewLazySystemDLL("gdi32.dll")
	shell32 = windows.NewLazySystemDLL("shell32.dll")

	pRegisterClassExW          = user32.NewProc("RegisterClassExW")
	pCreateWindowExW           = user32.NewProc("CreateWindowExW")
	pDefWindowProcW            = user32.NewProc("DefWindowProcW")
	pDestroyWindow             = user32.NewProc("DestroyWindow")
	pShowWindow                = user32.NewProc("ShowWindow")
	pGetMessageW               = user32.NewProc("GetMessageW")
	pTranslateMessage          = user32.NewProc("TranslateMessage")
	pDispatchMessageW          = user32.NewProc("DispatchMessageW")
	pPostMessageW              = user32.NewProc("PostMessageW")
	pSendMessageW              = user32.NewProc("SendMessageW")
	pPostQuitMessage           = user32.NewProc("PostQuitMessage")
	pSetWindowTextW            = user32.NewProc("SetWindowTextW")
	pGetWindowTextW            = user32.NewProc("GetWindowTextW")
	pGetWindowTextLengthW      = user32.NewProc("GetWindowTextLengthW")
	pEnableWindow              = user32.NewProc("EnableWindow")
	pSetWindowPos              = user32.NewProc("SetWindowPos")
	pSetTimer                  = user32.NewProc("SetTimer")
	pKillTimer                 = user32.NewProc("KillTimer")
	pIsDialogMessageW          = user32.NewProc("IsDialogMessageW")
	pGetAncestor               = user32.NewProc("GetAncestor")
	pSetFocus                  = user32.NewProc("SetFocus")
	pMessageBoxW               = user32.NewProc("MessageBoxW")
	pLoadCursorW               = user32.NewProc("LoadCursorW")
	pGetDpiForWindow           = user32.NewProc("GetDpiForWindow")
	pAdjustWindowRectExForDpi  = user32.NewProc("AdjustWindowRectExForDpi")
	pEnumDisplayMonitors       = user32.NewProc("EnumDisplayMonitors")
	pGetMonitorInfoW           = user32.NewProc("GetMonitorInfoW")
	pMonitorFromPoint          = user32.NewProc("MonitorFromPoint")
	pGetCursorPos              = user32.NewProc("GetCursorPos")
	pSetLayeredWindowAttribute = user32.NewProc("SetLayeredWindowAttributes")
	pSetWindowDisplayAffinity  = user32.NewProc("SetWindowDisplayAffinity")
	pGetWindowDisplayAffinity  = user32.NewProc("GetWindowDisplayAffinity")
	pBeginPaint                = user32.NewProc("BeginPaint")
	pEndPaint                  = user32.NewProc("EndPaint")
	pInvalidateRect            = user32.NewProc("InvalidateRect")
	pGetClientRect             = user32.NewProc("GetClientRect")
	pFillRect                  = user32.NewProc("FillRect")
	pDrawTextW                 = user32.NewProc("DrawTextW")
	pGetForegroundWindow       = user32.NewProc("GetForegroundWindow")
	pFlashWindow               = user32.NewProc("FlashWindow")
	pSetForegroundWindow       = user32.NewProc("SetForegroundWindow")
	pGetSysColor               = user32.NewProc("GetSysColor")
	pGetSysColorBrush          = user32.NewProc("GetSysColorBrush")
	pGetCurrentInputMsgSource  = user32.NewProc("GetCurrentInputMessageSource")

	pCreateFontW            = gdi32.NewProc("CreateFontW")
	pDeleteObject           = gdi32.NewProc("DeleteObject")
	pSelectObject           = gdi32.NewProc("SelectObject")
	pSetTextColor           = gdi32.NewProc("SetTextColor")
	pSetBkMode              = gdi32.NewProc("SetBkMode")
	pSetBkColor             = gdi32.NewProc("SetBkColor")
	pCreateSolidBrush       = gdi32.NewProc("CreateSolidBrush")
	pCreatePen              = gdi32.NewProc("CreatePen")
	pMoveToEx               = gdi32.NewProc("MoveToEx")
	pLineTo                 = gdi32.NewProc("LineTo")
	pRectangle              = gdi32.NewProc("Rectangle")
	pEllipse                = gdi32.NewProc("Ellipse")
	pExcludeClipRect        = gdi32.NewProc("ExcludeClipRect")
	pGetStockObject         = gdi32.NewProc("GetStockObject")
	pCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	pCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	pBitBlt                 = gdi32.NewProc("BitBlt")
	pDeleteDC               = gdi32.NewProc("DeleteDC")
	pCreateDIBSection       = gdi32.NewProc("CreateDIBSection")

	pShellExecuteW = shell32.NewProc("ShellExecuteW")
)

// Pencere mesajları ve sabitler (winuser.h).
const (
	WM_DESTROY          = 0x0002
	WM_SIZE             = 0x0005
	WM_ACTIVATE         = 0x0006
	WM_PAINT            = 0x000F
	WM_CLOSE            = 0x0010
	WM_ERASEBKGND       = 0x0014
	WM_SETFONT          = 0x0030
	WM_KEYDOWN          = 0x0100
	WM_KEYUP            = 0x0101
	WM_CHAR             = 0x0102
	WM_SYSKEYDOWN       = 0x0104
	WM_SYSCHAR          = 0x0106
	WM_LBUTTONDOWN      = 0x0201
	WM_LBUTTONUP        = 0x0202
	WM_LBUTTONDBLCLK    = 0x0203
	WM_COMMAND          = 0x0111
	WM_TIMER            = 0x0113
	WM_CTLCOLOREDIT     = 0x0133
	WM_CTLCOLORSTATIC   = 0x0138
	WM_DPICHANGED       = 0x02E0
	WM_APP              = 0x8000
	EM_SETSEL           = 0x00B1
	EM_SCROLLCARET      = 0x00B7
	EM_REPLACESEL       = 0x00C2
	EM_LIMITTEXT        = 0x00C5
	BM_GETCHECK         = 0x00F0
	BM_SETCHECK         = 0x00F1
	LB_ADDSTRING        = 0x0180
	LB_SETCURSEL        = 0x0186
	LB_GETCURSEL        = 0x0188
	BN_CLICKED          = 0
	EN_CHANGE           = 0x0300
	WS_OVERLAPPED       = 0x00000000
	WS_POPUP            = 0x80000000
	WS_CHILD            = 0x40000000
	WS_VISIBLE          = 0x10000000
	WS_CAPTION          = 0x00C00000
	WS_BORDER           = 0x00800000
	WS_SYSMENU          = 0x00080000
	WS_MINIMIZEBOX      = 0x00020000
	WS_VSCROLL          = 0x00200000
	WS_TABSTOP          = 0x00010000
	WS_EX_TOPMOST       = 0x00000008
	WS_EX_TRANSPARENT   = 0x00000020
	WS_EX_TOOLWINDOW    = 0x00000080
	WS_EX_CLIENTEDGE    = 0x00000200
	WS_EX_CONTROLPARENT = 0x00010000
	WS_EX_LAYERED       = 0x00080000
	WS_EX_NOACTIVATE    = 0x08000000
	ES_MULTILINE        = 0x0004
	ES_AUTOVSCROLL      = 0x0040
	ES_AUTOHSCROLL      = 0x0080
	ES_READONLY         = 0x0800
	BS_DEFPUSHBUTTON    = 0x0001
	BS_CHECKBOX         = 0x0002
	BS_AUTOCHECKBOX     = 0x0003
	BS_MULTILINE        = 0x2000
	SS_CENTER           = 0x0001
	SS_NOPREFIX         = 0x0080
	SS_BITMAP           = 0x000E
	SS_CENTERIMAGE      = 0x0200
	STM_SETIMAGE        = 0x0172
	IMAGE_BITMAP        = 0
	LBS_NOTIFY          = 0x0001
	SW_HIDE             = 0
	SW_SHOWNORMAL       = 1
	SW_SHOWNOACTIVATE   = 4
	SWP_NOSIZE          = 0x0001
	SWP_NOMOVE          = 0x0002
	SWP_NOZORDER        = 0x0004
	SWP_NOACTIVATE      = 0x0010
	SWP_SHOWWINDOW      = 0x0040
	HWND_TOPMOST        = ^uintptr(0) // (HWND)-1
	GA_ROOT             = 2
	IDOK                = 1
	IDCANCEL            = 2
	IDYES               = 6
	MB_OK               = 0x0
	MB_YESNO            = 0x4
	MB_ICONERROR        = 0x10
	MB_ICONQUESTION     = 0x20
	MB_DEFBUTTON2       = 0x100
	MB_TOPMOST          = 0x40000
	VK_RETURN           = 0x0D
	VK_SPACE            = 0x20
	COLOR_WINDOW        = 5
	COLOR_WINDOWTEXT    = 8
	TRANSPARENT         = 1
	LWA_COLORKEY        = 0x1
	LWA_ALPHA           = 0x2
	WDA_EXCLUDEFROMCAP  = 0x11
	DT_CENTER           = 0x1
	DT_VCENTER          = 0x4
	DT_SINGLELINE       = 0x20
	DT_NOPREFIX         = 0x800
	NULL_BRUSH          = 5
	PS_SOLID            = 0
	SRCCOPY             = 0x00CC0020
	MONITOR_PRIMARY     = 0x1
	MONITOR_NEAREST     = 0x2
	IDC_ARROW           = 32512
	FW_NORMAL           = 400
	FW_SEMIBOLD         = 600
)

// POINT / RECT / MSG / WNDCLASSEXW / MONITORINFOEXW / PAINTSTRUCT — amd64 düzeni.
type POINT struct{ X, Y int32 }

type RECT struct{ Left, Top, Right, Bottom int32 }

// Contains nokta dikdörtgenin içinde mi.
func (r RECT) Contains(p POINT) bool {
	return p.X >= r.Left && p.X < r.Right && p.Y >= r.Top && p.Y < r.Bottom
}

type MSG struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      POINT
	Private uint32
}

type WNDCLASSEXW struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type MONITORINFOEXW struct {
	Size    uint32
	Monitor RECT
	Work    RECT
	Flags   uint32
	Device  [32]uint16
}

type PAINTSTRUCT struct {
	HDC       uintptr
	Erase     int32
	Paint     RECT
	Restore   int32
	IncUpdate int32
	Reserved  [32]byte
}

// BITMAPINFOHEADER (wingdi.h); renk tablosuz 24 bit DIB için BITMAPINFO ile aynı düzen.
type BITMAPINFOHEADER struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// Str UTF-16 işaretçisi (NUL içeren metin boş döner).
func Str(s string) *uint16 {
	p, err := windows.UTF16PtrFromString(s)
	if err != nil {
		p, _ = windows.UTF16PtrFromString("")
	}
	return p
}

func b2u(b bool) uintptr {
	if b {
		return 1
	}
	return 0
}

// RGB COLORREF.
func RGB(r, g, b byte) uint32 { return uint32(r) | uint32(g)<<8 | uint32(b)<<16 }

// RegisterClass pencere sınıfı kaydeder.
func RegisterClass(name string, proc uintptr, bg uintptr) error {
	cursor, _, _ := pLoadCursorW.Call(0, IDC_ARROW)
	wc := WNDCLASSEXW{WndProc: proc, Cursor: cursor, Background: bg, ClassName: Str(name)}
	wc.Size = uint32(unsafe.Sizeof(wc))
	if r, _, err := pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return err
	}
	return nil
}

// CreateWindow CreateWindowExW.
func CreateWindow(exStyle uint32, class, title string, style uint32, x, y, w, h int32, parent, id uintptr) uintptr {
	c, t := Str(class), Str(title)
	r, _, _ := pCreateWindowExW.Call(uintptr(exStyle), uintptr(unsafe.Pointer(c)), uintptr(unsafe.Pointer(t)),
		uintptr(style), uintptr(x), uintptr(y), uintptr(w), uintptr(h), parent, id, 0, 0)
	return r
}

func DefWindowProc(h uintptr, msg uint32, w, l uintptr) uintptr {
	r, _, _ := pDefWindowProcW.Call(h, uintptr(msg), w, l)
	return r
}

func DestroyWindow(h uintptr)           { _, _, _ = pDestroyWindow.Call(h) }
func ShowWindow(h uintptr, cmd int)     { _, _, _ = pShowWindow.Call(h, uintptr(cmd)) }
func PostQuitMessage()                  { _, _, _ = pPostQuitMessage.Call(0) }
func SetFocus(h uintptr)                { _, _, _ = pSetFocus.Call(h) }
func EnableWindow(h uintptr, on bool)   { _, _, _ = pEnableWindow.Call(h, b2u(on)) }
func KillTimer(h uintptr, id uintptr)   { _, _, _ = pKillTimer.Call(h, id) }
func SetForegroundWindow(h uintptr)     { _, _, _ = pSetForegroundWindow.Call(h) }
func FlashWindow(h uintptr)             { _, _, _ = pFlashWindow.Call(h, 1) }
func SetTimer(h, id uintptr, ms uint32) { _, _, _ = pSetTimer.Call(h, id, uintptr(ms), 0) }
func Invalidate(h uintptr)              { _, _, _ = pInvalidateRect.Call(h, 0, 0) }

func GetMessage(m *MSG) int32 {
	r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(m)), 0, 0, 0)
	return int32(r)
}

func TranslateDispatch(m *MSG) {
	_, _, _ = pTranslateMessage.Call(uintptr(unsafe.Pointer(m)))
	_, _, _ = pDispatchMessageW.Call(uintptr(unsafe.Pointer(m)))
}

func IsDialogMessage(h uintptr, m *MSG) bool {
	r, _, _ := pIsDialogMessageW.Call(h, uintptr(unsafe.Pointer(m)))
	return r != 0
}

// InputOrigin S7-5/S7-12: şu an işlenen girdi mesajının INPUT_MESSAGE_SOURCE.originId değeri
// (GetCurrentInputMessageSource, Windows 8+), yorumsuz. ok=false: API yok veya çağrı başarısız. Karar (yalnız
// IMO_HARDWARE yerel) platformdan bağımsız control.OriginInjected / control.CharInjected'dadır.
func InputOrigin() (origin uint32, ok bool) {
	if pGetCurrentInputMsgSource.Find() != nil {
		return 0, false
	}
	var src struct{ DeviceType, OriginID uint32 }
	r, _, _ := pGetCurrentInputMsgSource.Call(uintptr(unsafe.Pointer(&src)))
	if r == 0 {
		return 0, false
	}
	return src.OriginID, true
}

func Root(h uintptr) uintptr {
	r, _, _ := pGetAncestor.Call(h, GA_ROOT)
	return r
}

func PostMessage(h uintptr, msg uint32, w, l uintptr) {
	_, _, _ = pPostMessageW.Call(h, uintptr(msg), w, l)
}

func SendMessage(h uintptr, msg uint32, w, l uintptr) uintptr {
	r, _, _ := pSendMessageW.Call(h, uintptr(msg), w, l)
	return r
}

// SendMessageStr metin parametreli mesaj (EM_REPLACESEL, LB_ADDSTRING).
func SendMessageStr(h uintptr, msg uint32, w uintptr, s string) uintptr {
	p := Str(s)
	r, _, _ := pSendMessageW.Call(h, uintptr(msg), w, uintptr(unsafe.Pointer(p)))
	return r
}

func SetText(h uintptr, s string) {
	p := Str(s)
	_, _, _ = pSetWindowTextW.Call(h, uintptr(unsafe.Pointer(p)))
}

func GetText(h uintptr) string {
	n, _, _ := pGetWindowTextLengthW.Call(h)
	buf := make([]uint16, n+1)
	_, _, _ = pGetWindowTextW.Call(h, uintptr(unsafe.Pointer(&buf[0])), n+1)
	return windows.UTF16ToString(buf)
}

func SetWindowPos(h, after uintptr, x, y, w, hh int32, flags uint32) {
	_, _, _ = pSetWindowPos.Call(h, after, uintptr(x), uintptr(y), uintptr(w), uintptr(hh), uintptr(flags))
}

// MessageBox modal Win32 kutusu.
func MessageBox(owner uintptr, text, title string, flags uint32) int {
	tx, ti := Str(text), Str(title)
	r, _, _ := pMessageBoxW.Call(owner, uintptr(unsafe.Pointer(tx)), uintptr(unsafe.Pointer(ti)), uintptr(flags))
	return int(r)
}

// DPI pencerenin DPI'ı (PerMonitorV2); desteklenmezse 96.
func DPI(h uintptr) int {
	if pGetDpiForWindow.Find() != nil {
		return 96
	}
	r, _, _ := pGetDpiForWindow.Call(h)
	if r == 0 {
		return 96
	}
	return int(r)
}

// AdjustRect istemci alanından pencere boyutu.
func AdjustRect(r *RECT, style, exStyle uint32, dpi int) {
	if pAdjustWindowRectExForDpi.Find() != nil {
		return
	}
	_, _, _ = pAdjustWindowRectExForDpi.Call(uintptr(unsafe.Pointer(r)), uintptr(style), 0, uintptr(exStyle), uintptr(dpi))
}

// Monitor bir ekranın fiziksel koordinatları.
type Monitor struct {
	Rect    RECT
	Work    RECT
	Primary bool
	Device  string
}

var (
	monMu   sync.Mutex
	monOut  []Monitor
	monOnce sync.Once
	monCB   uintptr
)

// Monitors EnumDisplayMonitors sırasıyla ekranlar. Geri çağrı bir kez oluşturulur (NewCallback sınırlı kaynak).
func Monitors() []Monitor {
	monOnce.Do(func() {
		monCB = windows.NewCallback(func(hm, _, _, _ uintptr) uintptr {
			var mi MONITORINFOEXW
			mi.Size = uint32(unsafe.Sizeof(mi))
			if r, _, _ := pGetMonitorInfoW.Call(hm, uintptr(unsafe.Pointer(&mi))); r != 0 {
				monOut = append(monOut, Monitor{Rect: mi.Monitor, Work: mi.Work, Primary: mi.Flags&MONITOR_PRIMARY != 0,
					Device: windows.UTF16ToString(mi.Device[:])})
			}
			return 1
		})
	})
	monMu.Lock()
	defer monMu.Unlock()
	monOut = nil
	_, _, _ = pEnumDisplayMonitors.Call(0, 0, monCB, 0)
	return append([]Monitor(nil), monOut...)
}

// CursorPos imleç konumu.
func CursorPos() POINT {
	var p POINT
	_, _, _ = pGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	return p
}

// WorkAreaAt noktanın bulunduğu ekranın çalışma alanı.
func WorkAreaAt(p POINT) RECT {
	var hm uintptr
	if unsafe.Sizeof(uintptr(0)) == 8 { // POINT değerle: amd64/arm64'te tek yazmaç (RootAt ile aynı)
		hm, _, _ = pMonitorFromPoint.Call(uintptr(uint32(p.X))|uintptr(uint32(p.Y))<<32, MONITOR_NEAREST)
	} else {
		hm, _, _ = pMonitorFromPoint.Call(uintptr(p.X), uintptr(p.Y), MONITOR_NEAREST)
	}
	var mi MONITORINFOEXW
	mi.Size = uint32(unsafe.Sizeof(mi))
	_, _, _ = pGetMonitorInfoW.Call(hm, uintptr(unsafe.Pointer(&mi)))
	return mi.Work
}

// SetLayered katmanlı pencere: renk anahtarı ve/veya alfa.
func SetLayered(h uintptr, key uint32, alpha byte, flags uint32) {
	_, _, _ = pSetLayeredWindowAttribute.Call(h, uintptr(key), uintptr(alpha), uintptr(flags))
}

// ExcludeFromCapture pencereyi ekran yakalamadan hariç tutar (Win10 2004+; eski sürümde etkisiz).
func ExcludeFromCapture(h uintptr) {
	_, _, _ = pSetWindowDisplayAffinity.Call(h, WDA_EXCLUDEFROMCAP)
}

// DisplayAffinity GetWindowDisplayAffinity (P30 testleri: katman yakalamadan hariç mi); sorgu başarısızsa 0.
func DisplayAffinity(h uintptr) uint32 {
	var v uint32
	if r, _, _ := pGetWindowDisplayAffinity.Call(h, uintptr(unsafe.Pointer(&v))); r == 0 {
		return 0
	}
	return v
}

func BeginPaint(h uintptr, ps *PAINTSTRUCT) uintptr {
	r, _, _ := pBeginPaint.Call(h, uintptr(unsafe.Pointer(ps)))
	return r
}

func EndPaint(h uintptr, ps *PAINTSTRUCT) { _, _, _ = pEndPaint.Call(h, uintptr(unsafe.Pointer(ps))) }

func ClientRect(h uintptr) RECT {
	var r RECT
	_, _, _ = pGetClientRect.Call(h, uintptr(unsafe.Pointer(&r)))
	return r
}

func FillRect(dc uintptr, r *RECT, brush uintptr) {
	_, _, _ = pFillRect.Call(dc, uintptr(unsafe.Pointer(r)), brush)
}

func DrawText(dc uintptr, s string, r *RECT, format uint32) {
	p := Str(s)
	_, _, _ = pDrawTextW.Call(dc, uintptr(unsafe.Pointer(p)), ^uintptr(0), uintptr(unsafe.Pointer(r)), uintptr(format))
}

func Foreground() uintptr {
	r, _, _ := pGetForegroundWindow.Call()
	return r
}

func SysColor(i int) uint32 {
	r, _, _ := pGetSysColor.Call(uintptr(i))
	return uint32(r)
}

func SysColorBrush(i int) uintptr {
	r, _, _ := pGetSysColorBrush.Call(uintptr(i))
	return r
}

// Font Segoe UI; height piksel (negatif = karakter yüksekliği).
func Font(height int32, weight int) uintptr {
	face := Str("Segoe UI")
	r, _, _ := pCreateFontW.Call(uintptr(height), 0, 0, 0, uintptr(weight), 0, 0, 0, 1 /*DEFAULT_CHARSET*/, 0, 0,
		5 /*CLEARTYPE_QUALITY*/, 0, uintptr(unsafe.Pointer(face)))
	return r
}

func DeleteObject(h uintptr)            { _, _, _ = pDeleteObject.Call(h) }
func SetTextColor(dc uintptr, c uint32) { _, _, _ = pSetTextColor.Call(dc, uintptr(c)) }
func SetBkMode(dc uintptr, mode int)    { _, _, _ = pSetBkMode.Call(dc, uintptr(mode)) }
func SetBkColor(dc uintptr, c uint32)   { _, _, _ = pSetBkColor.Call(dc, uintptr(c)) }
func MoveTo(dc uintptr, x, y int32)     { _, _, _ = pMoveToEx.Call(dc, uintptr(x), uintptr(y), 0) }
func LineTo(dc uintptr, x, y int32)     { _, _, _ = pLineTo.Call(dc, uintptr(x), uintptr(y)) }
func DeleteDC(dc uintptr)               { _, _, _ = pDeleteDC.Call(dc) }
func Rectangle(dc uintptr, l, t, r, b int32) {
	_, _, _ = pRectangle.Call(dc, uintptr(l), uintptr(t), uintptr(r), uintptr(b))
}

// ExcludeClipRect dikdörtgeni DC'nin kırpma bölgesinden çıkarır (P30: işaretleme göstergenin üstüne boyamaz).
func ExcludeClipRect(dc uintptr, l, t, r, b int32) {
	_, _, _ = pExcludeClipRect.Call(dc, uintptr(l), uintptr(t), uintptr(r), uintptr(b))
}
func Ellipse(dc uintptr, l, t, r, b int32) {
	_, _, _ = pEllipse.Call(dc, uintptr(l), uintptr(t), uintptr(r), uintptr(b))
}

func SelectObject(dc, obj uintptr) uintptr {
	r, _, _ := pSelectObject.Call(dc, obj)
	return r
}

func SolidBrush(c uint32) uintptr {
	r, _, _ := pCreateSolidBrush.Call(uintptr(c))
	return r
}

func Pen(width int32, c uint32) uintptr {
	r, _, _ := pCreatePen.Call(PS_SOLID, uintptr(width), uintptr(c))
	return r
}

func StockObject(i int) uintptr {
	r, _, _ := pGetStockObject.Call(uintptr(i))
	return r
}

func CompatibleDC(dc uintptr) uintptr {
	r, _, _ := pCreateCompatibleDC.Call(dc)
	return r
}

func CompatibleBitmap(dc uintptr, w, h int32) uintptr {
	r, _, _ := pCreateCompatibleBitmap.Call(dc, uintptr(w), uintptr(h))
	return r
}

func BitBlt(dst uintptr, x, y, w, h int32, src uintptr) {
	_, _, _ = pBitBlt.Call(dst, uintptr(x), uintptr(y), uintptr(w), uintptr(h), src, 0, 0, SRCCOPY)
}

// OpenMailto yalnız `mailto:` adresini varsayılan e-posta istemcisiyle açar (AC-125). Adres çağıranda
// api.ValidAbuseEmail ile doğrulanmış olmalı (S6-7).
func OpenMailto(addr string) {
	verb, target := Str("open"), Str("mailto:"+addr)
	_, _, _ = pShellExecuteW.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, SW_SHOWNORMAL)
}

// OpenURL yalnız `https://` adresini varsayılan tarayıcıda açar (ADR-0004 r3 eki: çağıran yalnız
// request.DownloadURL'in sabit biçimli adresini verir).
func OpenURL(u string) {
	if !strings.HasPrefix(u, "https://") || strings.ContainsAny(u, " \"\r\n\t") {
		return
	}
	verb, target := Str("open"), Str(u)
	_, _, _ = pShellExecuteW.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(target)), 0, 0, SW_SHOWNORMAL)
}

// Bitmap24 yukarıdan aşağı 24 bit DIB section oluşturur ve satırları (BGR, satır başına `(w*3+3)&^3` bayt) kopyalar.
// Sahibi çağırandır (DeleteObject). Hata/uyumsuz uzunlukta 0 döner.
func Bitmap24(w, h int32, bgr []byte) uintptr {
	stride := (int(w)*3 + 3) &^ 3
	if w <= 0 || h <= 0 || len(bgr) != stride*int(h) {
		return 0
	}
	bi := BITMAPINFOHEADER{Width: w, Height: -h, Planes: 1, BitCount: 24}
	bi.Size = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	hb, _, _ := pCreateDIBSection.Call(0, uintptr(unsafe.Pointer(&bi)), 0 /*DIB_RGB_COLORS*/, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if hb == 0 || bits == nil {
		return 0
	}
	copy(unsafe.Slice((*byte)(bits), len(bgr)), bgr)
	return hb
}
