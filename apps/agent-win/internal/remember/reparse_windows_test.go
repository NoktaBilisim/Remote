//go:build windows && (amd64 || arm64)

package remember

import (
	"crypto/sha256"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"remote-support/agent-win/internal/diag"
)

// AC-249 Windows birim testleri (CI windows-2025): kayitlar.bin yazma/okuma/silme junction ve bağlantıları izlemez;
// hedef dışı dosya değişmez (SHA-256 eşit).

func mkJunction(t *testing.T, link, target string) {
	t.Helper()
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Fatalf("junction oluşturulamadı: %v %s", err, out)
	}
}

func fileSum(t *testing.T, path string) [32]byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(b)
}

// target içinde kayitlar.bin adında kurban dosya: bağlantı izlenseydi üzerine yazılır/silinirdi.
func plantVictim(t *testing.T, target string) (string, [32]byte) {
	t.Helper()
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatal(err)
	}
	v := filepath.Join(target, fileName)
	if err := os.WriteFile(v, []byte("korunan içerik"), 0o600); err != nil {
		t.Fatal(err)
	}
	return v, fileSum(t, v)
}

func TestAC249JunctionStoreDirWriteLoadForgetRefused(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "hedef")
	v, sum := plantVictim(t, target)
	link := filepath.Join(base, "NoktaDestek")
	mkJunction(t, link, target)
	s := &Store{Dir: link, Protect: xorSeal, Unprotect: xorSeal}
	if err := s.SaveBinding(sampleBinding(), ""); !errors.Is(err, diag.ErrReparse) {
		t.Fatalf("junction klasörüne yazılmamalı: %v", err)
	}
	if _, ok := s.Load(); ok {
		t.Fatal("junction üzerinden okunmamalı")
	}
	if err := s.ForgetAll(); !errors.Is(err, diag.ErrReparse) {
		t.Fatalf("junction üzerinden silinmemeli: %v", err)
	}
	if fileSum(t, v) != sum {
		t.Fatal("hedef dosya değişmemeli")
	}
	if ents, _ := os.ReadDir(target); len(ents) != 1 {
		t.Fatalf("hedefte yeni dosya oluşmamalı: %v", ents)
	}
}

func TestAC249JunctionParentChainRefused(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "hedef")
	v, sum := plantVictim(t, filepath.Join(target, "NoktaDestek"))
	local := filepath.Join(base, "Local")
	mkJunction(t, local, target)
	s := &Store{Dir: filepath.Join(local, "NoktaDestek"), Protect: xorSeal, Unprotect: xorSeal}
	if err := s.SavePersonal(samplePersonal()); !errors.Is(err, diag.ErrReparse) {
		t.Fatalf("üst klasör junction iken yazılmamalı: %v", err)
	}
	if err := s.ForgetAll(); !errors.Is(err, diag.ErrReparse) {
		t.Fatalf("üst klasör junction iken silinmemeli: %v", err)
	}
	if fileSum(t, v) != sum {
		t.Fatal("hedef dosya değişmemeli")
	}
}

func TestAC249SymlinkFileNotFollowed(t *testing.T) {
	base := t.TempDir()
	v, sum := plantVictim(t, filepath.Join(base, "hedef"))
	s := store(t)
	if err := os.Mkdir(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(v, filepath.Join(s.Dir, fileName)); err != nil {
		t.Skip("dosya sembolik bağlantısı için ayrıcalık yok:", err)
	}
	if _, ok := s.Load(); ok {
		t.Fatal("bağlantı okunmamalı")
	}
	if err := s.SavePersonal(samplePersonal()); !errors.Is(err, diag.ErrReparse) {
		t.Fatalf("bağlantının üzerine taşınmamalı: %v", err)
	}
	if err := s.ForgetAll(); !errors.Is(err, diag.ErrReparse) {
		t.Fatalf("bağlantı silinmemeli (reddedilmeli): %v", err)
	}
	if fileSum(t, v) != sum {
		t.Fatal("hedef dosya değişmemeli")
	}
	if _, err := os.Stat(filepath.Join(s.Dir, tmpName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("başarısız yazımda tmp kalmamalı")
	}
}

// Silme handle üzerinden: kayitlar.bin kurbanın sabit bağıysa unutma yalnız bağı kaldırır, kurban kalır.
func TestAC249HardLinkForgetRemovesOnlyLink(t *testing.T) {
	base := t.TempDir()
	v, sum := plantVictim(t, filepath.Join(base, "hedef"))
	s := store(t)
	if err := os.Mkdir(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(v, filepath.Join(s.Dir, fileName)); err != nil {
		t.Fatal(err)
	}
	if err := s.ForgetAll(); err != nil {
		t.Fatal(err)
	}
	if fileSum(t, v) != sum {
		t.Fatal("kurban dosya değişmemeli")
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("boşalan klasör silinmeli")
	}
}
