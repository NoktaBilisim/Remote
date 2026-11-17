//go:build darwin || linux

package printing

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// P28f K5 (AC-393/P28a, T9, S-P28f-16): lp çağrısı sahte lp ile sınanır — gerçek /usr/bin/lp hiçbir testte çalışmaz.

// fakeLP dir'e argümanları (satır başına), ortamı ve stdin'i yazan, verilen kodla çıkan sahte lp kurar.
func fakeLP(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "lp")
	script := "#!/bin/sh\nd='" + dir + "'\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done > \"$d/args\"\nenv > \"$d/env\"\ncat > \"$d/stdin\"\n" + body + "\n"
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	old := lpPath
	lpPath = p
	t.Cleanup(func() { lpPath = old })
	return dir
}

func TestAC393P28fLPFixedArgsStdinEnv(t *testing.T) {
	if lpPath != "/usr/bin/lp" {
		t.Fatalf("üretim yolu mutlak olmalı: %s", lpPath)
	}
	dir := fakeLP(t, "exit 0")
	t.Setenv("LPDEST", "kotu-yazici")
	t.Setenv("PRINTER", "-o evil")
	t.Setenv("NOKTA_TEST_KALIR", "1")
	pdf := []byte("%PDF-1.7\niçerik\x00\xff")
	if err := PrintLP(context.Background(), pdf); err != nil {
		t.Fatal(err)
	}
	args, _ := os.ReadFile(filepath.Join(dir, "args"))
	want := []string{"-n", "1", "-t", "Nokta Destek", "-o", "document-format=application/pdf", "-"}
	if got := strings.Split(strings.TrimSuffix(string(args), "\n"), "\n"); !slices.Equal(got, want) {
		t.Fatalf("argümanlar: %q", got)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "stdin")); string(got) != string(pdf) {
		t.Fatalf("stdin: %q", got)
	}
	env, _ := os.ReadFile(filepath.Join(dir, "env"))
	for _, line := range strings.Split(string(env), "\n") {
		if strings.HasPrefix(line, "LPDEST=") || strings.HasPrefix(line, "PRINTER=") {
			t.Fatalf("ortamda kaldı: %s", line)
		}
	}
	if !strings.Contains(string(env), "NOKTA_TEST_KALIR=1") {
		t.Fatal("diğer ortam değişkenleri korunmalı")
	}
}

func TestAC393P28fLPInputValidation(t *testing.T) {
	dir := fakeLP(t, "exit 0")
	for name, c := range map[string]struct {
		pdf  []byte
		want error
	}{
		"boş":       {nil, ErrInvalidPDF},
		"PDF değil": {[]byte("<html>"), ErrInvalidPDF},
		"büyük":     {append([]byte("%PDF-"), make([]byte, MaxPDFBytes)...), ErrTooLarge},
	} {
		if err := PrintLP(context.Background(), c.pdf); !errors.Is(err, c.want) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "args")); !os.IsNotExist(err) {
		t.Fatal("geçersiz girdide lp çalıştı")
	}
}

// Varsayılan yazıcı yok (lp sıfır dışı çıkar) → ErrNoPrinter; lp başlatılamazsa ErrPrint.
func TestAC393P28fLPErrors(t *testing.T) {
	fakeLP(t, "echo 'lp: Error - No default destination.' >&2; exit 1")
	if err := PrintLP(context.Background(), []byte("%PDF-1.4")); !errors.Is(err, ErrNoPrinter) {
		t.Fatalf("yazıcı yok: %v", err)
	}
	lpPath = filepath.Join(t.TempDir(), "yok")
	if err := PrintLP(context.Background(), []byte("%PDF-1.4")); !errors.Is(err, ErrPrint) {
		t.Fatalf("lp yok: %v", err)
	}
}

func TestAC393P28fLPCancel(t *testing.T) {
	fakeLP(t, "exec sleep 30")
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := PrintLP(ctx, []byte("%PDF-1.4")); !errors.Is(err, ErrCancelled) {
		t.Fatalf("iptal: %v", err)
	}
	if d := time.Since(start); d > 5*time.Second {
		t.Fatalf("iptal geç döndü: %v", d)
	}
	done, c2 := context.WithCancel(context.Background())
	c2()
	if err := PrintLP(done, []byte("%PDF-1.4")); !errors.Is(err, ErrCancelled) {
		t.Fatalf("önceden iptal: %v", err)
	}
}
