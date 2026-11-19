//go:build windows

package annot

import "remote-support/agent-win/internal/win"

// ColorKey işaretleme katmanında saydam renk (LWA_COLORKEY); hiçbir çizim rengiyle çakışmaz.
var ColorKey = win.RGB(255, 0, 255)

// Paint çizimleri ve lazer noktasını r boyutundaki (sol üst 0,0) katmana çift tamponlu boyar; zemin ColorKey (saydam).
// scale DPI ölçekleme (kalem 4, ok ucu 16, lazer yarıçapı 8 pt). exclude dikdörtgenlerine (katman yerel koordinatı)
// boyanmaz: zemin orada da saydamdır, çizim kırpılır (P30 K-P30-3: gösterge örtülmez). Hızlı Destek exclude=nil.
func Paint(dc uintptr, r win.RECT, strokes []Stroke, laser *[2]float64, scale func(int32) int32, exclude []win.RECT) {
	w, h := r.Right, r.Bottom
	mem := win.CompatibleDC(dc)
	bmp := win.CompatibleBitmap(dc, w, h)
	oldBmp := win.SelectObject(mem, bmp)
	key := win.SolidBrush(ColorKey)
	win.FillRect(mem, &r, key)
	win.DeleteObject(key)
	for _, e := range exclude {
		win.ExcludeClipRect(mem, e.Left, e.Top, e.Right, e.Bottom)
	}
	px := func(p [2]float64) (int32, int32) { return int32(p[0] * float64(w)), int32(p[1] * float64(h)) }
	oldBrush := win.SelectObject(mem, win.StockObject(win.NULL_BRUSH))
	for _, s := range strokes {
		drawStroke(mem, s, px, scale)
	}
	if laser != nil {
		drawLaser(mem, *laser, px, scale)
	}
	win.SelectObject(mem, oldBrush)
	win.BitBlt(dc, 0, 0, w, h, mem)
	win.SelectObject(mem, oldBmp)
	win.DeleteObject(bmp)
	win.DeleteDC(mem)
}

func colorRef(name string) uint32 {
	c := rgb8(name)
	return win.RGB(c[0], c[1], c[2])
}

// drawStroke tek çizim (dikdörtgen, ok veya serbest çizgi) kendi renginde kalemle.
func drawStroke(mem uintptr, s Stroke, px func([2]float64) (int32, int32), scale func(int32) int32) {
	if len(s.Pts) == 0 {
		return
	}
	pen := win.Pen(scale(4), colorRef(s.Color))
	oldPen := win.SelectObject(mem, pen)
	x0, y0 := px(s.Pts[0])
	x1, y1 := px(s.Pts[len(s.Pts)-1])
	switch s.Tool {
	case "rect":
		win.Rectangle(mem, min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
	case "arrow":
		win.MoveTo(mem, x0, y0)
		win.LineTo(mem, x1, y1)
		hx, hy := arrowHead(float64(x1-x0), float64(y1-y0))
		size := float64(scale(int32(arrowSize)))
		for i := range hx {
			win.MoveTo(mem, x1, y1)
			win.LineTo(mem, x1-int32(hx[i]*size), y1-int32(hy[i]*size))
		}
	default:
		win.MoveTo(mem, x0, y0)
		for _, p := range s.Pts[1:] {
			x, y := px(p)
			win.LineTo(mem, x, y)
		}
	}
	win.SelectObject(mem, oldPen)
	win.DeleteObject(pen)
}

// drawLaser lazer noktası (kırmızı daire).
func drawLaser(mem uintptr, p [2]float64, px func([2]float64) (int32, int32), scale func(int32) int32) {
	br := win.SolidBrush(colorRef("red"))
	ob := win.SelectObject(mem, br)
	x, y := px(p)
	d := scale(8)
	win.Ellipse(mem, x-d, y-d, x+d, y+d)
	win.SelectObject(mem, ob)
	win.DeleteObject(br)
}
