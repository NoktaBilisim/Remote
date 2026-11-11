//go:build windows

package transfer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"remote-support/agent-win/internal/files"
)

// S6-3: `.part`'a yazılan MOTW, MoveFileEx ile yeniden adlandırmada dosyayla taşınır; hedef varsa üzerine yazılmaz.
func TestS63MOTWMovesWithRenameNoReplace(t *testing.T) {
	dir := t.TempDir()
	part, final := filepath.Join(dir, "a.exe.part"), filepath.Join(dir, "a.exe")
	if err := os.WriteFile(part, []byte("MZ"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := files.WriteMOTW(part); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(final, []byte("eski"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := renameNoReplace(part, final); err != errExists {
		t.Fatalf("hedef varken: %v", err)
	}
	other := filepath.Join(dir, "a (1).exe")
	if err := renameNoReplace(part, other); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(other + ":Zone.Identifier")
	if err != nil || !strings.Contains(string(b), "ZoneId=3") {
		t.Fatalf("MOTW taşınmadı: %q %v", b, err)
	}
	if old, _ := os.ReadFile(final); string(old) != "eski" {
		t.Fatal("üzerine yazıldı")
	}
}
