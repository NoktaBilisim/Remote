//go:build darwin

package input

import "testing"

// P33 K2 (K0s-W3 otomatik kısım): gerçek CG/AX sorguları çökmeden döner; ekrandaki pencereler okunur, tercih
// alanı okunur. Değerler (PID, katman) loglanır; başlık okunmaz.
func TestP33K2MacQuerySmoke(t *testing.T) {
	q := macOSQuery{}
	ws := q.OnScreen()
	layers := map[int]int{}
	for _, w := range ws {
		layers[w.Layer]++
	}
	t.Logf("ekrandaki pencere %d, katmanlar %v", len(ws), layers)
	if len(ws) > 0 {
		if _, ok := q.Win(ws[0].ID); !ok {
			t.Fatal("tek pencere sorgusu ekrandaki pencereyi bulamadı")
		}
	}
	f, err := q.Focused()
	t.Logf("AX odak: pid=%d rol=%q err=%v (Erişilebilirlik izni yoksa hata beklenir → düşer)", f.PID, f.Role, err)
	t.Logf("Yapışkan Tuşlar=%v Fare Tuşları=%v bayrak=0x%x", StickyKeysOn(), MouseKeysOn(), q.Flags())
	m := NewMacWindowAPI(0)
	if m.Exists(0) || m.ForegroundRoot() != 0 {
		t.Fatal("kimlik 0 hiçbir pencereye eşlenmemeli")
	}
}
