//go:build windows

package helper

import (
	"testing"
	"time"

	"remote-support/agent-win/internal/annot"
	"remote-support/agent-win/internal/win"
)

// P30 Windows CI (mimari-p30 §9, AC-495/496): gerçek gösterge + işaretleme katmanı. Etkileşimli masaüstü yoksa
// (gösterge çizilemez) SKIP; kanıt o durumda staging elle turundan gelir.

func showForTest(t *testing.T) *winIndicator {
	t.Helper()
	ind, err := showIndicator("P30 test")
	if err != nil {
		t.Skipf("gösterge çizilemedi (etkileşimsiz oturum?): %v", err)
	}
	t.Cleanup(ind.Close)
	return ind.(*winIndicator)
}

func waitLayer(ind *winIndicator, want bool) uintptr {
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if l := ind.layer.Load(); (l != 0) == want {
			return l
		}
		time.Sleep(10 * time.Millisecond)
	}
	return ind.layer.Load()
}

// AC-495: katman tıklama geçirgen, etkinleşmez, katmanlı, en üstte ve yakalamadan hariç; paylaşılan monitörü kaplar.
// AC-496: katman göstergenin doğrulama kümesine girmez — sonraki doğrulama tikleri başarısız olmaz.
func TestAC495P30LayerStyleAndCaptureExclusion(t *testing.T) {
	ind := showForTest(t)
	ind.Paint(annotSnap{Surface: 1, Strokes: []annot.Stroke{{ID: "a", Tool: "rect", Color: "red", Pts: [][2]float64{{0.1, 0.1}, {0.4, 0.4}}}}})
	l := waitLayer(ind, true)
	if l == 0 {
		t.Fatal("katman kurulmadı")
	}
	want := uint32(win.WS_EX_TRANSPARENT | win.WS_EX_NOACTIVATE | win.WS_EX_LAYERED | win.WS_EX_TOPMOST)
	if ex := win.ExStyle(l); ex&want != want {
		t.Fatalf("katman stili %#x, beklenen bayraklar %#x", ex, want)
	}
	if a := win.DisplayAffinity(l); a != win.WDA_EXCLUDEFROMCAP {
		t.Fatalf("yakalama dışlama %#x", a)
	}
	mons := win.Monitors()
	if r, ok := win.WindowBounds(l); !ok || r != mons[0].Rect {
		t.Fatalf("katman %+v, monitör %+v", r, mons[0].Rect)
	}
	time.Sleep(2200 * time.Millisecond) // iki doğrulama tiki (katman wins dışında)
	select {
	case <-ind.Failed():
		t.Fatal("katman gösterge doğrulamasını bozdu")
	default:
	}
	ind.Paint(annotSnap{Surface: 0})
	if waitLayer(ind, false) != 0 {
		t.Fatal("bilinmeyen yüzeyde katman kaldırılmadı")
	}
}

// AC-496 (K-P30-2): katman kurulamazsa (geçersiz monitör) yalnız çizim görünmez; gösterge başarısız sayılmaz.
func TestAC496P30LayerFailureKeepsIndicator(t *testing.T) {
	ind := showForTest(t)
	ind.Paint(annotSnap{Surface: 99, Strokes: []annot.Stroke{{ID: "a", Pts: [][2]float64{{0, 0}}}}})
	time.Sleep(1200 * time.Millisecond)
	if ind.layer.Load() != 0 {
		t.Fatal("geçersiz monitörde katman kuruldu")
	}
	select {
	case <-ind.Failed():
		t.Fatal("katman hatası göstergeyi başarısız saydı")
	default:
	}
}

// P30 güvenlik turu (YÜKSEK): en kötü çizim yükü (toplam nokta bütçesi kadar tam ekran zikzak + ~1 kHz lazer) altında
// doğrulama turu ≤ 1,5 sn aralıkla sürer ve gösterge başarısız sayılmaz (boyama ≈ 30 Hz, wmAnnot birleşir).
func TestAC342P30TickUnderAnnotFlood(t *testing.T) {
	ind := showForTest(t)
	zig := make([][2]float64, 500)
	for i := range zig {
		zig[i] = [2]float64{float64(i%2) * 1, float64(i) / 499}
	}
	var strokes []annot.Stroke
	for range annot.MaxPoints / 500 {
		strokes = append(strokes, annot.Stroke{ID: "z", Tool: "pen", Color: "red", Pts: zig})
	}
	stop := make(chan struct{})
	go func() {
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			case <-time.After(time.Millisecond):
			}
			p := [2]float64{float64(i%100) / 100, 0.5}
			ind.Paint(annotSnap{Surface: 1, Strokes: strokes, Laser: &p, LaserAt: time.Now()})
		}
	}()
	defer close(stop)
	prev, maxGap := ind.tickedAt(), time.Duration(0)
	end := time.Now().Add(5 * time.Second)
	for time.Now().Before(end) {
		time.Sleep(10 * time.Millisecond)
		if at := ind.tickedAt(); at != prev {
			maxGap, prev = max(maxGap, at.Sub(prev)), at
		}
	}
	maxGap = max(maxGap, time.Since(prev))
	t.Logf("yük altında en uzun doğrulama aralığı: %v", maxGap)
	if maxGap > 1500*time.Millisecond {
		t.Fatalf("doğrulama turu %v aç kaldı (≤ 1,5 sn beklenir)", maxGap)
	}
	select {
	case <-ind.Failed():
		t.Fatal("yük altında gösterge başarısız sayıldı")
	default:
	}
}
