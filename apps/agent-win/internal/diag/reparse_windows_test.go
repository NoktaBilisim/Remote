//go:build windows

package diag

import (
	"crypto/sha256"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"unsafe"
)

// AC-249 Windows birim testleri (CI windows-2025 job'u). Junction yönetici yetkisi istemez (mklink /J); dosya
// sembolik bağlantısı ayrıcalık ister — yoksa yalnız o alt test atlanır.

func junction(t *testing.T, link, target string) {
	t.Helper()
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, target).CombinedOutput(); err != nil {
		t.Fatalf("junction oluşturulamadı: %v %s", err, out)
	}
}

func digest(t *testing.T, path string) [32]byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(b)
}

// victim hedef klasörde kurban dosya; özetini döner.
func victim(t *testing.T, dir string) (string, [32]byte) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, "kurban.dll")
	if err := os.WriteFile(p, []byte("orijinal içerik"), 0o600); err != nil {
		t.Fatal(err)
	}
	return p, digest(t, p)
}

func entries(t *testing.T, dir string) int {
	t.Helper()
	ents, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return len(ents)
}

func TestAC249JunctionLogDirRefused(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "hedef")
	v, sum := victim(t, target)
	link := filepath.Join(base, "NoktaDestek")
	junction(t, link, target)
	err := (&Log{Dir: link}).Write(sample())
	if !errors.Is(err, ErrReparse) {
		t.Fatalf("junction klasörüne yazılmamalı: %v", err)
	}
	if digest(t, v) != sum || entries(t, target) != 1 {
		t.Fatal("hedef klasör/dosya değişmemeli")
	}
	if _, err := OpenDir(link, false); !errors.Is(err, ErrReparse) {
		t.Fatalf("OpenDir junction reddetmeli: %v", err)
	}
}

// Klasör zinciri: üst klasör (%LOCALAPPDATA% eşi) junction ise içindeki gerçek NoktaDestek de kullanılmaz.
func TestAC249JunctionParentRefused(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "hedef")
	v, sum := victim(t, filepath.Join(target, "NoktaDestek"))
	local := filepath.Join(base, "Local")
	junction(t, local, target)
	if err := (&Log{Dir: filepath.Join(local, "NoktaDestek")}).Write(sample()); !errors.Is(err, ErrReparse) {
		t.Fatalf("üst klasör junction iken yazılmamalı: %v", err)
	}
	if digest(t, v) != sum || entries(t, filepath.Join(target, "NoktaDestek")) != 1 {
		t.Fatal("hedef değişmemeli")
	}
}

func TestAC249SymlinkLogFileAndRotationRefused(t *testing.T) {
	base := t.TempDir()
	v, sum := victim(t, filepath.Join(base, "hedef"))
	dir := filepath.Join(base, "NoktaDestek")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(v, filepath.Join(dir, FileName)); err != nil {
		t.Skip("dosya sembolik bağlantısı için ayrıcalık yok:", err)
	}
	if err := (&Log{Dir: dir}).Write(sample()); !errors.Is(err, ErrReparse) {
		t.Fatalf("bağlantı dosyaya eklenmemeli: %v", err)
	}
	d, err := OpenDir(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := d.Remove(FileName); !errors.Is(err, ErrReparse) {
		t.Fatalf("bağlantı silinmemeli (reddedilmeli): %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a.log"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := d.Rename("a.log", FileName); !errors.Is(err, ErrReparse) {
		t.Fatalf("bağlantı üzerine taşınmamalı: %v", err)
	}
	if digest(t, v) != sum {
		t.Fatal("hedef dosya değişmemeli")
	}
}

// Sabit bağ (hard link) ile başka dosyaya yazma reddi: tanılama logu kurban dosyanın ikinci bağıysa eklenmez.
func TestAC249HardLinkLogRefused(t *testing.T) {
	base := t.TempDir()
	v, sum := victim(t, filepath.Join(base, "hedef"))
	dir := filepath.Join(base, "NoktaDestek")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(v, filepath.Join(dir, FileName)); err != nil {
		t.Fatal(err)
	}
	if err := (&Log{Dir: dir}).Write(sample()); !errors.Is(err, ErrReparse) {
		t.Fatalf("sabit bağa yazılmamalı: %v", err)
	}
	if digest(t, v) != sum {
		t.Fatal("hedef dosya değişmemeli")
	}
}

// Handle üzerinden yeniden adlandırma ve silme; klasör yalnız boşsa silinir.
func TestAC249HandleRenameRemove(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NoktaDestek")
	d, err := OpenDir(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	f, err := d.Open("a", ModeCreate)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("veri"); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	if _, err := d.Open("a", ModeCreate); !errors.Is(err, os.ErrExist) {
		t.Fatalf("CREATE_NEW var olan dosyada os.ErrExist: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b"), []byte("eski"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := d.Rename("a", "b"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "b")); string(b) != "veri" {
		t.Fatalf("yeniden adlandırma üzerine yazmalı: %q", b)
	}
	if err := d.Remove("a"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("olmayan dosya: %v", err)
	}
	if err := d.Remove("b"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Open("..\\x", ModeRead); err == nil {
		t.Fatal("ad ayırıcı içeremez")
	}
	d.RemoveIfEmpty()
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("boş klasör silinmeli:", err)
	}
	if _, err := OpenDir(dir, false); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("olmayan klasör os.ErrNotExist: %v", err)
	}
}

func TestAC249RemoveIfEmptyKeepsNonEmpty(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NoktaDestek")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "baska.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	d, err := OpenDir(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	d.RemoveIfEmpty()
	if entries(t, dir) != 1 {
		t.Fatal("dolu klasör kalmalı")
	}
}

// FILE_RENAME_INFORMATION amd64 düzeni: ReplaceIfExists@0, RootDirectory@8, FileNameLength@16, FileName@20.
func TestAC249RenameInfoLayout(t *testing.T) {
	var ri renameInfo
	if unsafe.Offsetof(ri.Root) != 8 || unsafe.Offsetof(ri.NameLen) != 16 || unsafe.Offsetof(ri.Name) != 20 {
		t.Fatalf("düzen: %d %d %d", unsafe.Offsetof(ri.Root), unsafe.Offsetof(ri.NameLen), unsafe.Offsetof(ri.Name))
	}
}

// Yeniden adlandırma çalışma klasöründen bağımsızdır (CI'da çalışma klasörü başka sürücüdeydi).
func TestAC249RenameIndependentOfWorkingDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NoktaDestek")
	t.Chdir(t.TempDir())
	d, err := OpenDir(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := os.WriteFile(filepath.Join(dir, "a"), []byte("v"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := d.Rename("a", "b"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "b")); err != nil {
		t.Fatal(err)
	}
}
