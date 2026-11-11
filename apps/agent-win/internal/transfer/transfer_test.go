package transfer

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/signal"
)

type rec struct {
	ctl  []string
	meta []signal.FileMeta
	motw []string
	now  time.Time
}

func setup(t *testing.T, max int64) (*Manager, *rec, string) {
	t.Helper()
	dir := t.TempDir()
	r := &rec{now: time.Unix(1000, 0)}
	m := New(Deps{Dir: dir, MaxBytes: max,
		SendCtl: func(b []byte) error { r.ctl = append(r.ctl, string(b)); return nil },
		Meta:    func(f signal.FileMeta) { r.meta = append(r.meta, f) },
		MOTW:    func(p string) error { r.motw = append(r.motw, p); return nil },
		Now:     func() time.Time { return r.now },
	})
	return m, r, dir
}

func offerCtl(fid, name string, data []byte) dc.Ctl {
	sum := sha256.Sum256(data)
	idx, size := 7, int64(len(data))
	return dc.Ctl{T: "file.offer", FID: fid, Idx: &idx, Name: name, Size: &size, SHA: hex.EncodeToString(sum[:])}
}

func TestAC54ReceiveVerifyRenameMOTW(t *testing.T) {
	m, r, dir := setup(t, 1<<20)
	data := []byte("merhaba dünya")
	p := m.Offer(offerCtl("f1", "rapor.pdf", data))
	if p == nil || p.Name != "rapor.pdf" || p.Warning != files.WarnNone {
		t.Fatalf("prompt: %+v", p)
	}
	if res, err := m.Decide("f1", true); err != nil || res != nil {
		t.Fatalf("decide: %v %v", res, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "rapor.pdf.part")); err != nil {
		t.Fatal(".part yok")
	}
	m.Chunk(dc.Chunk{FIDIndex: 7, Seq: 0, Payload: data[:5]}, true)
	m.Chunk(dc.Chunk{FIDIndex: 8, Seq: 0, Payload: []byte("yabancı")}, true) // başka idx → düşer
	m.Chunk(dc.Chunk{FIDIndex: 7, Seq: 1, Payload: data[5:]}, true)
	res := m.Done("f1")
	if res == nil || res.Status != "OK" {
		t.Fatalf("done: %+v", res)
	}
	got, err := os.ReadFile(filepath.Join(dir, "rapor.pdf"))
	if err != nil || string(got) != string(data) {
		t.Fatalf("içerik: %q %v", got, err)
	}
	if len(r.motw) != 1 || r.motw[0] != filepath.Join(dir, "rapor.pdf.part") { // S6-3: rename'den önce .part'a
		t.Fatalf("MOTW: %v", r.motw)
	}
	if r.ctl[len(r.ctl)-1] != `{"t":"file.result","fid":"f1","ok":true}` || r.meta[0].Result != "OK" ||
		r.meta[0].Direction != "TO_CUSTOMER" {
		t.Fatalf("ctl %v meta %+v", r.ctl, r.meta)
	}
}

func TestAC54CorruptDeletesPart(t *testing.T) {
	m, r, dir := setup(t, 1<<20)
	data := []byte("abc")
	m.Offer(offerCtl("f1", "a.txt", data))
	_, _ = m.Decide("f1", true)
	m.Chunk(dc.Chunk{FIDIndex: 7, Seq: 0, Payload: []byte("abd")}, true)
	if res := m.Done("f1"); res == nil || res.Status != "CORRUPT" {
		t.Fatalf("%+v", res)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("klasör boş olmalı: %v", entries)
	}
	if r.ctl[len(r.ctl)-1] != `{"t":"file.result","fid":"f1","ok":false}` || r.meta[0].Result != "CORRUPT" {
		t.Fatalf("ctl %v meta %+v", r.ctl, r.meta)
	}
}

func TestAC53ExceededCancels(t *testing.T) {
	m, r, dir := setup(t, 1<<20)
	m.Offer(offerCtl("f1", "a.txt", []byte("abc")))
	_, _ = m.Decide("f1", true)
	if res := m.Chunk(dc.Chunk{FIDIndex: 7, Seq: 0, Payload: []byte("abcdef")}, true); res == nil || res.Status != "CANCELLED" {
		t.Fatalf("%+v", res)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatal(".part silinmeli")
	}
	if r.ctl[len(r.ctl)-1] != `{"t":"file.cancel","fid":"f1"}` {
		t.Fatalf("%v", r.ctl)
	}
}

func TestAC53OverLimitAutoRejected(t *testing.T) {
	m, r, _ := setup(t, 2)
	if p := m.Offer(offerCtl("f1", "a.txt", []byte("abc"))); p != nil {
		t.Fatal("sınır üstü teklif diyalog açmamalı")
	}
	if r.ctl[0] != `{"t":"file.reject","fid":"f1"}` || r.meta[0].Result != "REJECTED" {
		t.Fatalf("%v %+v", r.ctl, r.meta)
	}
}

func TestAC36RejectCooldownAndSingleOffer(t *testing.T) {
	m, r, _ := setup(t, 1<<20)
	if m.Offer(offerCtl("f1", "kur.pdf.exe", []byte("x"))).Warning != files.WarnDoubleExtension {
		t.Fatal("çift uzantı uyarısı")
	}
	if m.Offer(offerCtl("f2", "b.txt", []byte("x"))) != nil {
		t.Fatal("ikinci eşzamanlı teklif otomatik reddedilmeli")
	}
	if res, _ := m.Decide("f1", false); res.Status != "REJECTED" {
		t.Fatal("ret")
	}
	r.now = r.now.Add(29 * time.Second)
	if m.Offer(offerCtl("f3", "c.txt", []byte("x"))) != nil {
		t.Fatal("30 sn içinde otomatik ret")
	}
	r.now = r.now.Add(2 * time.Second)
	if m.Offer(offerCtl("f4", "d.txt", []byte("x"))) == nil {
		t.Fatal("30 sn sonra diyalog açılmalı")
	}
}

func TestAC36NoOverwriteAndSanitize(t *testing.T) {
	m, _, dir := setup(t, 1<<20)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("eski"), 0o600); err != nil {
		t.Fatal(err)
	}
	data := []byte("yeni")
	p := m.Offer(offerCtl("f1", `..\..\a.txt`, data))
	if p.Name != "a.txt" {
		t.Fatalf("temizlenmiş ad: %q", p.Name)
	}
	_, _ = m.Decide("f1", true)
	m.Chunk(dc.Chunk{FIDIndex: 7, Payload: data}, true)
	res := m.Done("f1")
	if res.Name != "a (1).txt" {
		t.Fatalf("ad: %q", res.Name)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "a.txt")); string(b) != "eski" {
		t.Fatal("üzerine yazıldı")
	}
}

// S6-3: alım sırasında aynı adla oluşan dosyanın üzerine yazılmaz; yeni ad seçilir.
func TestS63TargetCreatedDuringReceiveNotOverwritten(t *testing.T) {
	m, _, dir := setup(t, 1<<20)
	data := []byte("yeni")
	m.Offer(offerCtl("f1", "a.txt", data))
	_, _ = m.Decide("f1", true)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("tarayıcı"), 0o600); err != nil {
		t.Fatal(err)
	}
	m.Chunk(dc.Chunk{FIDIndex: 7, Payload: data}, true)
	res := m.Done("f1")
	if res.Status != "OK" || res.Name != "a (1).txt" {
		t.Fatalf("sonuç: %+v", res)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "a.txt")); string(b) != "tarayıcı" {
		t.Fatal("üzerine yazıldı")
	}
	if b, _ := os.ReadFile(res.Path); string(b) != "yeni" {
		t.Fatal("yeni dosya yanlış")
	}
}

func TestS63RenameNoReplace(t *testing.T) {
	dir := t.TempDir()
	src, dst := filepath.Join(dir, "s.part"), filepath.Join(dir, "d.txt")
	_ = os.WriteFile(src, []byte("s"), 0o600)
	_ = os.WriteFile(dst, []byte("d"), 0o600)
	if err := renameNoReplace(src, dst); err != errExists {
		t.Fatalf("hedef varken: %v", err)
	}
	if b, _ := os.ReadFile(dst); string(b) != "d" {
		t.Fatal("hedef değişti")
	}
	if err := renameNoReplace(src, filepath.Join(dir, "yeni.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("kaynak kaldı")
	}
}

// S6-3: MOTW yazılamazsa tehlikeli türde dosya teslim edilmez (silinir), uyarısız türde uyarıyla teslim edilir.
func TestS63MOTWFailure(t *testing.T) {
	for _, c := range []struct {
		name, status string
		kept         bool
	}{{"kurulum.exe", "REJECTED", false}, {"fatura.pdf.exe", "REJECTED", false}, {"rapor.pdf", "OK", true}} {
		m, r, dir := setup(t, 1<<20)
		m.d.MOTW = func(string) error { return errors.New("ADS desteklenmiyor") }
		data := []byte("icerik")
		m.Offer(offerCtl("f1", c.name, data))
		_, _ = m.Decide("f1", true)
		m.Chunk(dc.Chunk{FIDIndex: 7, Payload: data}, true)
		res := m.Done("f1")
		if res.Status != c.status || !res.MOTWFailed {
			t.Fatalf("%s: %+v", c.name, res)
		}
		entries, _ := os.ReadDir(dir)
		if (len(entries) == 1) != c.kept {
			t.Fatalf("%s: klasör %v", c.name, entries)
		}
		last := r.ctl[len(r.ctl)-1]
		if c.kept != (last == `{"t":"file.result","fid":"f1","ok":true}`) || r.meta[len(r.meta)-1].Result != c.status {
			t.Fatalf("%s: ctl %v meta %+v", c.name, r.ctl, r.meta)
		}
	}
}

func TestAC108CloseRemovesPart(t *testing.T) {
	m, _, dir := setup(t, 1<<20)
	m.Offer(offerCtl("f1", "a.txt", []byte("abc")))
	_, _ = m.Decide("f1", true)
	m.Close()
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatal("yarım dosya kaldı")
	}
}
