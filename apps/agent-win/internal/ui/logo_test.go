package ui

import (
	"image"
	"image/color"
	"testing"
)

func TestAC98SystemLogoEmbedded(t *testing.T) {
	img := systemLogo()
	if img == nil || img.Bounds().Dx() < 16 || img.Bounds().Dy() < 16 {
		t.Fatalf("gömülü sistem logosu çözülemedi: %v", img)
	}
}

func TestAC98FitBGRKeepsAspectAndBlendsAlpha(t *testing.T) {
	bg := color.RGBA{R: 10, G: 20, B: 30, A: 255}
	// 200×50 kırmızı opak, sağ yarısı saydam → 100×40 kutuda 100×25, dikeyde ortalı.
	src := image.NewNRGBA(image.Rect(0, 0, 200, 50))
	for y := 0; y < 50; y++ {
		for x := 0; x < 100; x++ {
			src.Set(x, y, color.NRGBA{R: 255, A: 255})
		}
	}
	w, h := 100, 40
	out := fitBGR(src, w, h, bg)
	stride := (w*3 + 3) &^ 3
	if len(out) != stride*h {
		t.Fatalf("uzunluk %d", len(out))
	}
	px := func(x, y int) [3]byte { o := y*stride + x*3; return [3]byte{out[o], out[o+1], out[o+2]} }
	if got := px(0, 0); got != [3]byte{30, 20, 10} { // üst boşluk: arka plan
		t.Fatalf("üst boşluk %v", got)
	}
	if got := px(10, 20); got != [3]byte{0, 0, 255} { // opak kırmızı (BGR)
		t.Fatalf("logo pikseli %v", got)
	}
	if got := px(80, 20); got != [3]byte{30, 20, 10} { // saydam → arka plan
		t.Fatalf("saydam piksel %v", got)
	}
	if got := px(10, 39); got != [3]byte{30, 20, 10} { // alt boşluk (25 px yükseklik, oy=7)
		t.Fatalf("alt boşluk %v", got)
	}
}

func TestAC98FitBGRNilAndSmall(t *testing.T) {
	out := fitBGR(nil, 3, 2, color.RGBA{R: 1, G: 2, B: 3})
	if len(out) != 12*2 || out[0] != 3 || out[2] != 1 {
		t.Fatalf("boş logo arka planla dolmalı: %v", out)
	}
	small := image.NewNRGBA(image.Rect(0, 0, 2, 2)) // büyütülmez
	for i := range small.Pix {
		small.Pix[i] = 255
	}
	out = fitBGR(small, 8, 8, color.RGBA{})
	stride := (8*3 + 3) &^ 3
	if out[3*stride] != 255 || out[3*stride+2*3] != 0 { // y=3 satırı: x=0 logo, x=2 boş
		t.Fatalf("küçük logo büyütülmemeli")
	}
	tall := image.NewNRGBA(image.Rect(0, 0, 10, 40)) // yükseklik sınırlıyor → 5×20, soldan hizalı
	for i := range tall.Pix {
		tall.Pix[i] = 255
	}
	out = fitBGR(tall, 20, 20, color.RGBA{})
	stride = (20*3 + 3) &^ 3
	if out[19*stride] != 255 || out[19*stride+4*3] != 255 || out[19*stride+5*3] != 0 {
		t.Fatalf("uzun logo 5 px genişliğe sığmalı")
	}
}
