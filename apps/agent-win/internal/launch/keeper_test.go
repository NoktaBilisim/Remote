package launch

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/signal"
)

const other = "https://staging.example:443"

var t0 = time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)

// bkey n. sahte kayıt anahtarı (rsb_ + 43 karakter).
func bkey(n int) string { return fmt.Sprintf("rsb_%043d", n) }

func bnd(srv string, n int, tenant string) remember.Binding {
	return remember.Binding{Server: srv, Key: bkey(n), TenantName: tenant, IssuedAt: t0.Add(time.Duration(n) * time.Hour)}
}

// storeWith sırayla kayıtları yazar (son yazılan en son kullanılan değil: LastUsedAt = IssuedAt).
func storeWith(t *testing.T, bs ...remember.Binding) *remember.Store {
	t.Helper()
	s := newStore(t, nil)
	for _, b := range bs {
		b.LastUsedAt = b.IssuedAt
		if err := s.SaveBinding(b, ""); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func issuedMsg(n int, tenant string, idx *int) signal.BindingIssued {
	return signal.BindingIssued{T: "binding.issued", BindingKey: bkey(n), TenantName: tenant, PreviousIndex: idx}
}

func intp(i int) *int { return &i }

func ownCount(t *testing.T, s *remember.Store) int {
	t.Helper()
	d, _ := s.Load()
	return len(d.ForOrigin(server))
}

// TestAC254KeeperMultiSendsSameOriginKeysAndFullOnlyFromEmbedded G-P20-17: previousKeys yalnız gömülü kökenden;
// full yalnız gömülü kökenin 5 öğesinde (başka kökenin öğeleri sayılmaz).
func TestAC254KeeperMultiSendsSameOriginKeysAndFullOnlyFromEmbedded(t *testing.T) {
	s := storeWith(t, bnd(server, 1, "A"), bnd(server, 2, "B"), bnd(other, 3, "S1"), bnd(other, 4, "S2"), bnd(other, 5, "S3"),
		bnd(other, 6, "S4"), bnd(other, 7, "S5"))
	k := newKeeper(s, server, time.Now)
	req, note, ok := k.Request(true)
	if !ok || note != "" || req.Full || len(req.PreviousKeys) != 2 {
		t.Fatalf("%#v %q", req, note)
	}
	for _, key := range req.PreviousKeys {
		if key != bkey(1) && key != bkey(2) {
			t.Fatalf("başka kökenli anahtar gönderildi: %s", key)
		}
	}
	if _, err := signal.Encode(req); err != nil {
		t.Fatal(err)
	}
	s = storeWith(t, bnd(server, 1, "A"), bnd(server, 2, "B"), bnd(server, 3, "C"), bnd(server, 4, "D"), bnd(server, 5, "E"))
	req, _, ok = newKeeper(s, server, time.Now).Request(true)
	if !ok || !req.Full || len(req.PreviousKeys) != 5 {
		t.Fatalf("5 dolu → full: %#v", req)
	}
	req, _, ok = newKeeper(newStore(t, nil), server, time.Now).Request(true)
	if !ok || req.PreviousKeys != nil || req.Full {
		t.Fatalf("kayıtsız: %#v", req)
	}
}

// TestAC254KeeperOldServerNeverSendsPreviousKey eski sunucu (multi yok): previousKey gönderilmez; 5 doluysa istek yok.
func TestAC254KeeperOldServerNeverSendsPreviousKey(t *testing.T) {
	s := storeWith(t, bnd(server, 1, "A"))
	req, _, ok := newKeeper(s, server, time.Now).Request(false)
	if !ok || req.PreviousKey != "" || req.PreviousKeys != nil || req.Full {
		t.Fatalf("%#v", req)
	}
	s = storeWith(t, bnd(server, 1, "A"), bnd(server, 2, "B"), bnd(server, 3, "C"), bnd(server, 4, "D"), bnd(server, 5, "E"))
	k := newKeeper(s, server, time.Now)
	k.tenant = func() string { return "Nokta" }
	if _, note, ok := k.Request(false); ok || note != LimitText("Nokta") {
		t.Fatalf("5 dolu eski sunucu: ok=%v %q", ok, note)
	}
}

// TestAC254KeeperThirdOriginNoRequest G-P20-17: dosyada gömülü köken dışında 2 köken varsa yeni kayıt istenmez.
func TestAC254KeeperThirdOriginNoRequest(t *testing.T) {
	s := newStore(t, nil)
	for i, srv := range []string{other, "https://third.example:443"} {
		b := bnd(srv, i+1, "X")
		// iki yabancı köken: dosyaya doğrudan yazılabilir (gömülü köken yok, sayım ≤ 2)
		if err := s.SaveBinding(b, ""); err != nil {
			t.Fatal(err)
		}
	}
	for _, multi := range []bool{true, false} {
		if _, note, ok := newKeeper(s, server, time.Now).Request(multi); ok || note != NoteThirdOrigin {
			t.Fatalf("multi=%v ok=%v %q", multi, ok, note)
		}
	}
}

// TestAC254KeeperPreviousIndexUpdatesSlot previousIndex yuvası güncellenir (kayıt tarihi korunur, bilgi yok); null →
// yeni yuva + "(n/5)"; aynı oturumda ikinci issued yazılan yuvayı günceller.
func TestAC254KeeperPreviousIndexUpdatesSlot(t *testing.T) {
	s := storeWith(t, bnd(server, 1, "A"), bnd(server, 2, "B"))
	now := func() time.Time { return time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC) }
	k := newKeeper(s, server, now)
	req, _, _ := k.Request(true)
	idx := -1
	for i, key := range req.PreviousKeys {
		if key == bkey(1) {
			idx = i
		}
	}
	if note := k.Issued(issuedMsg(11, "A", intp(idx))); note != "" {
		t.Fatalf("yenilemede bilgi yok: %q", note)
	}
	d, _ := s.Load()
	own := d.ForOrigin(server)
	if len(own) != 2 {
		t.Fatalf("%+v", own)
	}
	for _, b := range own {
		if b.Key == bkey(1) {
			t.Fatal("eski anahtar kalmamalı")
		}
		if b.Key == bkey(11) && !b.IssuedAt.Equal(t0.Add(time.Hour)) {
			t.Fatalf("G-P20-12: kayıt tarihi korunmalı: %v", b.IssuedAt)
		}
	}
	// aynı oturumda ikinci issued (ör. yeniden bağlanma) → aynı yuva
	if note := k.Issued(issuedMsg(12, "A", nil)); note != "" || ownCount(t, s) != 2 {
		t.Fatalf("aynı yuva: %q n=%d", note, ownCount(t, s))
	}

	k2 := newKeeper(s, server, now)
	k2.Request(true)
	if note := k2.Issued(issuedMsg(13, "Yeni Firma", nil)); note != AddedText("Yeni Firma", 3) {
		t.Fatalf("yeni yuva: %q", note)
	}
}

// TestAC254KeeperRenameNote G-P20-12: issued sonrası adı değişen öğede bir kez bilgi.
func TestAC254KeeperRenameNote(t *testing.T) {
	s := storeWith(t, bnd(server, 1, "Eski Ad"))
	k := newKeeper(s, server, time.Now)
	k.Request(true)
	if note := k.Issued(issuedMsg(2, "Yeni Ad", intp(0))); note != RenamedText("Eski Ad", "Yeni Ad") {
		t.Fatalf("%q", note)
	}
}

// TestAC254KeeperFullNewSlotNotWritten 5 doluyken previousIndex null gelirse istemci yazmaz.
func TestAC254KeeperFullNewSlotNotWritten(t *testing.T) {
	s := storeWith(t, bnd(server, 1, "A"), bnd(server, 2, "B"), bnd(server, 3, "C"), bnd(server, 4, "D"), bnd(server, 5, "E"))
	k := newKeeper(s, server, time.Now)
	k.Request(true)
	if note := k.Issued(issuedMsg(9, "F", nil)); !strings.HasPrefix(note, "Bu bilgisayar 5 firmaya kayıtlı; F") {
		t.Fatalf("%q", note)
	}
	if d, _ := s.Load(); len(d.ForOrigin(server)) != 5 || hasBinding(d, bkey(9)) {
		t.Fatal("yazılmamalı")
	}
	k.tenant = func() string { return "Nokta" }
	if k.Limited() != "Bu bilgisayar 5 firmaya kayıtlı; Nokta için kayıt alınmadı. Ana ekrandan bir firmayı unutabilirsiniz." {
		t.Fatal(k.Limited())
	}
}

func hasBinding(d remember.Data, key string) bool {
	for _, b := range d.Bindings {
		if b.Key == key {
			return true
		}
	}
	return false
}

// TestGP204KeeperWriteFailureVisible yazma hatası sessiz değil: bilgi satırı + diag olayı (yalnız sınıf).
func TestGP204KeeperWriteFailureVisible(t *testing.T) {
	s := newStore(t, nil)
	k := newKeeper(&failStore{Store: s}, server, time.Now)
	var events []string
	k.diag = func(ev, class string) { events = append(events, ev+"{"+class+"}") }
	k.Request(true)
	if note := k.Issued(issuedMsg(1, "X", nil)); note != NoteWriteFailed {
		t.Fatalf("%q", note)
	}
	if len(events) != 1 || !strings.HasPrefix(events[0], "store_write_failed{") {
		t.Fatalf("%v", events)
	}
}

// keyLeakStore hata metnine anahtarı koyan depo: diag'a metin değil yalnız sınıf gittiğini sınar.
type keyLeakStore struct{ *remember.Store }

func (keyLeakStore) SaveBinding(b remember.Binding, replace string) error {
	return fmt.Errorf("yazılamadı %s %s", b.Key, replace)
}

// TestAC254KeeperNeverLogsKeys qa önerisi 5 (Go tarafı): previousKeys gönderilen ve yazma hatası alan oturumda diag
// olaylarına ve kullanıcı metinlerine hiçbir kayıt anahtarı (rsb_…) girmez; hata metni anahtar taşısa bile.
func TestAC254KeeperNeverLogsKeys(t *testing.T) {
	s := storeWith(t, bnd(server, 1, "A"), bnd(server, 2, "B"))
	k := newKeeper(keyLeakStore{Store: s}, server, time.Now)
	var out []string
	k.diag = func(ev, class string) { out = append(out, ev, class) }
	req, note, ok := k.Request(true)
	if !ok || len(req.PreviousKeys) != 2 {
		t.Fatalf("%#v", req)
	}
	out = append(out, note, k.Issued(issuedMsg(9, "X", intp(0))), k.Limited())
	if len(out) < 5 || out[0] != eventStoreFailure {
		t.Fatalf("diag olayı beklenirdi: %q", out)
	}
	for _, s := range out {
		if strings.Contains(s, "rsb_") {
			t.Fatalf("anahtar sızdı: %q", s)
		}
	}
}
