package transfer

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"remote-support/agent-win/internal/dc"
)

// P28g K5 (S-P28g-6 m.3, mimari-p28g §4.3/§5.4): alınan `Destek-<kod>` adı başlatma komutunun desenine uymaz;
// ELF/`#!` içeriği uzantıdan bağımsız sonuçta işaretlenir. Her platformda.

func TestAC398P28gReceivedDestekRenamedDC(t *testing.T) {
	m, r, dir := setup(t, 1<<20)
	data := []byte("\x7fELF\x02\x01\x01")
	p := m.Offer(offerCtl("f1", "Destek-12345678", data))
	if p == nil || p.Name != "Dosya-Destek-12345678" {
		t.Fatalf("prompt: %+v", p)
	}
	if _, err := m.Decide("f1", true); err != nil {
		t.Fatal(err)
	}
	m.Chunk(dc.Chunk{FIDIndex: 7, Seq: 0, Payload: data}, true)
	res := m.Done("f1")
	if res == nil || res.Status != "OK" || res.Name != "Dosya-Destek-12345678" || !res.Executable {
		t.Fatalf("sonuç: %+v", res)
	}
	if _, err := os.Stat(filepath.Join(dir, "Destek-12345678")); !os.IsNotExist(err) {
		t.Fatal("Destek- adıyla dosya oluştu")
	}
	if last := r.meta[len(r.meta)-1]; last.FileName != "Dosya-Destek-12345678" || last.Result != "OK" {
		t.Fatalf("meta: %+v", last)
	}
}

func TestAC398P28gReceivedStreamRenameAndExecFlag(t *testing.T) {
	dir := t.TempDir()
	m := New(Deps{Dir: dir, MaxBytes: 100, MOTW: func(string) error { return nil }})
	for _, c := range []struct {
		name, data, want string
		exe              bool
	}{
		{"destek-87654321(1)", "#!/bin/sh\n", "Dosya-destek-87654321(1)", true},
		{"not.txt", "#!x", "not.txt", true},
		{"rapor.pdf", "%PDF-1.7", "rapor.pdf", false},
		{"k.bin", "\x7fEL", "k.bin", false}, // 3 bayt: ELF değil
	} {
		sum := sha256.Sum256([]byte(c.data))
		s, err := m.OpenStream(c.name, int64(len(c.data)), hex.EncodeToString(sum[:]))
		if err != nil {
			t.Fatal(err)
		}
		_, _ = s.Write([]byte(c.data))
		r := s.Commit()
		if r.Status != "OK" || filepath.Base(r.Path) != c.want || r.Executable != c.exe {
			t.Fatalf("%s: %+v", c.name, r)
		}
	}
}
