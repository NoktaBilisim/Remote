//go:build windows

// Package ui istemcinin Win32 arayüzüdür (CGO'suz; internal/win). Tüm pencereler tek bir UI iş parçacığında
// (LockOSThread) oluşturulur; akış goroutine'i işleri Do ile bu iş parçacığına gönderir. Ölçüler 96 DPI biriminde
// tanımlanır ve pencerenin DPI'ına göre ölçeklenir (PerMonitorV2, AC-110). Metinler Türkçedir.
package ui

import (
	"image"
	"image/color"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/win"
)

const (
	classForm    = "NoktaDestekForm"
	classBar     = "NoktaDestekBar"
	classOverlay = "NoktaDestekOverlay"
	hwndMessage  = ^uintptr(2) // HWND_MESSAGE (-3)

	fontNormal = 0
	fontBold   = 1
	fontBig    = 2
)

var colorDanger = win.RGB(185, 28, 28)

type ctrl struct {
	h          uintptr
	x, y, w, z int32 // 96 DPI birimi (z = yükseklik)
	font       int
	color      uint32
	colored    bool
	// img doluysa denetim SS_BITMAP'tır; bmp her layout'ta (DPI) img'den yeniden üretilir, sahibi formdur.
	img image.Image
	bmp uintptr
	// AC-247: denetim türü ve son uygulanan tema (theme_windows.go).
	kind int
	dark bool
}

type form struct {
	t      *thread
	h      uintptr
	style  uint32
	ex     uint32
	cw, ch int32
	dpi    int
	fonts  [3]uintptr
	ctrls  []*ctrl

	command  func(id, code int)
	close    func()
	timer    func(id uintptr)
	activate func(active bool)
	paint    func(dc uintptr, r win.RECT)
	// click P28e kayıt şeridi: tıklanabilir (tıklama geçirgen olmayan) açılır pencerede sol düğme bırakma.
	click func()
	// noKey bu düğmeye gelen Enter/Space yutulur (onay diyaloğu kuralı, G-03).
	noKey uintptr
	// S7-5: bu forma gelen son sol düğme basışının / tuş basışının kaynağı enjekte (veya bilinmiyor) muydu.
	downInjected bool
	keyInjected  bool
	// AC-247: themed newForm pencereleri (gösterge/işaretleme katmanı hariç); dark son uygulanan başlık teması.
	themed bool
	dark   bool
}

// newForm başlık çubuklu, boyutu değişmeyen pencere; görünür olmadan önce add + show çağrılır.
func (t *thread) newForm(title string, cw, ch int32, topmost bool) *form {
	f := &form{t: t, style: win.WS_CAPTION | win.WS_SYSMENU | win.WS_MINIMIZEBOX, ex: win.WS_EX_CONTROLPARENT, cw: cw, ch: ch}
	if topmost {
		f.ex |= win.WS_EX_TOPMOST
	}
	cur := win.CursorPos()
	wa := win.WorkAreaAt(cur)
	// Önce imlecin bulunduğu ekranda oluştur: DPI o ekranınki olur.
	f.h = win.CreateWindow(f.ex, classForm, title, f.style, (wa.Left+wa.Right)/2, (wa.Top+wa.Bottom)/2, 10, 10, 0, 0)
	f.dpi = win.DPI(f.h)
	f.ctrls = []*ctrl{}
	t.forms[f.h] = f
	f.themed = true
	f.applyTheme() // AC-247: başlık çubuğu gösterilmeden önce
	return f
}

// newPopup kenarlıksız, odak almayan, tıklama geçirgen üst pencere (gösterge ve işaretleme katmanı).
func (t *thread) newPopup(class string, x, y, w, h int32, clickThrough bool) *form {
	ex := uint32(win.WS_EX_TOPMOST | win.WS_EX_TOOLWINDOW | win.WS_EX_NOACTIVATE | win.WS_EX_LAYERED)
	if clickThrough {
		ex |= win.WS_EX_TRANSPARENT
	}
	f := &form{t: t, style: win.WS_POPUP, ex: ex}
	f.h = win.CreateWindow(ex, class, "", win.WS_POPUP, x, y, w, h, 0, 0)
	f.dpi = win.DPI(f.h)
	t.forms[f.h] = f
	return f
}

func (f *form) s(v int32) int32 { return v * int32(f.dpi) / 96 }

// add alt denetim ekler.
func (f *form) add(class, text string, style, ex uint32, id int, x, y, w, z int32, font int) *ctrl {
	h := win.CreateWindow(ex, class, text, win.WS_CHILD|win.WS_VISIBLE|style, 0, 0, 0, 0, f.h, uintptr(id))
	c := &ctrl{h: h, x: x, y: y, w: w, z: z, font: font, kind: ctrlKind(class, style)}
	f.ctrls = append(f.ctrls, c)
	return c
}

func (f *form) label(text string, x, y, w, z int32, font int) *ctrl {
	return f.add("STATIC", text, win.SS_NOPREFIX, 0, 0, x, y, w, z, font)
}

func (f *form) danger(text string, x, y, w, z int32, font int) *ctrl {
	c := f.label(text, x, y, w, z, font)
	c.color, c.colored = colorDanger, true
	return c
}

// picture resmi kutuya sığdırarak gösterir (logo, AC-98); img nil ise kutu boş kalır.
func (f *form) picture(img image.Image, x, y, w, z int32) *ctrl {
	c := f.add("STATIC", "", win.SS_BITMAP|win.SS_CENTERIMAGE, 0, 0, x, y, w, z, fontNormal)
	c.img = img
	return c
}

// orSystemLogo img nil ise sistem logosu (firma logosu yok, indirilemedi veya reddedildi; AC-98).
func orSystemLogo(img image.Image) image.Image {
	if img == nil {
		return systemLogo()
	}
	return img
}

// setPicture kutu boyutunda 24 bit DIB üretip denetime verir; önceki bitmap silinir.
func (f *form) setPicture(c *ctrl) {
	w, h := f.s(c.w), f.s(c.z)
	bg := f.t.logoBg() // COLORREF 0x00BBGGRR (AC-247: koyu modda açık logo zemini)
	px := fitBGR(c.img, int(w), int(h), color.RGBA{R: uint8(bg), G: uint8(bg >> 8), B: uint8(bg >> 16), A: 255})
	hb := win.Bitmap24(w, h, px)
	if hb == 0 {
		return
	}
	prev := win.SendMessage(c.h, win.STM_SETIMAGE, win.IMAGE_BITMAP, hb)
	if prev != 0 && prev != c.bmp {
		win.DeleteObject(prev)
	}
	if c.bmp != 0 {
		win.DeleteObject(c.bmp)
	}
	c.bmp = hb
}

func (f *form) button(text string, id int, x, y, w int32, def bool) *ctrl {
	style := uint32(win.WS_TABSTOP)
	if def {
		style |= win.BS_DEFPUSHBUTTON
	}
	return f.add("BUTTON", text, style, 0, id, x, y, w, 30, fontNormal)
}

func (f *form) edit(id int, x, y, w, z int32, style uint32, limit int) *ctrl {
	c := f.add("EDIT", "", win.WS_TABSTOP|style, win.WS_EX_CLIENTEDGE, id, x, y, w, z, fontNormal)
	if limit > 0 {
		win.SendMessage(c.h, win.EM_LIMITTEXT, uintptr(limit), 0)
	}
	return c
}

func (f *form) layout() {
	for i, size := range []int32{-13, -13, -30} {
		if f.fonts[i] != 0 {
			win.DeleteObject(f.fonts[i])
		}
		weight := win.FW_NORMAL
		if i > 0 {
			weight = win.FW_SEMIBOLD
		}
		f.fonts[i] = win.Font(f.s(size), weight)
	}
	for _, c := range f.ctrls {
		win.SetWindowPos(c.h, 0, f.s(c.x), f.s(c.y), f.s(c.w), f.s(c.z), win.SWP_NOZORDER|win.SWP_NOACTIVATE)
		win.SendMessage(c.h, win.WM_SETFONT, f.fonts[c.font], 1)
		if c.img != nil {
			f.setPicture(c)
		}
	}
	f.applyTheme()
}

// size istemci boyutundan pencere boyutu (DPI'a göre).
func (f *form) size() (int32, int32) {
	r := win.RECT{Right: f.s(f.cw), Bottom: f.s(f.ch)}
	win.AdjustRect(&r, f.style, f.ex, f.dpi)
	return r.Right - r.Left, r.Bottom - r.Top
}

// show pencereyi verilen çalışma alanında konumlandırır: center=true ortada, aksi halde sağ alt köşede.
func (f *form) show(wa win.RECT, center bool, focus *ctrl) {
	f.layout()
	w, h := f.size()
	x, y := wa.Right-w-f.s(16), wa.Bottom-h-f.s(16)
	if center {
		x, y = (wa.Left+wa.Right-w)/2, (wa.Top+wa.Bottom-h)/2
	}
	win.SetWindowPos(f.h, 0, x, y, w, h, win.SWP_NOZORDER|win.SWP_NOACTIVATE)
	win.ShowWindow(f.h, win.SW_SHOWNORMAL)
	win.SetForegroundWindow(f.h)
	if focus != nil {
		win.SetFocus(focus.h)
	}
}

// showAwayFromCursor G-03: diyalog fare imlecini içermeyecek konumda açılır (imleç ortadaysa üst-orta;
// konum kuralı platformsuz control.PlaceAway'de, birim testli).
func (f *form) showAwayFromCursor(focus *ctrl) {
	f.layout()
	w, h := f.size()
	cur := win.CursorPos()
	wa := win.WorkAreaAt(cur)
	x, y := control.PlaceAway(control.Point{X: cur.X, Y: cur.Y},
		control.Rect{Left: wa.Left, Top: wa.Top, Right: wa.Right, Bottom: wa.Bottom}, w, h, f.s(24))
	win.SetWindowPos(f.h, 0, x, y, w, h, win.SWP_NOZORDER|win.SWP_NOACTIVATE)
	win.ShowWindow(f.h, win.SW_SHOWNORMAL)
	win.SetForegroundWindow(f.h)
	if focus != nil {
		win.SetFocus(focus.h)
	}
}

func (f *form) destroy() {
	if f.h == 0 {
		return
	}
	delete(f.t.forms, f.h)
	win.DestroyWindow(f.h)
	f.h = 0
	for _, c := range f.ctrls {
		if c.bmp != 0 {
			win.DeleteObject(c.bmp)
			c.bmp = 0
		}
	}
	for i, ft := range f.fonts {
		if ft != 0 {
			win.DeleteObject(ft)
			f.fonts[i] = 0
		}
	}
}
