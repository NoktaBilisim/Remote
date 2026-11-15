//go:build windows && (amd64 || arm64)

package capture

import (
	"errors"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/win"
)

// AC-248 (P17 I4): "Yalnız bir pencere" kaynağı. I0 prototipi (wgc_windows.go) grabber arayüzüne bağlanır:
// pencere simge durumundayken siyah kare + "Pencere simge durumunda" kaplaması verilir; pencere kapanınca
// WINDOW_CLOSED kalıcı hatası döner (paylaşım durur, share.state stopped). WGC kirli bölge bildirmez (damager yok):
// her kare tam dönüştürülür. İmleç WGC tarafından kareye çizilir (cursor() nil).

const (
	hrClassNotReg     uint32 = 0x80040154 // REGDB_E_CLASSNOTREG
	iconicText               = "Pencere simge durumunda"
	iconicDefaultW           = 1280
	iconicDefaultH           = 720
	opWindowGone             = "IsWindow"
	opWGCSupported           = "WGC.IsSupported"
	opCreateForWindow        = "CreateForWindow"
)

var (
	wgcOnce sync.Once
	wgcOK   bool
)

// WindowCaptureSupported pencere modu bu sistemde kullanılabilir mi (GraphicsCaptureSession.IsSupported). Sonuç
// süreç boyunca önbelleklenir; sorgu kendi COM (MTA) iş parçacığında yapılır, çağıranın iş parçacığına dokunmaz.
func WindowCaptureSupported() bool {
	wgcOnce.Do(func() {
		done := make(chan bool, 1)
		go func() {
			runtime.LockOSThread() // bilerek açılmaz (source.run ile aynı kural)
			err := windows.CoInitializeEx(0, windows.COINIT_MULTITHREADED)
			if err != nil && !errors.Is(err, syscall.Errno(1)) {
				done <- false
				return
			}
			defer windows.CoUninitialize()
			ok, err := wgcSupported()
			done <- err == nil && ok
		}()
		wgcOK = <-done
	})
	return wgcOK
}

// openWGCGrabber hwnd için WGC kaynağını açar ve hatayı pencere nedenine sınıflandırır.
func openWGCGrabber(hwnd uintptr) (grabber, error) {
	if !win.IsWindow(hwnd) {
		return nil, &Error{Reason: ReasonWindowClosed, Op: opWindowGone, Method: MethodWGC}
	}
	ok, err := wgcSupported()
	if e, isE := AsError(err); (isE && e.HR == hrClassNotReg) || (err == nil && !ok) {
		return nil, &Error{Reason: ReasonWGCUnsupported, Op: opWGCSupported, HR: hrOf(err), Method: MethodWGC}
	}
	if err != nil {
		return nil, withMethod(asErr(err, opWGCSupported), MethodWGC)
	}
	c, err := openWGCWindow(hwnd)
	if err != nil {
		e := asErr(err, "OpenWGC")
		switch {
		case !win.IsWindow(hwnd):
			e.Reason = ReasonWindowClosed
		case e.Op == opCreateForWindow: // E_INVALIDARG/E_ACCESSDENIED: alt pencere, başka masaüstü, korumalı
			e.Reason = ReasonWindowUnavailable
		}
		return nil, withMethod(e, MethodWGC)
	}
	return &wgcGrabber{hwnd: hwnd, c: c}, nil
}

func hrOf(err error) uint32 {
	if e, ok := AsError(err); ok {
		return e.HR
	}
	return 0
}

// asErr err'i tipli hataya çevirir (kopya; tipsizse OTHER + op).
func asErr(err error, op string) *Error {
	if e, ok := AsError(err); ok {
		c := *e
		if c.Reason == "" {
			c.Reason = ReasonOther
		}
		return &c
	}
	return &Error{Reason: ReasonOther, Op: op}
}

// wgcGrabber tek pencerenin grabber'ı (source iş parçacığında).
type wgcGrabber struct {
	hwnd   uintptr
	c      *wgcWindow
	iconic bool   // son verilen kare simge kaplaması
	w, h   int    // son gerçek karenin boyutu (kaplama aynı boyutta verilir: kodlayıcı yeniden kurulmaz)
	plate  []byte // kaplama BGRA (w×h)
}

func (g *wgcGrabber) rotation() Rotation { return RotNone }
func (g *wgcGrabber) cursor() *Cursor    { return nil }
func (g *wgcGrabber) close()             { g.c.close() }

// acquire pencere kapandıysa WINDOW_CLOSED (kalıcı); simge durumundaysa kaplamayı bir kez verir, sonra değişiklik
// yok (kodlayıcı 1 sn'de bir aynı kareyi tekrarlar); değilse WGC karesini bekler.
func (g *wgcGrabber) acquire(timeoutMs uint32, fn func(px []byte, w, h, pitch int) error) (bool, error) {
	if !win.IsWindow(g.hwnd) {
		return false, &Error{Reason: ReasonWindowClosed, Op: opWindowGone, Method: MethodWGC}
	}
	if win.IsIconic(g.hwnd) {
		if g.iconic {
			time.Sleep(time.Duration(timeoutMs) * time.Millisecond)
			return false, nil
		}
		w, h := g.w, g.h
		if w == 0 || h == 0 {
			w, h = iconicDefaultW, iconicDefaultH
		}
		if len(g.plate) != w*h*4 {
			g.plate = iconicPlate(w, h)
		}
		if err := fn(g.plate, w, h, w*4); err != nil {
			return false, err
		}
		g.iconic = true
		return true, nil
	}
	ok, err := g.c.acquire(timeoutMs, func(px []byte, w, h, pitch int) error {
		g.w, g.h = w, h
		return fn(px, w, h, pitch)
	})
	if ok {
		g.iconic = false
	}
	return ok, err
}

// iconicPlate siyah zemin üzerinde ortalanmış "Pencere simge durumunda" yazısı (BGRA, w×h). GDI başarısızsa düz siyah.
func iconicPlate(w, h int) []byte {
	out := make([]byte, w*h*4)
	for i := 3; i < len(out); i += 4 {
		out[i] = 0xFF
	}
	dc, _, _ := pCreateCompatibleDC.Call(0)
	if dc == 0 {
		return out
	}
	defer func() { _, _, _ = pDeleteDC.Call(dc) }()
	bi := bitmapInfoHeader{Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32, Compression: biRGB}
	bi.Size = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	bmp, _, _ := pCreateDIBSection.Call(dc, uintptr(unsafe.Pointer(&bi)), dibRGBColors, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bmp == 0 || bits == nil {
		return out
	}
	defer func() { _, _, _ = pDeleteObject.Call(bmp) }()
	old, _, _ := pSelectObject.Call(dc, bmp)
	font := win.Font(-int32(max(16, h/18)), 600)
	oldFont := win.SelectObject(dc, font)
	win.SetBkMode(dc, 1) // TRANSPARENT
	win.SetTextColor(dc, win.RGB(0xFF, 0xFF, 0xFF))
	r := win.RECT{Right: int32(w), Bottom: int32(h)}
	win.DrawText(dc, iconicText, &r, 0x1|0x4|0x20) // DT_CENTER | DT_VCENTER | DT_SINGLELINE
	_, _, _ = pGdiFlush.Call()
	px := unsafe.Slice((*byte)(bits), w*h*4)
	for i := 0; i < len(px); i += 4 {
		out[i], out[i+1], out[i+2] = px[i], px[i+1], px[i+2]
	}
	win.SelectObject(dc, oldFont)
	win.DeleteObject(font)
	_, _, _ = pSelectObject.Call(dc, old)
	return out
}
