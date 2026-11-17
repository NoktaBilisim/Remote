//go:build darwin || linux

package macperm

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func tmpDir(t *testing.T) string {
	t.Helper()
	d := filepath.Join(t.TempDir(), "T")
	if err := os.Mkdir(d, 0o700); err != nil {
		t.Fatal(err)
	}
	return d
}

const tok = "0123456789abcdef0123456789abcdef"

// AC-391 / T6: yaz → oku (kod korunur) → dosya silinir; ikinci okuma başarısız.
func TestP28fRestartRoundTrip(t *testing.T) {
	d := tmpDir(t)
	if err := WriteRestart(d, tok, "12345678"); err != nil {
		t.Fatal(err)
	}
	if err := WriteRestart(d, tok, "12345678"); err == nil {
		t.Fatal("O_EXCL: ikinci yazım reddedilmeli")
	}
	got, err := ReadRestart(d, tok, time.Now())
	if err != nil || got != "12345678" {
		t.Fatalf("ReadRestart = %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(d, filePrefix+tok)); !os.IsNotExist(err) {
		t.Fatal("dosya silinmeli")
	}
	if _, err := ReadRestart(d, tok, time.Now()); err == nil {
		t.Fatal("ikinci okuma başarısız olmalı")
	}
}

// T6: sembolik bağ, yanlış izin, bayat dosya, geçersiz içerik, geçersiz belirteç, güvensiz dizin reddedilir ve silinir.
func TestP28fRestartRejects(t *testing.T) {
	d := tmpDir(t)
	p := filepath.Join(d, filePrefix+tok)
	target := filepath.Join(t.TempDir(), "hedef")
	_ = os.WriteFile(target, []byte("12345678"), 0o600)
	_ = os.Symlink(target, p)
	if _, err := ReadRestart(d, tok, time.Now()); err == nil {
		t.Error("sembolik bağ reddedilmeli")
	}
	if _, err := os.Lstat(p); !os.IsNotExist(err) {
		t.Error("bağ silinmeli")
	}
	for name, setup := range map[string]func(){
		"izin 0644": func() { _ = os.WriteFile(p, []byte("12345678"), 0o644); _ = os.Chmod(p, 0o644) },
		"içerik":    func() { _ = os.WriteFile(p, []byte("1234567x"), 0o600) },
		"bayat": func() {
			_ = os.WriteFile(p, []byte("12345678"), 0o600)
			old := time.Now().Add(-3 * time.Minute)
			_ = os.Chtimes(p, old, old)
		},
	} {
		setup()
		if _, err := ReadRestart(d, tok, time.Now()); !errors.Is(err, ErrBadFile) {
			t.Errorf("%s: %v", name, err)
		}
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			t.Errorf("%s: silinmeli", name)
		}
	}
	if _, err := ReadRestart(d, "../x", time.Now()); err == nil {
		t.Error("geçersiz belirteç")
	}
	if err := WriteRestart(d, tok, "1234"); err == nil {
		t.Error("geçersiz kod yazılmamalı")
	}
	open := filepath.Join(t.TempDir(), "acik")
	_ = os.Mkdir(open, 0o755)
	if err := WriteRestart(open, tok, "12345678"); !errors.Is(err, ErrUnsafeDir) {
		t.Errorf("0755 dizin: %v", err)
	}
}

// S-P28f-13: belirteçsiz açılışta bekleyen dosyalar okunmadan silinir; başka dosyalara dokunulmaz.
func TestP28fRestartPurge(t *testing.T) {
	d := tmpDir(t)
	_ = WriteRestart(d, tok, "12345678")
	other := filepath.Join(d, "baska.txt")
	_ = os.WriteFile(other, nil, 0o600)
	PurgeRestart(d)
	if _, err := os.Stat(filepath.Join(d, filePrefix+tok)); !os.IsNotExist(err) {
		t.Fatal("bekleyen dosya silinmeli")
	}
	if _, err := os.Stat(other); err != nil {
		t.Fatal("başka dosya silinmemeli")
	}
}
