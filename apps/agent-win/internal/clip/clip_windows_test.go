//go:build windows

package clip

import (
	"errors"
	"testing"
)

// Gerçek pano (Windows CI): yazılan metin geçmiş/bulut dışı işaretlendiği için geri okununca SENSITIVE döner
// (§5.3 r2 D-P28a-2 — güvenli taraf); büyük metin yazılmaz.
func TestP28aClipWindowsWriteMarksSensitive(t *testing.T) {
	c, err := New()
	if err != nil {
		t.Skipf("pano iş parçacığı açılmadı: %v", err)
	}
	defer c.Close()
	if err := c.WriteText("P28a K4 pano testi\r\nğüş"); err != nil {
		t.Skipf("pano yazılamadı (etkileşimsiz oturum olabilir): %v", err)
	}
	if _, err := c.ReadText(); !errors.Is(err, ErrSensitive) {
		t.Fatalf("geri okuma = %v, SENSITIVE beklenir", err)
	}
	if err := c.WriteText(string(make([]byte, MaxBytes+1))); err == nil {
		t.Fatal("64 KB üstü yazıldı")
	}
}
