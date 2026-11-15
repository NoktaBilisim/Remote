//go:build windows

package ui

import (
	"math"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/win"
)

var (
	colorBar = colorRef(indicatorBg)
	colorKey = win.RGB(255, 0, 255) // işaretleme katmanında saydam renk
	annotRGB = map[string]uint32{
		"red": win.RGB(239, 68, 68), "yellow": win.RGB(234, 179, 8),
		"green": win.RGB(34, 197, 94), "blue": win.RGB(59, 130, 246),
	}
)

// indicator AC-103: her monitörde kırmızı kenarlık + üst-orta etiket; 1 sn'de bir yeniden en üste alınır.
// Pencereler tıklama geçirgendir ve yakalamadan hariç tutulur (teknisyen görüntüsünde çift çerçeve olmaz).
type indicator struct {
	bars   []*form
	labels []*form
	text   string
	notes  []*form // P28a bildirim satırı (notify)
	note   string
}

func newIndicator(t *thread, text string) *indicator {
	ind := &indicator{text: text}
	for _, m := range win.Monitors() {
		r := m.Rect
		w, h := r.Right-r.Left, r.Bottom-r.Top
		const b = 5
		for _, e := range [][4]int32{{r.Left, r.Top, w, b}, {r.Left, r.Bottom - b, w, b}, {r.Left, r.Top, b, h}, {r.Right - b, r.Top, b, h}} {
			ind.bars = append(ind.bars, newBar(t, e[0], e[1], e[2], e[3], nil))
		}
		lw, lh := int32(460), int32(32)
		lbl := newBar(t, r.Left+(w-lw)/2, r.Top, lw, lh, &ind.text)
		ind.bars = append(ind.bars, lbl)
		ind.labels = append(ind.labels, lbl)
	}
	if len(ind.bars) > 0 {
		first := ind.bars[0]
		first.timer = func(uintptr) { ind.raise() }
		win.SetTimer(first.h, timerTopmost, 1000)
	}
	return ind
}

// newBar text nil ise yalnız kenarlık; değilse etiket metni her boyamada *text'ten okunur (setText).
func newBar(t *thread, x, y, w, h int32, text *string) *form {
	f := t.newPopup(classBar, x, y, w, h, true)
	win.SetLayered(f.h, 0, 235, win.LWA_ALPHA)
	win.ExcludeFromCapture(f.h)
	f.paint = func(dc uintptr, r win.RECT) {
		br := win.SolidBrush(colorBar)
		win.FillRect(dc, &r, br)
		win.DeleteObject(br)
		if text != nil && *text != "" {
			ft := win.Font(f.s(-15), win.FW_SEMIBOLD)
			old := win.SelectObject(dc, ft)
			win.SetBkMode(dc, win.TRANSPARENT)
			win.SetTextColor(dc, colorRef(indicatorText))
			win.DrawText(dc, *text, &r, win.DT_CENTER|win.DT_VCENTER|win.DT_SINGLELINE|win.DT_NOPREFIX)
			win.SelectObject(dc, old)
			win.DeleteObject(ft)
		}
	}
	win.ShowWindow(f.h, win.SW_SHOWNOACTIVATE)
	return f
}

// setText AC-103: "Ekranınız izleniyor — <ad>" ↔ "Uzaktan kontrol aktif — <ad>".
func (ind *indicator) setText(text string) {
	ind.text = text
	for _, l := range ind.labels {
		win.Invalidate(l.h)
	}
}

// notify P28a (AC-346): her monitörde etiketin altında 3 sn bildirim satırı (tıklama geçirgen, odak almaz, yakalamadan
// hariç); yeni bildirim öncekinin yerini alır.
func (ind *indicator) notify(t *thread, text string) {
	ind.dropNotes()
	ind.note = text
	for _, m := range win.Monitors() {
		r := m.Rect
		ind.notes = append(ind.notes, newBar(t, r.Left+(r.Right-r.Left-460)/2, r.Top+36, 460, 28, &ind.note))
	}
	if len(ind.notes) > 0 {
		ind.notes[0].timer = func(uintptr) { ind.dropNotes() }
		win.SetTimer(ind.notes[0].h, timerNotice, 3000)
	}
}

func (ind *indicator) dropNotes() {
	for _, n := range ind.notes {
		n.destroy()
	}
	ind.notes = nil
}

func (ind *indicator) raise() {
	for _, b := range append(ind.bars[:len(ind.bars):len(ind.bars)], ind.notes...) {
		win.SetWindowPos(b.h, win.HWND_TOPMOST, 0, 0, 0, 0, win.SWP_NOMOVE|win.SWP_NOSIZE|win.SWP_NOACTIVATE|win.SWP_SHOWWINDOW)
	}
}

func (ind *indicator) close() {
	ind.dropNotes()
	for _, b := range ind.bars {
		b.destroy()
	}
	ind.bars = nil
}

type stroke struct {
	id, tool, color string
	pts             [][2]float64
}

// overlay AC-37/56: paylaşılan monitörde renk anahtarlı, tıklama geçirgen işaretleme katmanı; lazer 1 sn'de söner.
type overlay struct {
	f       *form
	strokes []stroke
	laser   *[2]float64
	laserAt time.Time
}

const timerLaser, timerNotice = 3, 8

func newOverlay(t *thread, r win.RECT) *overlay {
	o := &overlay{}
	f := t.newPopup(classOverlay, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top, true)
	win.SetLayered(f.h, colorKey, 0, win.LWA_COLORKEY)
	win.ExcludeFromCapture(f.h)
	f.paint = o.paint
	f.timer = func(uintptr) {
		if o.laser != nil && time.Since(o.laserAt) > time.Second {
			o.laser = nil
			win.KillTimer(f.h, timerLaser)
			win.Invalidate(f.h)
		}
	}
	o.f = f
	win.ShowWindow(f.h, win.SW_SHOWNOACTIVATE)
	return o
}

func (o *overlay) apply(m dc.Ctl) {
	switch m.T {
	case "annot.stroke":
		o.strokes = append(o.strokes, stroke{m.ID, m.Tool, m.Color, m.Pts})
	case "annot.laser":
		o.laser, o.laserAt = &[2]float64{*m.X, *m.Y}, time.Now()
		win.SetTimer(o.f.h, timerLaser, 100)
	case "annot.undo":
		for i := len(o.strokes) - 1; i >= 0; i-- {
			if m.ID == "" || o.strokes[i].id == m.ID {
				o.strokes = append(o.strokes[:i], o.strokes[i+1:]...)
				break
			}
		}
	case "annot.clear":
		o.strokes, o.laser = nil, nil
	}
	win.Invalidate(o.f.h)
}

func (o *overlay) paint(dc uintptr, r win.RECT) {
	w, h := r.Right, r.Bottom
	mem := win.CompatibleDC(dc)
	bmp := win.CompatibleBitmap(dc, w, h)
	oldBmp := win.SelectObject(mem, bmp)
	key := win.SolidBrush(colorKey)
	win.FillRect(mem, &r, key)
	win.DeleteObject(key)
	px := func(p [2]float64) (int32, int32) { return int32(p[0] * float64(w)), int32(p[1] * float64(h)) }
	oldBrush := win.SelectObject(mem, win.StockObject(win.NULL_BRUSH))
	for _, s := range o.strokes {
		o.drawStroke(mem, s, px)
	}
	if o.laser != nil {
		o.drawLaser(mem, px)
	}
	win.SelectObject(mem, oldBrush)
	win.BitBlt(dc, 0, 0, w, h, mem)
	win.SelectObject(mem, oldBmp)
	win.DeleteObject(bmp)
	win.DeleteDC(mem)
}

// drawStroke tek çizim (dikdörtgen, ok veya serbest çizgi) kendi renginde kalemle.
func (o *overlay) drawStroke(mem uintptr, s stroke, px func([2]float64) (int32, int32)) {
	pen := win.Pen(o.f.s(4), annotRGB[s.color])
	oldPen := win.SelectObject(mem, pen)
	x0, y0 := px(s.pts[0])
	x1, y1 := px(s.pts[len(s.pts)-1])
	switch s.tool {
	case "rect":
		win.Rectangle(mem, min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
	case "arrow":
		win.MoveTo(mem, x0, y0)
		win.LineTo(mem, x1, y1)
		drawHead(mem, x0, y0, x1, y1, o.f.s(16))
	default:
		win.MoveTo(mem, x0, y0)
		for _, p := range s.pts[1:] {
			x, y := px(p)
			win.LineTo(mem, x, y)
		}
	}
	win.SelectObject(mem, oldPen)
	win.DeleteObject(pen)
}

// drawLaser lazer noktası (kırmızı daire).
func (o *overlay) drawLaser(mem uintptr, px func([2]float64) (int32, int32)) {
	br := win.SolidBrush(annotRGB["red"])
	ob := win.SelectObject(mem, br)
	x, y := px(*o.laser)
	d := o.f.s(8)
	win.Ellipse(mem, x-d, y-d, x+d, y+d)
	win.SelectObject(mem, ob)
	win.DeleteObject(br)
}

// drawHead ok ucu: bitiş noktasından geriye ±30° iki çizgi.
func drawHead(dc uintptr, x0, y0, x1, y1, size int32) {
	dx, dy := float64(x1-x0), float64(y1-y0)
	l := max(1, math.Hypot(dx, dy))
	ux, uy := dx/l, dy/l
	const c, s = 0.866, 0.5
	for _, sign := range []float64{1, -1} {
		hx := ux*c - sign*uy*s
		hy := uy*c + sign*ux*s
		win.MoveTo(dc, x1, y1)
		win.LineTo(dc, x1-int32(hx*float64(size)), y1-int32(hy*float64(size)))
	}
}

func (o *overlay) close() { o.f.destroy() }
