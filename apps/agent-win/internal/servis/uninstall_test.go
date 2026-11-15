package servis

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// D-P27-K5: kopya klasörü yalnız SY/BA'ya açık, devralma kapalı; adı rastgele ve tanınabilir; içerik SHA-256 ile denetlenir.

func TestDP27K5UninstallTempSDDL(t *testing.T) {
	if UninstallTempSDDL != DataDirSDDL {
		t.Fatalf("SDDL veri klasörüyle aynı (SY+BA tam, korumalı) olmalı: %q", UninstallTempSDDL)
	}
	if !strings.Contains(UninstallTempSDDL, "D:P(") || strings.Count(UninstallTempSDDL, "(A;") != 2 {
		t.Fatalf("DACL korumalı ve yalnız iki izin ACE'si olmalı: %q", UninstallTempSDDL)
	}
	for _, sid := range []string{";;;BU)", ";;;AU)", ";;;WD)", ";;;IU)"} {
		if strings.Contains(UninstallTempSDDL, sid) {
			t.Fatalf("kullanıcı grubuna erişim var: %q", UninstallTempSDDL)
		}
	}
}

func TestDP27K5UninstallTempPath(t *testing.T) {
	base := filepath.Join("C:", "Windows", "Temp")
	dir := UninstallTempDir(base, [8]byte{0, 1, 2, 3, 0xab, 0xcd, 0xef, 0xff})
	if filepath.Dir(dir) != base || filepath.Base(dir) != "NoktaDestekServis-kaldir-00010203abcdefff" {
		t.Fatalf("klasör yolu: %q", dir)
	}
	if !IsUninstallTemp(filepath.Join(dir, ExeName)) {
		t.Fatal("geçici kopya tanınmadı")
	}
	bad := []string{
		filepath.Join(dir, "baska.exe"),
		filepath.Join(base, "NoktaDestekServis-kaldir-00010203abcdeff", ExeName),   // 15 hex
		filepath.Join(base, "NoktaDestekServis-kaldir-00010203ABCDEFFF", ExeName),  // büyük harf üretilmez
		filepath.Join(base, "NoktaDestekServis-kaldir-00010203abcdefzz", ExeName),  // hex değil
		filepath.Join(base, "NoktaDestek Servis", ExeName),                         // kurulu klasör
		filepath.Join(base, "x", "NoktaDestekServis-kaldir-00010203abcdefff", "a"), // yanlış ad
	}
	for _, p := range bad {
		if IsUninstallTemp(p) {
			t.Fatalf("yanlış tanındı: %q", p)
		}
	}
}

type failReader struct{}

func (failReader) Read([]byte) (int, error) { return 0, errors.New("okuma") }

func TestDP27K5SameContent(t *testing.T) {
	same, err := SameContent(strings.NewReader("MZ ikili"), strings.NewReader("MZ ikili"))
	if err != nil || !same {
		t.Fatalf("aynı içerik: %v %v", same, err)
	}
	same, err = SameContent(strings.NewReader("MZ ikili"), strings.NewReader("MZ ikilX"))
	if err != nil || same {
		t.Fatalf("değiştirilmiş kopya kabul edildi: %v %v", same, err)
	}
	if _, err := SameContent(strings.NewReader("a"), failReader{}); err == nil {
		t.Fatal("okuma hatası yutuldu")
	}
}
