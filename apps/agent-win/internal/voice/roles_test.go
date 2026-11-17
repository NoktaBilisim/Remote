package voice

import "testing"

// TestP28dVoiceRenderOnDefaultDevice saha düzeltmesi 1: çalma varsayılan aygıtta (eConsole = 0), yakalama iletişim
// varsayılanında (eCommunications = 2). Çalmanın yeniden eCommunications'a dönmesi müşterinin teknisyeni duymamasına
// yol açar (iletişim aygıtı kullanıcının hoparlörü olmayabilir).
func TestP28dVoiceRenderOnDefaultDevice(t *testing.T) {
	if renderRole != 0 || captureRole != 2 {
		t.Fatalf("roller: çalma=%d yakalama=%d (beklenen 0/2)", renderRole, captureRole)
	}
}
