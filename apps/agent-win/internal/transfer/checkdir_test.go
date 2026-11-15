package transfer

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"remote-support/agent-win/internal/dc"
)

// AC-340 (P27, Y-P27-2 m.3): Deps.CheckDir başarısızsa `.part` hiç açılmaz ve teklif reddedilir.
func TestAC340CheckDirRejectsBeforePart(t *testing.T) {
	m, r, dir := setup(t, 1<<20)
	m.d.CheckDir = func() error { return errors.New("yönlendirilmiş") }
	m.Offer(offerCtl("f1", "a.txt", []byte("x")))
	res, err := m.Decide("f1", true)
	if err == nil || res == nil || res.Status != "REJECTED" {
		t.Fatalf("decide: %+v %v", res, err)
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Fatalf("klasöre yazıldı: %v", ents)
	}
	if len(r.meta) != 1 || r.meta[0].Result != "REJECTED" {
		t.Fatalf("meta: %+v", r.meta)
	}
}

// AC-340: yerleştirme anında klasör yönlendirildiyse dosya nihai ada taşınmaz, .part silinir.
func TestAC340CheckDirBeforePlace(t *testing.T) {
	m, _, dir := setup(t, 1<<20)
	calls := 0
	m.d.CheckDir = func() error {
		calls++
		if calls > 1 {
			return errors.New("yönlendirilmiş")
		}
		return nil
	}
	data := []byte("veri")
	m.Offer(offerCtl("f1", "a.txt", data))
	if _, err := m.Decide("f1", true); err != nil {
		t.Fatal(err)
	}
	m.Chunk(dc.Chunk{FIDIndex: 7, Seq: 0, Payload: data}, true)
	res := m.Done("f1")
	if res == nil || res.Status == "OK" {
		t.Fatalf("done: %+v", res)
	}
	for _, n := range []string{"a.txt", "a.txt.part"} {
		if _, err := os.Stat(filepath.Join(dir, n)); err == nil {
			t.Fatalf("%s kaldı", n)
		}
	}
}
