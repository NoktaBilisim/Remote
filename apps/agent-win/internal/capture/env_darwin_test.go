//go:build darwin

package capture

import (
	"testing"

	"remote-support/agent-win/internal/env"
)

// AC-105 / AC-392 (mimari-p28f §11; qa P28f m.4): güvenli metin girişi açıkken (parola alanı) ElevatedForeground →
// konsolda "kontrol edilemiyor"; kilit/konsol durumu (SecureDesktop) korunur. Carbon sembolü bu makinede bağlanır.
func TestAC105P28fSecureInputMapsToElevated(t *testing.T) {
	if got := probeState(true, env.State{SecureDesktop: true}); !got.ElevatedForeground || !got.SecureDesktop {
		t.Fatalf("%+v", got)
	}
	if got := probeState(false, env.State{}); got != (env.State{}) {
		t.Fatalf("%+v", got)
	}
	if secureInputFn() == nil {
		t.Fatal("IsSecureEventInputEnabled bağlanamadı")
	}
	t.Logf("güvenli giriş şu an: %v; EnvProbe: %+v", secureInput(), EnvProbe())
}
