//go:build linux

package files

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// P28g K5 (mimari-p28g §2, §5.1 T8, §5.3, §9 Go birim): MOTW karşılığı izin bitleri, XDG indirme dizini, pulse çerezi.

func TestAC398P28gClearExecRemovesExecBits(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.part")
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []os.FileMode{0o600, 0o755, 0o777 | os.ModeSetuid} {
		if err := os.Chmod(p, mode); err != nil {
			t.Fatal(err)
		}
		if err := ClearExec(p); err != nil {
			t.Fatalf("%v: %v", mode, err)
		}
		fi, _ := os.Stat(p)
		if fi.Mode() != ReceivedMode {
			t.Fatalf("%v → %v, beklenen 0644", mode, fi.Mode())
		}
	}
	// Sembolik bağ izlenmez, dizin ve olmayan yol reddedilir.
	link := filepath.Join(dir, "bag.part")
	if err := os.Symlink(p, link); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{link, dir, filepath.Join(dir, "yok")} {
		if err := ClearExec(bad); !errors.Is(err, ErrExecBit) {
			t.Fatalf("%s: %v", bad, err)
		}
	}
}

func TestAC398P28gParseUserDirs(t *testing.T) {
	home := "/home/ayşe"
	for _, c := range []struct {
		in, want string
		ok       bool
	}{
		{`XDG_DOWNLOAD_DIR="$HOME/İndirilenler"`, "/home/ayşe/İndirilenler", true},
		{"# yorum\nXDG_DESKTOP_DIR=\"$HOME/Masaüstü\"\n  XDG_DOWNLOAD_DIR = \"$HOME/İndirilenler/\"\n", "/home/ayşe/İndirilenler", true},
		{`XDG_DOWNLOAD_DIR="/veri/indir"`, "/veri/indir", true},
		{`XDG_DOWNLOAD_DIR="$HOME/Benim \"Dosyalar\""`, `/home/ayşe/Benim "Dosyalar"`, true},
		{`XDG_DOWNLOAD_DIR="$HOME"`, "/home/ayşe", true},
		{`XDG_DOWNLOAD_DIR="$HOME/a"` + "\n" + `XDG_DOWNLOAD_DIR="$HOME/b"`, "/home/ayşe/b", true},
		{`XDG_DOWNLOAD_DIR="$HOMEX/a"`, "", false},
		{`XDG_DOWNLOAD_DIR="$OTHER/a"`, "", false},
		{`XDG_DOWNLOAD_DIR="göreli/a"`, "", false},
		{`XDG_DOWNLOAD_DIR="$HOME/../root"`, "", false},
		{`XDG_DOWNLOAD_DIR="$HOME/$(id)"`, "", false},
		{"XDG_DOWNLOAD_DIR=\"$HOME/`id`\"", "", false},
		{`XDG_DOWNLOAD_DIR=$HOME/a`, "", false},
		{`XDG_DOWNLOADS_DIR="$HOME/a"`, "", false},
		{"", "", false},
	} {
		got, ok := parseUserDirs([]byte(c.in), home)
		if got != c.want || ok != c.ok {
			t.Errorf("%q → %q %v; beklenen %q %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestAC398P28gDownloadsDirFallbacks(t *testing.T) {
	home := t.TempDir()
	if got, err := downloadsIn(home); err != nil || got != home {
		t.Fatalf("yalnız HOME: %q %v", got, err)
	}
	dl := filepath.Join(home, "Downloads")
	_ = os.Mkdir(dl, 0o700)
	if got, _ := downloadsIn(home); got != dl {
		t.Fatalf("~/Downloads: %q", got)
	}
	tr := filepath.Join(home, "İndirilenler")
	_ = os.Mkdir(tr, 0o700)
	_ = os.MkdirAll(filepath.Join(home, ".config"), 0o700)
	ud := filepath.Join(home, ".config", "user-dirs.dirs")
	_ = os.WriteFile(ud, []byte(`XDG_DOWNLOAD_DIR="$HOME/İndirilenler"`+"\n"), 0o600)
	if got, _ := downloadsIn(home); got != tr {
		t.Fatalf("XDG: %q", got)
	}
	// Sembolik bağ ya da olmayan XDG dizini → sıradaki aday.
	_ = os.Remove(tr)
	_ = os.Symlink(dl, tr)
	if got, _ := downloadsIn(home); got != dl {
		t.Fatalf("bağ izlendi: %q", got)
	}
}

func TestAC401P28gPulseCookieEnv(t *testing.T) {
	home, priv := t.TempDir(), t.TempDir()
	if got := PulseCookieEnv(home, priv); got != filepath.Join(priv, "pulse-cookie") {
		t.Fatalf("çerez yokken: %q", got)
	}
	_ = os.MkdirAll(filepath.Join(home, ".config", "pulse"), 0o700)
	_ = os.WriteFile(filepath.Join(home, ".config", "pulse", "cookie"), []byte("x"), 0o600)
	if got := PulseCookieEnv(home, priv); got != "" {
		t.Fatalf("kullanıcı çerezi varken: %q", got)
	}
	if PulseCookieEnv("göreli", priv) != "" || PulseCookieEnv(home, "") != "" {
		t.Fatal("göreli yol kabul edildi")
	}
}
