//go:build linux

package update

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// Gerçek dosya sistemiyle Linux ELF yer değiştirme (K-P29-11, AC-482/483/484). Koşu: docker golang (mimari §10).

func linuxExe(t *testing.T, dirMode fs.FileMode) (string, LinuxReplacer) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "indirilenler")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(dir, "Destek-12345678")
	if err := os.WriteFile(exe, []byte("eski"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, dirMode); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	run, err := os.Stat(exe) // çalışan inode = kurulumdan önceki dosya
	if err != nil {
		t.Fatal(err)
	}
	return exe, LinuxReplacer{Exe: exe, Running: func() (fs.FileInfo, error) { return run, nil }}
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	ents, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range ents {
		out = append(out, e.Name())
	}
	return out
}

func TestAC482LinuxReplaceKeepsModeAtomic(t *testing.T) {
	exe, r := linuxExe(t, 0o755)
	st, err := r.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	tmp := st.(*linuxStaging).tmp
	if fi, err := os.Lstat(tmp); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("geçici dosya 0600 olmalı: %v %v", fi, err)
	}
	if !IsLinuxTemp(filepath.Base(exe), filepath.Base(tmp)) {
		t.Fatalf("geçici ad deseni: %s", tmp)
	}
	if _, err := st.Write([]byte("yeni")); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "eski" {
		t.Fatal("Commit'ten önce çalışan dosya değişmemeli (yarım dosya yok)")
	}
	if err := st.Commit(); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(exe)
	if err != nil || fi.Mode().Perm() != 0o750 {
		t.Fatalf("kip korunmalı (u+x): %v %v", fi, err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "yeni" {
		t.Fatal("aynı yol/ad yeni içerik")
	}
	if got := dirNames(t, filepath.Dir(exe)); len(got) != 1 || got[0] != filepath.Base(exe) {
		t.Fatalf("AC-484: yalnız değiştirilen ikili kalmalı: %v", got)
	}
}

func TestAC484LinuxAbortAndExeChanged(t *testing.T) {
	exe, r := linuxExe(t, 0o755)
	st, err := r.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	st.Abort()
	st.Abort()
	if got := dirNames(t, filepath.Dir(exe)); len(got) != 1 {
		t.Fatalf("Abort geçici dosyayı silmeli: %v", got)
	}

	other, err := os.Stat(filepath.Dir(exe)) // çalışan inode farklı (dosya başkasıyla değiştirilmiş)
	if err != nil {
		t.Fatal(err)
	}
	r.Running = func() (fs.FileInfo, error) { return other, nil }
	st, err = r.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Commit(); !errors.Is(err, errExeChanged) {
		t.Fatalf("çalışan inode değilse vazgeçilmeli: %v", err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "eski" {
		t.Fatal("dosya değişmemeli")
	}
	if got := dirNames(t, filepath.Dir(exe)); len(got) != 1 {
		t.Fatalf("geçici dosya silinmeli: %v", got)
	}
}

func TestAC483LinuxNotWritable(t *testing.T) {
	_, r := linuxExe(t, 0o777) // sticky olmayan herkes yazılabilir (T-12)
	if _, err := r.Prepare(); !errors.Is(err, ErrNotWritable) {
		t.Fatalf("herkes yazılabilir sticky olmayan klasör: %v", err)
	}
	exe, r := linuxExe(t, fs.ModeSticky|0o777)
	st, err := r.Prepare()
	if err != nil {
		t.Fatalf("sticky klasör kabul: %v", err)
	}
	st.Abort()
	if os.Geteuid() == 0 {
		t.Log("root: salt okunur klasör vakası atlandı (root her klasöre yazar); --user ile koşun")
		return
	}
	exe, r = linuxExe(t, 0o555)
	if _, err := r.Prepare(); !errors.Is(err, ErrNotWritable) {
		t.Fatalf("salt okunur klasör: %v", err)
	}
	if got := dirNames(t, filepath.Dir(exe)); len(got) != 1 {
		t.Fatalf("yan dosya bırakılmamalı: %v", got)
	}
}

func TestAC484LinuxCleanupPrevious(t *testing.T) {
	exe, r := linuxExe(t, 0o755)
	dir := filepath.Dir(exe)
	keep := []string{".Destek-12345678.yeni-0a1b2c3", "baska.txt", ".Destek-87654321.yeni-0a1b2c3d"}
	for _, n := range append([]string{".Destek-12345678.yeni-0a1b2c3d"}, keep...) {
		if err := os.WriteFile(filepath.Join(dir, n), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink("/etc/passwd", filepath.Join(dir, ".Destek-12345678.yeni-ffffffff")); err != nil {
		t.Fatal(err)
	}
	r.CleanupPrevious()
	got := dirNames(t, dir)
	want := map[string]bool{filepath.Base(exe): true, ".Destek-12345678.yeni-ffffffff": true}
	for _, k := range keep {
		want[k] = true
	}
	if len(got) != len(want) {
		t.Fatalf("yalnız tam desenli düzenli dosya silinmeli: %v", got)
	}
	for _, n := range got {
		if !want[n] {
			t.Fatalf("beklenmeyen: %s", n)
		}
	}
}
