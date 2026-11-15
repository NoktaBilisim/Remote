package capture

import (
	"bytes"
	"fmt"
	"math/rand"
	"testing"
)

// paint yüzeyin (yüzey koordinatı) r bölgesini rastgele piksellerle değiştirir (kırpılarak).
func paint(rng *rand.Rand, src []byte, w, h, stride int, r Rect) {
	for y := max(r.Y0, 0); y < min(r.Y1, h); y++ {
		for x := max(r.X0, 0); x < min(r.X1, w); x++ {
			o := y*stride + x*4
			src[o], src[o+1], src[o+2] = byte(rng.Intn(256)), byte(rng.Intn(256)), byte(rng.Intn(256))
		}
	}
}

// randRect yüzeyde (bazen kenara dayalı, bazen taşan, bazen 1 px) rastgele dikdörtgen.
func randRect(rng *rand.Rand, w, h int) Rect {
	x0, y0 := rng.Intn(w), rng.Intn(h)
	rw, rh := 1+rng.Intn(max(1, w/4)), 1+rng.Intn(max(1, h/4))
	switch rng.Intn(5) {
	case 0: // sağ alt kenara dayalı
		x0, y0 = w-rw, h-rh
	case 1: // sol üst köşe
		x0, y0 = 0, 0
	case 2: // dışarı taşan (sürücü kırpmamış olabilir)
		rw, rh = w, h
	}
	return Rect{max(x0, 0), max(y0, 0), x0 + rw, y0 + rh}
}

// AC-246: kirli bölge dönüşümü, her karede (imleç hareketi dahil) tam dönüşüm + imleçle bayt bayt aynıdır. Ölçek
// (2560×1440 → 1920×1080, tek boyut), dört döndürme, satır dolgusu, kenar/taşan dikdörtgenler ve ardışık kareler.
func TestAC246PartialConversionEqualsFull(t *testing.T) {
	sizes := [][2]int{{64, 48}, {67, 35}, {2560, 1440}, {1366, 768}, {1365, 767}}
	shapes := []PointerShape{arrow(), colorBlob(9, 7, false), colorBlob(6, 6, true)}
	for _, sz := range sizes {
		for _, rot := range []Rotation{RotNone, Rot90, Rot180, Rot270} {
			sw, sh := sz[0], sz[1]
			t.Run(fmt.Sprintf("%dx%d_rot%d", sw, sh, rot), func(t *testing.T) {
				rng := rand.New(rand.NewSource(int64(sw*7 + sh*3 + int(rot))))
				stride := sw*4 + 12
				src := gradient(sw, sh, stride)
				dw, dh := DesktopSize(sw, sh, rot)
				ow, oh := OutputSize(dw, dh)
				var cv frameConv
				cur := &Cursor{Visible: true, X: dw / 3, Y: dh / 3, Shape: shapes[0]}
				frames := 12
				if sw > 1000 {
					frames = 4 // büyük yüzeyde tam referans pahalı
				}
				for f := 0; f < frames; f++ {
					dmg := Damage{Full: f == 0}
					if f > 0 {
						n := 1 + rng.Intn(6)
						if rng.Intn(4) == 0 {
							n = 0 // yalnız imleç değişti
						}
						for i := 0; i < n; i++ {
							r := randRect(rng, sw, sh)
							paint(rng, src, sw, sh, stride, r)
							dmg.Rects = append(dmg.Rects, r)
						}
						// imleç hareketi/şekil/görünürlük değişimi (kenarda kırpılma dahil)
						cur = &Cursor{Visible: rng.Intn(5) != 0, X: rng.Intn(dw+20) - 10, Y: rng.Intn(dh+20) - 10, Shape: shapes[rng.Intn(len(shapes))]}
					}
					resized, err := cv.convert(src, sw, sh, stride, rot, cur, dmg)
					if err != nil {
						t.Fatal(err)
					}
					if resized != (f == 0) {
						t.Fatalf("kare %d: resized=%v", f, resized)
					}
					want := overlay(t, src, sw, sh, stride, rot, cur, ow, oh)
					if !bytes.Equal(cv.frame.Data, want.Data) {
						t.Fatalf("kare %d: kısmi dönüşüm tam dönüşümden farklı (%d dikdörtgen)", f, len(dmg.Rects))
					}
				}
			})
		}
	}
}

// Kısmi yolun gerçekten kullanıldığını ve tam dönüşüm koşullarını doğrular: kirli bölge dışındaki tampon baytları
// dokunulmadan kalır; Full, > 64 dikdörtgen, boyut/döndürme değişimi ve invalidate tam dönüşüme düşer.
func TestAC246FullConversionTriggers(t *testing.T) {
	const sw, sh = 256, 128
	stride := sw * 4
	src := gradient(sw, sh, stride)
	var cv frameConv
	if _, err := cv.convert(src, sw, sh, stride, RotNone, nil, Damage{Full: true}); err != nil {
		t.Fatal(err)
	}
	poison := func() { cv.frame.Data[sh-1] ^= 0xFF } // sol üst köşe dışında, sağ üstte bir Y baytı (kirli değil)
	untouched := func(d Damage) bool {
		t.Helper()
		poison()
		if _, err := cv.convert(src, sw, sh, stride, RotNone, nil, d); err != nil {
			t.Fatal(err)
		}
		ref := overlay(t, src, sw, sh, stride, RotNone, nil, sw, sh)
		return !bytes.Equal(cv.frame.Data, ref.Data)
	}
	small := Damage{Rects: []Rect{{0, 0, 4, 4}}}
	if !untouched(small) {
		t.Fatal("küçük kirli bölgede tam dönüşüm yapıldı")
	}
	cv.frame.Data[sh-1] ^= 0xFF // geri al
	if untouched(Damage{Full: true}) {
		t.Fatal("Full tam dönüşüm yapmadı")
	}
	many := Damage{}
	for i := 0; i <= maxDirtyRects; i++ {
		many.Rects = append(many.Rects, Rect{0, 0, 2, 2})
	}
	if untouched(many) {
		t.Fatal("> 64 dikdörtgende tam dönüşüm yapılmadı")
	}
	cv.invalidate()
	if untouched(small) {
		t.Fatal("invalidate sonrası tam dönüşüm yapılmadı")
	}
	// Döndürme değişimi (aynı çıkış boyutu olmasa da) tam dönüşüm.
	if _, err := cv.convert(src, sw, sh, stride, Rot180, nil, small); err != nil {
		t.Fatal(err)
	}
	if ref := overlay(t, src, sw, sh, stride, Rot180, nil, sw, sh); !bytes.Equal(cv.frame.Data, ref.Data) {
		t.Fatal("döndürme değişiminde tam dönüşüm yapılmadı")
	}
}

func TestAC246RegionsAligned16AndClipped(t *testing.T) {
	cases := []struct {
		r          Rect
		dw, dh     int
		W, H       int
		want       Rect
		wantNonNil bool
	}{
		{Rect{17, 3, 18, 4}, 1920, 1080, 1920, 1080, Rect{16, 0, 32, 16}, true},
		{Rect{1900, 1070, 1920, 1080}, 1920, 1080, 1920, 1080, Rect{1888, 1056, 1920, 1080}, true},
		{Rect{1366 - 1, 0, 1366, 1}, 1366, 768, 1366, 768, Rect{1360, 0, 1366, 16}, true},
		{Rect{2558, 1438, 2560, 1440}, 2560, 1440, 1920, 1080, Rect{1904, 1072, 1920, 1080}, true},
		{Rect{2559, 0, 2560, 4}, 2560, 1440, 1920, 1080, Rect{}, false}, // küçültmede örneklenmeyen sütun
		{Rect{5, 5, 5, 9}, 1920, 1080, 1920, 1080, Rect{}, false},
	}
	for _, c := range cases {
		got, ok := desktopRegion(c.r, c.dw, c.dh, c.W, c.H)
		if ok != c.wantNonNil || (ok && got != c.want) {
			t.Fatalf("%+v → %+v %v, beklenen %+v", c.r, got, ok, c.want)
		}
	}
	if err := ConvertBGRARegions(NewNV12(4, 4), solid(4, 4, 0, 0, 0), 4, 4, 16, RotNone, []Rect{{1, 0, 4, 4}}); err == nil {
		t.Fatal("tek kenarlı bölge reddedilmeli")
	}
}

// Ölçüm (AC-246, saf Go): 1080p durağan masaüstünde tipik değişim (saat + imleç yanıp sönmesi + imleç) ve yazma
// (10 satır parçası) için kısmi dönüşümün tam dönüşüme göre maliyeti. Gerçek CPU ölçümü (60 sn, 0.10.x tabanı D12)
// Windows'ta I6'da yapılır.
func BenchmarkAC246Convert1080p(b *testing.B) {
	const sw, sh = 1920, 1080
	stride := sw * 4
	src := gradient(sw, sh, stride)
	cur := &Cursor{Visible: true, X: 900, Y: 500, Shape: arrow()}
	idle := Damage{Rects: []Rect{{1800, 1040, 1900, 1075}, {400, 300, 402, 320}}} // saat + metin imleci
	typing := Damage{}
	for i := 0; i < 10; i++ {
		typing.Rects = append(typing.Rects, Rect{100, 200 + i*24, 900, 220 + i*24})
	}
	run := func(name string, d Damage) {
		b.Run(name, func(b *testing.B) {
			var cv frameConv
			if _, err := cv.convert(src, sw, sh, stride, RotNone, cur, Damage{Full: true}); err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := cv.convert(src, sw, sh, stride, RotNone, cur, d); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
	run("full", Damage{Full: true})
	run("idle_dirty", idle)
	run("typing_dirty", typing)
}
