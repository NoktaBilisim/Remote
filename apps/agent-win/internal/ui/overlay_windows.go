//go:build windows

package ui

import (
	"time"

	"remote-support/agent-win/internal/annot"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

var (
	colorBar = colorRef(uicore.IndicatorBg)
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
	return newBarOpt(t, x, y, w, h, text, true)
}

// newBarOpt newBar; clickThrough=false P28e kayıt şeridi içindir (tıklanır, odak almaz).
func newBarOpt(t *thread, x, y, w, h int32, text *string, clickThrough bool) *form {
	f := t.newPopup(classBar, x, y, w, h, clickThrough)
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
			win.SetTextColor(dc, colorRef(uicore.IndicatorText))
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

// overlay AC-37/56: paylaşılan monitörde renk anahtarlı, tıklama geçirgen işaretleme katmanı; lazer 1 sn'de söner.
// Model ve boyama internal/annot'tadır (P30: gözetimsiz yardımcı da aynı kodu kullanır).
type overlay struct {
	f       *form
	canvas  annot.Canvas
	strokes []annot.Stroke
	laser   *[2]float64
	laserAt time.Time
}

const timerLaser, timerNotice = 3, 8

func newOverlay(t *thread, r win.RECT) *overlay {
	o := &overlay{}
	f := t.newPopup(classOverlay, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top, true)
	win.SetLayered(f.h, annot.ColorKey, 0, win.LWA_COLORKEY)
	win.ExcludeFromCapture(f.h)
	f.paint = func(dc uintptr, r win.RECT) { o.canvas.Paint(dc, r, o.strokes, o.laser, f.s, nil) }
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
	var set bool
	o.strokes, o.laser, set = annot.Apply(o.strokes, o.laser, m)
	if set {
		o.laserAt = time.Now()
		win.SetTimer(o.f.h, timerLaser, 100)
	}
	win.Invalidate(o.f.h)
}

func (o *overlay) close() {
	o.f.destroy()
	o.canvas.Release()
}
