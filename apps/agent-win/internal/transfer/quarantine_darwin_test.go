//go:build darwin

package transfer

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/files"
)

func quarantineOf(t *testing.T, path string) string {
	t.Helper()
	buf := make([]byte, 256)
	n, err := unix.Lgetxattr(path, files.QuarantineAttr, buf)
	if err != nil {
		t.Fatalf("%s: karantina yok: %v", path, err)
	}
	return string(buf[:n])
}

// AC-117 / T8 (P28f K5): DC yolunda gerçek WriteQuarantine — yerleştirilen nihai dosya karantinalıdır (`.part`'ta yazılıp
// yeniden adlandırmayla taşınır); 0x40 yok.
func TestAC117P28fTransferPlacesQuarantinedFile(t *testing.T) {
	m, _, dir := setup(t, 1<<20)
	var marked []string
	m.d.MOTW = func(p string) error { marked = append(marked, p); return files.WriteQuarantine(p) }
	data := []byte("%PDF-1.4 içerik")
	m.Offer(offerCtl("f1", "rapor.pdf", data))
	if _, err := m.Decide("f1", true); err != nil {
		t.Fatal(err)
	}
	m.Chunk(dc.Chunk{FIDIndex: 7, Payload: data}, true)
	res := m.Done("f1")
	if res == nil || res.Status != "OK" || res.MOTWFailed {
		t.Fatalf("%+v", res)
	}
	if len(marked) != 1 || !strings.HasSuffix(marked[0], ".part") {
		t.Fatalf("karantina .part'a yazılmalı: %v", marked)
	}
	v := quarantineOf(t, filepath.Join(dir, "rapor.pdf"))
	if !strings.HasPrefix(v, "0083;") || !strings.HasSuffix(v, ";Nokta Destek;") {
		t.Fatalf("değer: %q", v)
	}
}

// T8: sunucu dosyası (akış) yolunda karantina yazılamazsa uyarısız türde de dosya silinir, sonuç CORRUPT.
func TestAC117P28fStreamQuarantineFailureCorrupt(t *testing.T) {
	dir := t.TempDir()
	m := New(Deps{Dir: dir, MaxBytes: 100, MOTW: func(string) error { return errors.New("xattr yazılamadı") }})
	data := []byte("merhaba")
	sum := sha256.Sum256(data)
	s, err := m.OpenStream("not.txt", int64(len(data)), hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write(data); err != nil {
		t.Fatal(err)
	}
	if r := s.Commit(); r.Status != "CORRUPT" || !r.MOTWFailed || r.Path != "" {
		t.Fatalf("%+v", r)
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Fatalf("dosya kaldı: %v", ents)
	}
}
