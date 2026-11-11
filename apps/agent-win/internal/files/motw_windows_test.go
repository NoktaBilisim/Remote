//go:build windows

package files

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// QA-P6-4 / G-06: gerçek NTFS'te `:Zone.Identifier` ADS'ine ZoneId=3 yazılır.
func TestAC117WriteMOTWZoneInternet(t *testing.T) {
	p := filepath.Join(t.TempDir(), "kurulum.exe")
	if err := os.WriteFile(p, []byte("MZ"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := WriteMOTW(p); err != nil {
		t.Fatalf("WriteMOTW: %v", err)
	}
	b, err := os.ReadFile(p + ":Zone.Identifier")
	if err != nil {
		t.Fatalf("ADS okunamadı: %v", err)
	}
	if !strings.Contains(string(b), "[ZoneTransfer]") || !strings.Contains(string(b), "ZoneId=3") {
		t.Fatalf("ADS içeriği: %q", b)
	}
	if main, _ := os.ReadFile(p); string(main) != "MZ" {
		t.Fatal("ana akış değişti")
	}
}
