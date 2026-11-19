// Package annot AC-37/56 işaretleme modeli (teknisyen çizimleri) ve Windows GDI boyaması (P30, mimari-p30 §3/§6).
// Hızlı Destek arayüzleri (internal/ui: Windows, macOS, Linux) ve gözetimsiz yardımcı (internal/unattended/helper) aynı
// kodu kullanır. Paket yalnız internal/dc ve (Windows) internal/win içe aktarır; arayüz/ileti kutusu bağımlılığı yoktur
// (AC-341).
package annot

import (
	"math"

	"remote-support/agent-win/internal/dc"
)

// Stroke tek çizim (0..1 normalize noktalar).
type Stroke struct {
	ID, Tool, Color string
	Pts             [][2]float64
}

// palette konsoldaki dört renk (sRGB 0..255).
var palette = map[string][3]uint8{"red": {239, 68, 68}, "yellow": {234, 179, 8}, "green": {34, 197, 94},
	"blue": {59, 130, 246}}

// rgb8 rengin 0..255 bileşenleri; bilinmeyen renk kırmızı.
func rgb8(name string) [3]uint8 {
	c, ok := palette[name]
	if !ok {
		c = palette["red"]
	}
	return c
}

// Color dört renk (sRGB 0..1); bilinmeyen renk kırmızı.
func Color(name string) [3]float64 {
	c := rgb8(name)
	return [3]float64{float64(c[0]) / 255, float64(c[1]) / 255, float64(c[2]) / 255}
}

// MaxStrokes bellekte tutulan en çok çizim (teknisyenden sınırsız ileti katmanı şişirmesin).
const MaxStrokes = 500

// MaxPoints tüm çizimlerin toplam nokta bütçesi (P30 güvenlik turu: 500 × 500 noktalık boyama işi göstergenin iş
// parçacığını tıkamasın); aşılınca en eski çizimler atılır. Tek çizim ≤ 500 nokta (dc.ParseCtl) her zaman sığar.
const MaxPoints = 20000

// Apply işaretleme iletisini uygular; laser true ise lazer noktası (yeniden) kondu.
func Apply(strokes []Stroke, laser *[2]float64, m dc.Ctl) ([]Stroke, *[2]float64, bool) {
	switch m.T {
	case "annot.stroke":
		if len(m.Pts) > 0 {
			strokes = append(strokes, Stroke{m.ID, m.Tool, m.Color, m.Pts})
			if len(strokes) > MaxStrokes {
				strokes = strokes[len(strokes)-MaxStrokes:]
			}
			strokes = trimPoints(strokes)
		}
	case "annot.laser":
		if m.X != nil && m.Y != nil {
			return strokes, &[2]float64{*m.X, *m.Y}, true
		}
	case "annot.undo":
		for i := len(strokes) - 1; i >= 0; i-- {
			if m.ID == "" || strokes[i].ID == m.ID {
				strokes = append(strokes[:i:i], strokes[i+1:]...)
				break
			}
		}
	case "annot.clear":
		return nil, nil, false
	}
	return strokes, laser, false
}

// trimPoints toplam nokta MaxPoints'i aşıyorsa en eski çizimleri atar (son çizim her zaman kalır).
func trimPoints(strokes []Stroke) []Stroke {
	total := 0
	for _, s := range strokes {
		total += len(s.Pts)
	}
	i := 0
	for total > MaxPoints && i < len(strokes)-1 {
		total -= len(strokes[i].Pts)
		i++
	}
	return strokes[i:]
}

// Polylines çizimin piksel uzayındaki (w×h, sol üst orijin) çoklu çizgileri: dikdörtgen kapalı çizgi, ok gövde +
// iki uç çizgisi (±30°, 16 pt), serbest çizgi noktaları.
func Polylines(s Stroke, w, h float64) [][][2]float64 {
	if len(s.Pts) == 0 {
		return nil
	}
	px := func(p [2]float64) [2]float64 { return [2]float64{p[0] * w, p[1] * h} }
	a, b := px(s.Pts[0]), px(s.Pts[len(s.Pts)-1])
	switch s.Tool {
	case "rect":
		return [][][2]float64{{a, {b[0], a[1]}, b, {a[0], b[1]}, a}}
	case "arrow":
		hx, hy := arrowHead(b[0]-a[0], b[1]-a[1])
		out := [][][2]float64{{a, b}}
		for i := range hx {
			out = append(out, [][2]float64{b, {b[0] - hx[i]*arrowSize, b[1] - hy[i]*arrowSize}})
		}
		return out
	}
	line := make([][2]float64, len(s.Pts))
	for i, p := range s.Pts {
		line[i] = px(p)
	}
	return [][][2]float64{line}
}

// arrowSize ok ucu çizgilerinin boyu (pt; Windows'ta DPI ölçeklenir).
const arrowSize = 16.0

// arrowHead ok gövdesi yönüne (dx, dy) göre iki uç çizgisinin birim yönleri (±30°); uç = bitiş − yön × boy.
func arrowHead(dx, dy float64) (hx, hy [2]float64) {
	l := max(1, math.Hypot(dx, dy))
	ux, uy := dx/l, dy/l
	const c, sn = 0.866, 0.5
	for i, sign := range []float64{1, -1} {
		hx[i], hy[i] = ux*c-sign*uy*sn, uy*c+sign*ux*sn
	}
	return hx, hy
}
