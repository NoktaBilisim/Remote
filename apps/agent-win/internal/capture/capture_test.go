package capture

import (
	"bytes"
	"testing"
	"time"
)

func solid(w, h int, b, g, r byte) []byte {
	px := make([]byte, w*h*4)
	for i := 0; i < len(px); i += 4 {
		px[i], px[i+1], px[i+2], px[i+3] = b, g, r, 255
	}
	return px
}

func TestNV12SolidColorsBT601(t *testing.T) {
	cases := []struct {
		name    string
		b, g, r byte
		y, u, v byte
	}{
		{"siyah", 0, 0, 0, 16, 128, 128},
		{"beyaz", 255, 255, 255, 235, 128, 128},
		{"kırmızı", 0, 0, 255, 82, 90, 240},
		{"mavi", 255, 0, 0, 41, 240, 110},
	}
	for _, c := range cases {
		dst := NewNV12(4, 2)
		if err := ConvertBGRA(dst, solid(4, 2, c.b, c.g, c.r), 4, 2, 16, RotNone); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 8; i++ {
			if dst.Data[i] != c.y {
				t.Fatalf("%s: Y[%d]=%d, beklenen %d", c.name, i, dst.Data[i], c.y)
			}
		}
		if u, v := dst.Data[8], dst.Data[9]; u != c.u || v != c.v {
			t.Fatalf("%s: UV=%d,%d, beklenen %d,%d", c.name, u, v, c.u, c.v)
		}
	}
}

// 2×2 bloklar: sol üst beyaz, gerisi siyah. Döndürmeden sonra beyaz bloğun yeri beklenen köşede olmalı.
func TestNV12RotationAndStride(t *testing.T) {
	const sw, sh, stride = 4, 2, 4*4 + 8 // satır sonunda dolgu
	src := make([]byte, stride*sh)
	for y := 0; y < sh; y++ {
		for x := 0; x < sw; x++ {
			v := byte(0)
			if x < 2 {
				v = 255
			}
			o := y*stride + x*4
			src[o], src[o+1], src[o+2] = v, v, v
		}
	}
	white := func(d *NV12, x, y int) bool { return d.Data[y*d.W+x] == 235 }
	cases := []struct {
		rot    Rotation
		w, h   int
		wx, wy int // beyaz bloktaki bir piksel
		bx, by int // siyah bloktaki bir piksel
	}{
		{RotNone, 4, 2, 0, 0, 3, 1},
		{Rot180, 4, 2, 3, 1, 0, 0},
		{Rot90, 2, 4, 0, 0, 1, 3},  // saat yönü: sol sütun üst satıra
		{Rot270, 2, 4, 1, 3, 0, 0}, // saat yönü tersi: sol sütun alt satıra
	}
	for _, c := range cases {
		if w, h := DesktopSize(sw, sh, c.rot); w != c.w || h != c.h {
			t.Fatalf("rot %d: masaüstü %dx%d", c.rot, w, h)
		}
		d := NewNV12(c.w, c.h)
		if err := ConvertBGRA(d, src, sw, sh, stride, c.rot); err != nil {
			t.Fatal(err)
		}
		if !white(d, c.wx, c.wy) || white(d, c.bx, c.by) {
			t.Fatalf("rot %d: Y düzlemi %v", c.rot, d.Data[:c.w*c.h])
		}
	}
}

func TestNV12ScaleDownAndInvalid(t *testing.T) {
	d := NewNV12(2, 2)
	if err := ConvertBGRA(d, solid(8, 8, 255, 255, 255), 8, 8, 32, RotNone); err != nil || d.Data[0] != 235 {
		t.Fatalf("ölçek: %v %v", err, d.Data)
	}
	if err := ConvertBGRA(d, make([]byte, 10), 8, 8, 32, RotNone); err == nil {
		t.Fatal("kısa kaynak kabul edildi")
	}
	if err := ConvertBGRA(&NV12{W: 3, H: 2, Data: make([]byte, 9)}, solid(4, 2, 0, 0, 0), 4, 2, 16, RotNone); err == nil {
		t.Fatal("tek genişlik kabul edildi")
	}
	if err := ConvertBGRA(d, solid(4, 2, 0, 0, 0), 4, 2, 8, RotNone); err == nil {
		t.Fatal("stride < genişlik*4 kabul edildi")
	}
}

func TestAC41OutputSizeFitsEncoderLimit(t *testing.T) {
	cases := [][4]int{
		{3840, 2160, 1920, 1080},
		{2560, 1440, 1920, 1080},
		{1920, 1080, 1920, 1080},
		{1366, 768, 1366, 768},
		{1365, 767, 1364, 766},
		{1080, 1920, 1080, 1920},
		{2160, 3840, 1080, 1920},
		{3440, 1440, 1920, 802},
		{1, 1, 2, 2},
	}
	for _, c := range cases {
		if w, h := OutputSize(c[0], c[1]); w != c[2] || h != c[3] {
			t.Fatalf("%dx%d → %dx%d, beklenen %dx%d", c[0], c[1], w, h, c[2], c[3])
		}
	}
}

func TestAnnexBSplitAndParamSets(t *testing.T) {
	sps := []byte{0x67, 0x42, 0xc0, 0x1f}
	pps := []byte{0x68, 0xce, 0x3c, 0x80}
	idr := []byte{0x65, 0x88, 0x84}
	p := []byte{0x41, 0x9a, 0x02}
	join := func(sc []byte, ns ...[]byte) []byte {
		var b []byte
		for _, n := range ns {
			b = append(append(b, sc...), n...)
		}
		return b
	}
	// 3 ve 4 baytlık başlangıç kodu karışık.
	mixed := append(join([]byte{0, 0, 1}, sps), join([]byte{0, 0, 0, 1}, pps, idr)...)
	if got := splitNALs(mixed); len(got) != 3 || !bytes.Equal(got[0], sps) || !bytes.Equal(got[1], pps) || !bytes.Equal(got[2], idr) {
		t.Fatalf("split: %x", got)
	}
	if got := splitNALs([]byte{1, 2, 3}); len(got) != 0 {
		t.Fatalf("başlangıç kodsuz: %x", got)
	}

	sc := []byte{0, 0, 0, 1}
	var ps paramSets
	out, key := ps.fix(join([]byte{0, 0, 1}, sps, pps, idr))
	if !key || !bytes.Equal(out, join(sc, sps, pps, idr)) {
		t.Fatalf("ilk IDR: key=%v %x", key, out)
	}
	if out, key = ps.fix(join(sc, p)); key || !bytes.Equal(out, join(sc, p)) {
		t.Fatalf("P dilimi: key=%v %x", key, out)
	}
	// SPS/PPS'siz sonraki IDR'ye önbellekten eklenir.
	if out, key = ps.fix(join(sc, idr)); !key || !bytes.Equal(out, join(sc, sps, pps, idr)) {
		t.Fatalf("ikinci IDR: %x", out)
	}
	// Sıra başlığından öğrenme (MF_MT_MPEG_SEQUENCE_HEADER).
	var fromHdr paramSets
	fromHdr.learn(join(sc, sps, pps))
	if out, _ = fromHdr.fix(join(sc, idr)); !bytes.Equal(out, join(sc, sps, pps, idr)) {
		t.Fatalf("başlıktan: %x", out)
	}
}

func TestAC41RateControlKeepsAtLeast15FPS(t *testing.T) {
	r := newRateCtl()
	if r.FPS() != 30 || r.Interval() != time.Second/30 {
		t.Fatalf("başlangıç %d", r.FPS())
	}
	for i := 0; i < 200; i++ { // her kare 80 ms: 15 fps bütçesini (66 ms) bile aşar
		r.Observe(80 * time.Millisecond)
	}
	if r.FPS() != minFPS {
		t.Fatalf("yavaş kodlayıcıda fps %d, beklenen %d", r.FPS(), minFPS)
	}
	for i := 0; i < 2000; i++ { // hızlı kodlayıcı: kademeli olarak hedefe döner
		r.Observe(5 * time.Millisecond)
	}
	if r.FPS() != targetFPS {
		t.Fatalf("hızlı kodlayıcıda fps %d", r.FPS())
	}
}

func TestBitrateBounds(t *testing.T) {
	if b := bitrateFor(1920, 1080, 30); b < 4_000_000 || b > 5_000_000 {
		t.Fatalf("1080p30 %d", b)
	}
	if b := bitrateFor(2, 2, 15); b != 300_000 {
		t.Fatalf("alt sınır %d", b)
	}
	if b := bitrateFor(7680, 4320, 60); b != 8_000_000 {
		t.Fatalf("üst sınır %d", b)
	}
}

func TestKeyClockPLIRateLimited(t *testing.T) {
	var k keyClock
	t0 := time.Unix(1000, 0)
	if !k.Due(t0) {
		t.Fatal("ilk kare anahtar olmalı")
	}
	k.Mark(t0)
	if k.Due(t0.Add(100 * time.Millisecond)) {
		t.Fatal("istek yokken erken anahtar kare")
	}
	k.Request()
	if !k.Pending() || k.Due(t0.Add(200*time.Millisecond)) {
		t.Fatal("PLI seli sınırı (500 ms) uygulanmadı")
	}
	if !k.Due(t0.Add(600 * time.Millisecond)) {
		t.Fatal("PLI sonrası anahtar kare yok")
	}
	k.Mark(t0.Add(600 * time.Millisecond))
	if k.Pending() || !k.Due(t0.Add(600*time.Millisecond+gopDuration)) {
		t.Fatal("GOP süresi dolunca anahtar kare yok")
	}
}
