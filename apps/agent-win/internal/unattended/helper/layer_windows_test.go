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
