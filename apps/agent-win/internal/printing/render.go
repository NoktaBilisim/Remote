package printing

import (
	"image"
	"math"
)

// maxPrintDPI render çözünürlüğü üst sınırı (§5.3: min(yazıcı DPI, 300)).
const maxPrintDPI = 300

// targetSize yazdırılabilir alandan (cihaz pikseli) render hedefi: DPI ≤ 300'e ölçeklenir, oran korunarak ≤ 40 Mpx ve
// ≤ 64 MiB çerçeveye sığdırılır. Hedefi üst süreç belirler; işleyici yalnız bu boyutta yanıt verebilir (O-P28a-3).
func targetSize(pw, ph, dpi uint32) (uint32, uint32, bool) {
	if pw == 0 || ph == 0 || dpi == 0 {
		return 0, 0, false
	}
	w, h := uint64(pw), uint64(ph)
	if dpi > maxPrintDPI {
		w, h = max(1, w*maxPrintDPI/uint64(dpi)), max(1, h*maxPrintDPI/uint64(dpi))
	}
	if w > math.MaxUint32 || h > math.MaxUint32 {
		return 0, 0, false
	}
	if _, ok := frameLen(uint32(w), uint32(h)); !ok {
		s := math.Sqrt(float64(MaxPixels) / (float64(w) * float64(h)))
		w, h = max(1, uint64(float64(w)*s)), max(1, uint64(float64(h)*s))
		for _, ok := frameLen(uint32(w), uint32(h)); !ok && w > 1 && h > 1; _, ok = frameLen(uint32(w), uint32(h)) {
			w, h = max(1, w*9/10), max(1, h*9/10)
		}
	}
	_, ok := frameLen(uint32(w), uint32(h))
	return uint32(w), uint32(h), ok
}

// compose img'yi beyaz bm üzerine ortalar (24 bit BGR, üstten aşağı). Saydamlık beyaza karıştırılır. PNG çözücünün
// verdiği NRGBA/RGBA için doğrudan yol (40 Mpx'te image.At sayfa zaman aşımına yaklaşır), diğerleri genel yol.
func compose(bm *Bitmap, img image.Image) {
	for i := range bm.Pix {
		bm.Pix[i] = 0xff
	}
	b := img.Bounds()
	iw, ih := min(b.Dx(), bm.W), min(b.Dy(), bm.H)
	ox, oy := (bm.W-iw)/2, (bm.H-ih)/2
	for y := 0; y < ih; y++ {
		row := bm.Pix[(oy+y)*bm.Stride+ox*3:]
		switch m := img.(type) {
		case *image.NRGBA:
			src := m.Pix[m.PixOffset(b.Min.X, b.Min.Y+y):]
			for x := 0; x < iw; x++ {
				r, g, bl, a := uint32(src[x*4]), uint32(src[x*4+1]), uint32(src[x*4+2]), uint32(src[x*4+3])
				row[x*3] = byte((bl*a + 0xff*(0xff-a)) / 0xff)
				row[x*3+1] = byte((g*a + 0xff*(0xff-a)) / 0xff)
				row[x*3+2] = byte((r*a + 0xff*(0xff-a)) / 0xff)
			}
		case *image.RGBA: // alfa ön çarpımlı
			src := m.Pix[m.PixOffset(b.Min.X, b.Min.Y+y):]
			for x := 0; x < iw; x++ {
				inv := 0xff - uint32(src[x*4+3])
				row[x*3] = byte(min(0xff, uint32(src[x*4+2])+inv))
				row[x*3+1] = byte(min(0xff, uint32(src[x*4+1])+inv))
				row[x*3+2] = byte(min(0xff, uint32(src[x*4])+inv))
			}
		default:
			for x := 0; x < iw; x++ {
				r, g, bl, a := img.At(b.Min.X+x, b.Min.Y+y).RGBA() // 16 bit, alfa ön çarpımlı
				inv := 0xffff - a
				row[x*3] = byte((bl + inv) >> 8)
				row[x*3+1] = byte((g + inv) >> 8)
				row[x*3+2] = byte((r + inv) >> 8)
			}
		}
	}
}
