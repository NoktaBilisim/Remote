package helper

import (
	"testing"

	"remote-support/agent-win/internal/flow"
)

// Sürüm gösterimi (2026-11-18): gözetimsiz onay penceresinin başlığında sürüm etiketi.
func TestConsentTitleVersion(t *testing.T) {
	tx := flow.UnattendedConsentTexts
	if got := consentTitle(tx.Title, flow.VersionLabel("0.20.0")); got != "Uzaktan bağlantı isteği — Nokta Destek 0.20.0" {
		t.Fatalf("başlık %q", got)
	}
	if got := consentTitle(tx.Title, ""); got != tx.Title {
		t.Fatalf("etiketsiz başlık %q", got)
	}
}
