//go:build windows

package dllsafe

import (
	"testing"

	"golang.org/x/sys/windows"
)

// QA-P6-4 / AC-118: Harden hatasız döner ve sonrasında System32 DLL'i yüklenebilir (arama sırası bozulmaz).
func TestAC118HardenSucceeds(t *testing.T) {
	if err := Harden(); err != nil {
		t.Fatalf("Harden: %v", err)
	}
	if err := Harden(); err != nil { // tekrar çağrı da güvenli
		t.Fatalf("ikinci Harden: %v", err)
	}
	if err := windows.NewLazySystemDLL("user32.dll").Load(); err != nil {
		t.Fatalf("System32 DLL yüklenemedi: %v", err)
	}
}
