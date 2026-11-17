//go:build darwin || linux

package printing

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// r4 (mimari-p28f K5 notu, AC-393/AC-349 kısmi): Inspect yalnız %PDF- + ≤ 20 MB; sayfa 0 + PagesUnknown; sabit ad; basma lp.
func TestAC393P28fDarwinPrinterInspectAndPrint(t *testing.T) {
	dir := fakeLP(t, "exit 0")
	p := New("")
	if name, err := p.DefaultPrinter(); err != nil || name != "Varsayılan yazıcı" {
		t.Fatalf("ad %q %v", name, err)
	}
	if u, ok := p.(interface{ PagesUnknown() bool }); !ok || !u.PagesUnknown() {
		t.Fatal("PagesUnknown bildirilmeli")
	}
	for name, c := range map[string]struct {
		pdf  []byte
		want error
	}{
		"PDF değil": {[]byte("MZ"), ErrInvalidPDF},
		"büyük":     {append([]byte("%PDF-"), make([]byte, MaxPDFBytes)...), ErrTooLarge},
	} {
		if _, err := p.Inspect(context.Background(), c.pdf); !errors.Is(err, c.want) {
			t.Errorf("%s: %v", name, err)
		}
	}
	pdf := []byte("%PDF-1.7 belge")
	job, err := p.Inspect(context.Background(), pdf)
	if err != nil || job.Pages() != 0 {
		t.Fatalf("inspect %v", err)
	}
	if err := job.Print(context.Background(), "yok sayılır"); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "stdin")); string(got) != string(pdf) {
		t.Fatalf("stdin %q", got)
	}
	job.Close()
	if err := job.Print(context.Background(), ""); !errors.Is(err, ErrPrint) {
		t.Fatalf("kapalı iş: %v", err)
	}
	fakeLP(t, "exit 1") // varsayılan yazıcı yok
	job, _ = p.Inspect(context.Background(), pdf)
	if err := job.Print(context.Background(), ""); !errors.Is(err, ErrNoPrinter) {
		t.Fatalf("yazıcı yok: %v", err)
	}
}
