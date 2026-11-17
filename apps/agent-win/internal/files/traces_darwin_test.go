//go:build darwin

package files

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// AC-394 / S-P28f-14: confstr önbellek dizini `getconf DARWIN_USER_CACHE_DIR` ile aynı.
func TestAC394P28fUserCacheDirMatchesGetconf(t *testing.T) {
	got, err := userCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("/usr/bin/getconf", "DARWIN_USER_CACHE_DIR").Output()
	if err != nil {
		t.Skip("SKIP: getconf yok")
	}
	if want := filepath.Clean(strings.TrimSpace(string(out))); got != want {
		t.Fatalf("confstr %q, getconf %q", got, want)
	}
}

// AC-394: yalnız sabit kimliklerin önbellek ve savedState dizinleri silinir; komşular, boş/göreli kök ve bağ hedefi
// korunur.
func TestAC394P28fRemoveTraces(t *testing.T) {
	cache, home := t.TempDir(), t.TempDir()
	saved := filepath.Join(home, "Library", "Saved Application State")
	mk := func(p string) {
		if err := os.MkdirAll(p, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(p, "f"), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	gone := []string{
		filepath.Join(cache, "net.noktabilisim.destek"),
		filepath.Join(cache, "net.noktabilisim.destek.stg"),
		filepath.Join(saved, "net.noktabilisim.destek.savedState"),
		filepath.Join(saved, "net.noktabilisim.destek.stg.savedState"),
	}
	kept := []string{filepath.Join(cache, "com.apple.Safari"), filepath.Join(cache, "net.noktabilisim.destekx"),
		filepath.Join(saved, "com.apple.Terminal.savedState")}
	for _, p := range append(append([]string{}, gone...), kept...) {
		mk(p)
	}
	mk(filepath.Join(gone[0], "com.apple.metalfe")) // spike K0s-7'nin bulduğu Metal önbelleği
	outside := t.TempDir()
	mk(filepath.Join(outside, "hedef"))
	// Bağ: önbellekteki kimlik dizini başka yere işaret ediyorsa yalnız bağ silinir.
	if err := os.RemoveAll(filepath.Join(cache, "net.noktabilisim.destek.stg")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "hedef"), filepath.Join(cache, "net.noktabilisim.destek.stg")); err != nil {
		t.Fatal(err)
	}
	if err := removeTraces(cache, home); err != nil {
		t.Fatal(err)
	}
	if err := removeTraces(cache, home); err != nil { // idempotent
		t.Fatal(err)
	}
	for _, p := range gone {
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			t.Errorf("silinmedi: %s", p)
		}
	}
	for _, p := range kept {
		if _, err := os.Stat(filepath.Join(p, "f")); err != nil {
			t.Errorf("komşu silindi: %s", p)
		}
	}
	if _, err := os.Stat(filepath.Join(outside, "hedef", "f")); err != nil {
		t.Fatal("bağ hedefi silindi")
	}
	// Boş/göreli kök: hiçbir şey silinmez (üst dizin riski yok).
	mk(filepath.Join(cache, "net.noktabilisim.destek"))
	if err := removeTraces("", "rel"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(cache, "net.noktabilisim.destek", "f")); err != nil {
		t.Fatal("boş kökte silme yapıldı")
	}
}

// AC-392/AC-117: İndirilenler gerçek, bu kullanıcıya ait dizin olmalı; bağ ya da eksik klasör reddedilir.
func TestAC392P28fDownloadsDir(t *testing.T) {
	home := t.TempDir()
	if _, err := downloadsIn(home); err == nil {
		t.Fatal("eksik klasör kabul edildi")
	}
	other := t.TempDir()
	if err := os.Symlink(other, filepath.Join(home, "Downloads")); err != nil {
		t.Fatal(err)
	}
	if _, err := downloadsIn(home); err == nil {
		t.Fatal("sembolik bağ kabul edildi")
	}
	home2 := t.TempDir()
	if err := os.Mkdir(filepath.Join(home2, "Downloads"), 0o700); err != nil {
		t.Fatal(err)
	}
	if d, err := downloadsIn(home2); err != nil || d != filepath.Join(home2, "Downloads") {
		t.Fatalf("%q %v", d, err)
	}
}
