package capture

import (
	"bytes"
	"testing"
)

// mono w×h imleç: and/xor maskeleri satır satır bit dizgisi ("1" = bit set).
func monoShape(and, xor []string) PointerShape {
	w := len(and[0])
	pitch := (w + 7) / 8
	data := make([]byte, pitch*len(and)*2)
	set := func(rows []string, base int) {
		for y, row := range rows {
			for x, ch := range row {
				if ch == '1' {
					data[(base+y)*pitch+x/8] |= 0x80 >> (x % 8)
				}
			}
		}
	}
	set(and, 0)
	set(xor, len(and))
	return PointerShape{Type: PointerMono, W: w, H: len(and) * 2, Pitch: pitch, Data: data}
}

func colorShape(typ uint32, px ...[4]byte) PointerShape {
	data := make([]byte, 0, len(px)*4)
	for _, p := range px {
		data = append(data, p[:]...)
	}
	return PointerShape{Type: typ, W: len(px), H: 1, Pitch: len(px) * 4, Data: data}
}

func pix(p []byte, i int) [3]byte { return [3]byte{p[i*4], p[i*4+1], p[i*4+2]} }

func TestPointerMonoAndXor(t *testing.T) {
	// AND/XOR: 1/0 saydam, 0/0 siyah, 0/1 beyaz, 1/1 ters.
	s := monoShape([]string{"1001"}, []string{"0011"})
	patch := []byte{10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255}
	BlendPointer(patch, 4, 1, 0, 0, &s)
	want := [][3]byte{{10, 20, 30}, {0, 0, 0}, {255, 255, 255}, {245, 235, 225}}
	for i, w := range want {
		if got := pix(patch, i); got != w {
			t.Fatalf("piksel %d = %v, beklenen %v", i, got, w)
		}
	}
	if patch[3] != 255 {
		t.Fatal("alfa baytı değişmemeli")
	}
}

func TestPointerMonoWideRowsUseByteBoundaries(t *testing.T) {
	// 10 piksel genişlik: ikinci bayta taşan bitler ve satır adımı (2 bayt) doğru okunmalı.
	s := monoShape([]string{"1111111110", "0111111111"}, []string{"0000000000", "0000000000"})
	patch := solid(10, 2, 200, 200, 200)
	BlendPointer(patch, 10, 2, 0, 0, &s)
	for i, w := range []byte{200, 200, 200, 200, 200, 200, 200, 200, 200, 0, 0, 200, 200, 200, 200, 200, 200, 200, 200, 200} {
		if patch[i*4] != w {
			t.Fatalf("piksel %d = %d, beklenen %d", i, patch[i*4], w)
		}
	}
}

func TestPointerColorAlpha(t *testing.T) {
	s := colorShape(PointerColor, [4]byte{0, 0, 255, 0}, [4]byte{0, 0, 255, 255}, [4]byte{0, 0, 255, 128})
	patch := solid(3, 1, 100, 100, 100)
	BlendPointer(patch, 3, 1, 0, 0, &s)
	want := [][3]byte{{100, 100, 100}, {0, 0, 255}, {50, 50, 178}}
	for i, w := range want {
		if got := pix(patch, i); got != w {
			t.Fatalf("piksel %d = %v, beklenen %v", i, got, w)
		}
	}
}

func TestPointerMaskedColor(t *testing.T) {
	// alfa 0: renk kopyalanır; alfa 0xFF: XOR (0 → saydam, FFFFFF → ters).
	s := colorShape(PointerMaskedColor, [4]byte{1, 2, 3, 0}, [4]byte{0, 0, 0, 0xFF}, [4]byte{0xFF, 0xFF, 0xFF, 0xFF})
	patch := solid(3, 1, 10, 20, 30)
	BlendPointer(patch, 3, 1, 0, 0, &s)
	want := [][3]byte{{1, 2, 3}, {10, 20, 30}, {245, 235, 225}}
	for i, w := range want {
		if got := pix(patch, i); got != w {
			t.Fatalf("piksel %d = %v, beklenen %v", i, got, w)
		}
	}
}

func TestPointerShapeValidation(t *testing.T) {
	good := monoShape([]string{"1"}, []string{"0"})
	cases := []PointerShape{
		{Type: 3, W: 1, H: 1, Pitch: 4, Data: make([]byte, 4)},            // bilinmeyen tür
		{Type: PointerColor, W: 2, H: 1, Pitch: 4, Data: make([]byte, 8)}, // satır adımı < W*4
		{Type: PointerColor, W: 1, H: 2, Pitch: 4, Data: make([]byte, 4)}, // kısa tampon
		{Type: PointerMono, W: 8, H: 3, Pitch: 1, Data: make([]byte, 3)},  // tek satır sayısı
		{Type: PointerMono, W: 9, H: 2, Pitch: 1, Data: make([]byte, 2)},  // 9 bit 1 bayta sığmaz
		{Type: PointerColor, W: 0, H: 1, Pitch: 4, Data: make([]byte, 4)}, // boş
		{Type: PointerMaskedColor, W: 1, H: 1, Pitch: 0, Data: []byte{1}}, // sıfır adım
	}
	if _, _, ok := good.Size(); !ok {
		t.Fatal("geçerli mono şekil reddedildi")
	}
	for i, s := range cases {
		if _, _, ok := s.Size(); ok {
			t.Fatalf("durum %d kabul edildi", i)
		}
		patch := solid(2, 2, 1, 2, 3)
		BlendPointer(patch, 2, 2, 0, 0, &s)
		if !bytes.Equal(patch, solid(2, 2, 1, 2, 3)) {
			t.Fatalf("durum %d: geçersiz şekil çizildi", i)
		}
	}
}

// gradient, her pikseli farklı bir yüzey (satır sonunda dolgu ile).
func gradient(w, h, stride int) []byte {
	src := make([]byte, stride*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			o := y*stride + x*4
			src[o], src[o+1], src[o+2], src[o+3] = byte(x*37+y*11), byte(x*5+y*71), byte(x*13^y*29), 255
		}
	}
	return src
}

// reference imleci önce yüzeye (piksel piksel, masaüstü koordinatında) çizip ConvertBGRA'dan geçirir.
func reference(t *testing.T, src []byte, sw, sh, stride int, rot Rotation, c *Cursor, ow, oh int) *NV12 {
	t.Helper()
	cp := append([]byte(nil), src...)
	if c.Visible {
		w, h, ok := c.Shape.Size()
		dw, dh := DesktopSize(sw, sh, rot)
		for y := 0; ok && y < h; y++ {
			for x := 0; x < w; x++ {
				dx, dy := c.X+x, c.Y+y
				if dx < 0 || dy < 0 || dx >= dw || dy >= dh {
					continue
				}
				o := srcOffset(dx, dy, sw, sh, stride, rot)
				BlendPointer(cp[o:o+4], 1, 1, x, y, &c.Shape)
			}
		}
	}
	dst := NewNV12(ow, oh)
	if err := ConvertBGRA(dst, cp, sw, sh, stride, rot); err != nil {
		t.Fatal(err)
	}
	return dst
}

func overlay(t *testing.T, src []byte, sw, sh, stride int, rot Rotation, c *Cursor, ow, oh int) *NV12 {
	t.Helper()
	dst := NewNV12(ow, oh)
	if err := ConvertBGRA(dst, src, sw, sh, stride, rot); err != nil {
		t.Fatal(err)
	}
	if err := OverlayCursor(dst, src, sw, sh, stride, rot, c); err != nil {
		t.Fatal(err)
	}
	return dst
}

func arrow() PointerShape {
	return monoShape(
		[]string{"0111111", "0011111", "0001111", "0000111", "0000011"},
		[]string{"0000000", "0100000", "0110000", "0111000", "0111100"})
}

func colorBlob(w, h int, masked bool) PointerShape {
	typ := uint32(PointerColor)
	if masked {
		typ = PointerMaskedColor
	}
	s := PointerShape{Type: typ, W: w, H: h, Pitch: w*4 + 4, Data: make([]byte, (w*4+4)*h)}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			o := y*s.Pitch + x*4
			s.Data[o], s.Data[o+1], s.Data[o+2], s.Data[o+3] = byte(x*40), byte(y*50), 200, byte((x+y)*60)
			if masked && (x+y)%2 == 0 {
				s.Data[o+3] = 0xFF
			}
		}
	}
	return s
}

// İmleçli NV12, imlecin yüzeye çizilip tüm karenin dönüştürülmesiyle bayt bayt aynı olmalı: döndürme, küçültme ve
// kenar kırpma dahil.
func TestOverlayMatchesComposedConversion(t *testing.T) {
	shapes := map[string]PointerShape{"mono": arrow(), "renkli": colorBlob(6, 5, false), "maskeli": colorBlob(5, 6, true)}
	positions := [][2]int{{3, 2}, {-3, -2}, {-6, 1}, {20, 9}, {0, 0}, {17, 13}}
	sizes := []struct{ sw, sh, ow, oh int }{{22, 14, 22, 14}, {22, 14, 10, 6}, {21, 15, 12, 8}}
	for name, s := range shapes {
		for _, sz := range sizes {
			stride := sz.sw*4 + 12
			src := gradient(sz.sw, sz.sh, stride)
			for _, rot := range []Rotation{RotNone, Rot90, Rot180, Rot270} {
				ow, oh := sz.ow, sz.oh
				if rot == Rot90 || rot == Rot270 {
					ow, oh = oh, ow
				}
				for _, p := range positions {
					c := &Cursor{Visible: true, X: p[0], Y: p[1], Shape: s}
					got := overlay(t, src, sz.sw, sz.sh, stride, rot, c, ow, oh)
					want := reference(t, src, sz.sw, sz.sh, stride, rot, c, ow, oh)
					if !bytes.Equal(got.Data, want.Data) {
						t.Fatalf("%s %dx%d→%dx%d rot=%d konum=%v: bindirme, birleşik dönüşümden farklı", name, sz.sw, sz.sh, ow, oh, rot, p)
					}
				}
			}
		}
	}
}

func TestOverlayLeavesFrameUnchanged(t *testing.T) {
	const sw, sh = 16, 8
	src := gradient(sw, sh, sw*4)
	plain := NewNV12(sw, sh)
	if err := ConvertBGRA(plain, src, sw, sh, sw*4, RotNone); err != nil {
		t.Fatal(err)
	}
	cases := map[string]*Cursor{
		"görünmez":          {Visible: false, X: 2, Y: 2, Shape: arrow()},
		"nil":               nil,
		"geçersiz şekil":    {Visible: true, X: 2, Y: 2, Shape: PointerShape{Type: PointerColor, W: 4, H: 4, Pitch: 16}},
		"tamamen solda":     {Visible: true, X: -7, Y: 2, Shape: arrow()},
		"tamamen sağ altta": {Visible: true, X: sw, Y: sh, Shape: arrow()},
		"saydam":            {Visible: true, X: 1, Y: 1, Shape: monoShape([]string{"11", "11"}, []string{"00", "00"})},
	}
	for name, c := range cases {
		got := overlay(t, src, sw, sh, sw*4, RotNone, c, sw, sh)
		if !bytes.Equal(got.Data, plain.Data) {
			t.Fatalf("%s: kare değişmemeli", name)
		}
	}
}

func TestOverlayChangesOnlyCursorBlocks(t *testing.T) {
	const sw, sh = 16, 16
	src := solid(sw, sh, 128, 128, 128)
	c := &Cursor{Visible: true, X: 5, Y: 9, Shape: monoShape([]string{"0"}, []string{"0"})} // tek siyah piksel
	got := overlay(t, src, sw, sh, sw*4, RotNone, c, sw, sh)
	for y := 0; y < sh; y++ {
		for x := 0; x < sw; x++ {
			black := got.Data[y*sw+x] == 16
			if black != (x == 5 && y == 9) {
				t.Fatalf("Y(%d,%d)=%d", x, y, got.Data[y*sw+x])
			}
		}
	}
}

func TestOverlayRejectsBadFrame(t *testing.T) {
	c := &Cursor{Visible: true, Shape: arrow()}
	if err := OverlayCursor(NewNV12(4, 4), make([]byte, 10), 4, 4, 16, RotNone, c); err == nil {
		t.Fatal("kısa yüzey reddedilmeli")
	}
}
