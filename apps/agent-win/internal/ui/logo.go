package ui

import (
	"bytes"
	_ "embed"
	"image"
	"image/color"
	"image/png"
	"sync"
)

// systemLogoPNG Nokta Bilişim amblemi (NOKTA_LOGO/nokta-kucuk.png; ortak standart 1.5). Firma logosu yoksa,
// indirilemezse veya reddedilirse karşılamada bu gösterilir (AC-98, QA-P6-1).
//
//go:embed assets/nokta-kucuk.png
var systemLogoPNG []byte

var (
	systemLogoOnce sync.Once
	systemLogoImg  image.Image
)

// systemLogo gömülü logoyu bir kez çözer; çözülemezse nil (alan boş kalır).
func systemLogo() image.Image {
	systemLogoOnce.Do(func() {
		if img, err := png.Decode(bytes.NewReader(systemLogoPNG)); err == nil {
			systemLogoImg = img
		}
	})
	return systemLogoImg
}

// fitBGR resmi en-boy oranını koruyarak w×h kutusuna sığdırır (alan ortalaması ile küçültme, büyütme yok), soldan
// hizalı ve dikeyde ortalı yerleştirir, saydam pikselleri bg üzerine karıştırır. Çıktı yukarıdan aşağı 24 bit BGR,
// satır başına `(w*3+3)&^3` bayt (Win32 DIB düzeni).
func fitBGR(img image.Image, w, h int, bg color.RGBA) []byte {
	stride := (w*3 + 3) &^ 3
	out := make([]byte, stride*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			o := y*stride + x*3
			out[o], out[o+1], out[o+2] = bg.B, bg.G, bg.R
		}
	}
	if img == nil || w <= 0 || h <= 0 {
		return out
	}
	b := img.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw <= 0 || sh <= 0 {
		return out
	}
	dw, dh := sw, sh
	if dw > w || dh > h {
		if sw*h > sh*w { // genişlik sınırlıyor
			dw, dh = w, max(1, sh*w/sw)
		} else {
			dw, dh = max(1, sw*h/sh), h
		}
	}
	oy := (h - dh) / 2
	for y := 0; y < dh; y++ {
		y0, y1 := b.Min.Y+y*sh/dh, b.Min.Y+max((y+1)*sh/dh, y*sh/dh+1)
		for x := 0; x < dw; x++ {
			x0, x1 := b.Min.X+x*sw/dw, b.Min.X+max((x+1)*sw/dw, x*sw/dw+1)
			var r, g, bl, a, n uint64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					c := color.NRGBA64Model.Convert(img.At(sx, sy)).(color.NRGBA64)
					r += uint64(c.R) * uint64(c.A)
					g += uint64(c.G) * uint64(c.A)
					bl += uint64(c.B) * uint64(c.A)
					a += uint64(c.A)
					n++
				}
			}
			o := (oy+y)*stride + x*3
			if a == 0 {
				continue
			}
			// Kapsama: ortalama alfa; renk: alfa ağırlıklı ortalama (premultiplied karışım).
			alpha := a / n // 0..65535
			mix := func(sum uint64, back uint8) uint8 {
				fg := sum / a >> 8 // 0..255
				return uint8((fg*alpha + uint64(back)*(65535-alpha)) / 65535)
			}
			out[o], out[o+1], out[o+2] = mix(bl, bg.B), mix(g, bg.G), mix(r, bg.R)
		}
	}
	return out
}
