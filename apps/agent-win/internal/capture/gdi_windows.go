//go:build windows

package capture

import (
	"bytes"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/win"
)

// GDI yedek yakalama (istemci 0.10.2): DXGI Desktop Duplication açılamadığında veya süresinde kare vermediğinde
// (hibrit GPU, HDR, sürücü sorunu) ekran BitBlt(SRCCOPY|CAPTUREBLT) ile 32 bit yukarıdan aşağı DIB section'a
// kopyalanır; bayt düzeni BGRA'dır ve aynı BGRA→NV12 + H.264 hattına girer. CAPTUREBLT katmanlı pencereleri de
// kopyalar. İmleç DrawIconEx ile doğrudan görüntüye çizilir (ayrı bindirme yok). WDA_EXCLUDEFROMCAPTURE (gösterge ve
// işaretleme katmanı) DWM tarafından uygulanır ve Windows 10 2004+'ta ekran DC'sinden BitBlt'te de pencere
// görünmez; daha eski sürümlerde bayrak zaten reddedilir (DXGI'da da aynı sınır).

const (
	captureBlt     = 0x40000000
	srcCopy        = 0x00CC0020
	diNormal       = 0x0003
	cursorShowing  = 0x00000001
	biRGB          = 0
	dibRGBColors   = 0
	monitorRecheck = time.Second
)

var (
	modUser32 = windows.NewLazySystemDLL("user32.dll")
	modGDI32  = windows.NewLazySystemDLL("gdi32.dll")

	pGetDC              = modUser32.NewProc("GetDC")
	pReleaseDC          = modUser32.NewProc("ReleaseDC")
	pGetCursorInfo      = modUser32.NewProc("GetCursorInfo")
	pGetIconInfo        = modUser32.NewProc("GetIconInfo")
	pDrawIconEx         = modUser32.NewProc("DrawIconEx")
	pCreateCompatibleDC = modGDI32.NewProc("CreateCompatibleDC")
	pCreateDIBSection   = modGDI32.NewProc("CreateDIBSection")
	pSelectObject       = modGDI32.NewProc("SelectObject")
	pBitBlt             = modGDI32.NewProc("BitBlt")
	pGdiFlush           = modGDI32.NewProc("GdiFlush")
	pDeleteObject       = modGDI32.NewProc("DeleteObject")
	pDeleteDC           = modGDI32.NewProc("DeleteDC")
)

type bitmapInfoHeader struct {
	Size                         uint32
	Width, Height                int32
	Planes, BitCount             uint16
	Compression, SizeImage       uint32
	XPelsPerMeter, YPelsPerMeter int32
	ClrUsed, ClrImportant        uint32
}

type cursorInfo struct {
	Size, Flags uint32
	Cursor      uintptr
	X, Y        int32
}

type iconInfo struct {
	Icon               int32
	XHotspot, YHotspot uint32
	Mask, Color        uintptr
}

// gdiGrabber tek monitörün GDI kaynağı. acquire en çok gdiFPS hızında kopyalar; görüntü bir öncekiyle aynıysa false.
type gdiGrabber struct {
	device    string
	rect      win.RECT
	w, h      int
	screen    uintptr // GetDC(NULL): tüm sanal masaüstü
	mem       uintptr
	bmp, old  uintptr
	bits      []byte // DIB section belleği (GDI'nın)
	prev      []byte // son verilen kare (değişiklik tespiti)
	last      time.Time
	checkedAt time.Time
	interval  time.Duration
}

func monitorByDevice(device string) (win.RECT, bool) {
	for _, m := range win.Monitors() {
		if m.Device == device {
			return m.Rect, true
		}
	}
	return win.RECT{}, false
}

func openGDI(device string) (*gdiGrabber, error) {
	r, ok := monitorByDevice(device)
	if !ok {
		return nil, &Error{Reason: ReasonNoOutput, Op: "GDIMonitor"}
	}
	g := &gdiGrabber{device: device, interval: time.Second / gdiFPS}
	if err := g.setup(r); err != nil {
		g.close()
		return nil, err
	}
	return g, nil
}

func (g *gdiGrabber) setup(r win.RECT) error {
	w, h := int(r.Right-r.Left), int(r.Bottom-r.Top)
	if w < 1 || h < 1 {
		return &Error{Reason: ReasonNoOutput, Op: "GDIMonitor"}
	}
	g.release()
	g.rect, g.w, g.h, g.checkedAt = r, w, h, time.Now()
	if g.screen, _, _ = pGetDC.Call(0); g.screen == 0 {
		return &Error{Reason: ReasonGDI, Op: "GetDC"}
	}
	if g.mem, _, _ = pCreateCompatibleDC.Call(g.screen); g.mem == 0 {
		return &Error{Reason: ReasonGDI, Op: "CreateCompatibleDC"}
	}
	bi := bitmapInfoHeader{Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32, Compression: biRGB}
	bi.Size = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	g.bmp, _, _ = pCreateDIBSection.Call(g.mem, uintptr(unsafe.Pointer(&bi)), dibRGBColors, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if g.bmp == 0 || bits == nil {
		return &Error{Reason: ReasonGDI, Op: "CreateDIBSection"}
	}
	g.bits = unsafe.Slice((*byte)(bits), w*h*4)
	g.old, _, _ = pSelectObject.Call(g.mem, g.bmp)
	g.prev = nil
	return nil
}

func (g *gdiGrabber) rotation() Rotation { return RotNone } // ekran DC'si masaüstü yönündedir

func (g *gdiGrabber) cursor() *Cursor { return nil } // imleç görüntüye çizilir

// acquire kare aralığı dolmadıysa (en çok timeoutMs) bekleyip false döner; dolduysa kopyalar. Monitör boyutu
// değiştiyse (saniyede bir denetlenir) yüzey yeniden kurulur.
func (g *gdiGrabber) acquire(timeoutMs uint32, fn func(px []byte, w, h, pitch int) error) (bool, error) {
	if wait := time.Until(g.last.Add(g.interval)); wait > 0 {
		time.Sleep(min(wait, time.Duration(timeoutMs)*time.Millisecond))
		if time.Until(g.last.Add(g.interval)) > 0 {
			return false, nil
		}
	}
	g.last = time.Now()
	if g.last.Sub(g.checkedAt) >= monitorRecheck {
		r, ok := monitorByDevice(g.device)
		if !ok {
			return false, &Error{Reason: ReasonNoOutput, Op: "GDIMonitor"}
		}
		if r != g.rect {
			if err := g.setup(r); err != nil {
				return false, err
			}
		}
		g.checkedAt = g.last
	}
	if r, _, _ := pBitBlt.Call(g.mem, 0, 0, uintptr(g.w), uintptr(g.h), g.screen, uintptr(g.rect.Left), uintptr(g.rect.Top),
		srcCopy|captureBlt); r == 0 {
		return false, &Error{Reason: ReasonGDI, Op: "BitBlt"}
	}
	g.drawCursor()
	_, _, _ = pGdiFlush.Call()
	if g.prev != nil && bytes.Equal(g.prev, g.bits) {
		return false, nil
	}
	g.prev = append(g.prev[:0], g.bits...)
	if err := fn(g.bits, g.w, g.h, g.w*4); err != nil {
		return false, err
	}
	return true, nil
}

// drawCursor görünen imleci sıcak noktasına göre (monitöre göre koordinatlarla) kareye çizer.
func (g *gdiGrabber) drawCursor() {
	ci := cursorInfo{}
	ci.Size = uint32(unsafe.Sizeof(ci))
	if r, _, _ := pGetCursorInfo.Call(uintptr(unsafe.Pointer(&ci))); r == 0 || ci.Flags&cursorShowing == 0 || ci.Cursor == 0 {
		return
	}
	var ii iconInfo
	if r, _, _ := pGetIconInfo.Call(ci.Cursor, uintptr(unsafe.Pointer(&ii))); r == 0 {
		return
	}
	if ii.Mask != 0 {
		_, _, _ = pDeleteObject.Call(ii.Mask)
	}
	if ii.Color != 0 {
		_, _, _ = pDeleteObject.Call(ii.Color)
	}
	x := ci.X - g.rect.Left - int32(ii.XHotspot)
	y := ci.Y - g.rect.Top - int32(ii.YHotspot)
	if x >= int32(g.w) || y >= int32(g.h) || x < -256 || y < -256 {
		return
	}
	_, _, _ = pDrawIconEx.Call(g.mem, uintptr(x), uintptr(y), ci.Cursor, 0, 0, 0, 0, diNormal)
}

// release GDI nesnelerini bırakır (setup yeniden kurarken de kullanılır).
func (g *gdiGrabber) release() {
	if g.mem != 0 && g.old != 0 {
		_, _, _ = pSelectObject.Call(g.mem, g.old)
	}
	if g.bmp != 0 {
		_, _, _ = pDeleteObject.Call(g.bmp)
	}
	if g.mem != 0 {
		_, _, _ = pDeleteDC.Call(g.mem)
	}
	if g.screen != 0 {
		_, _, _ = pReleaseDC.Call(0, g.screen)
	}
	g.screen, g.mem, g.bmp, g.old, g.bits = 0, 0, 0, 0, nil
}

func (g *gdiGrabber) close() { g.release() }
