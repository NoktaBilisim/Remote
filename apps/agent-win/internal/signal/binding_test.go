package signal

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type bindingFixture struct {
	ValidKeys   []string                     `json:"validKeys"`
	InvalidKeys []string                     `json:"invalidKeys"`
	Valid       map[string][]json.RawMessage `json:"valid"`
	Invalid     map[string][]json.RawMessage `json:"invalid"`
}

// readBindings contracts `bindings.json` fikstürünü dst'ye çözer.
func readBindings(t *testing.T, dst any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "bindings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, dst); err != nil {
		t.Fatal(err)
	}
}

func loadBindings(t *testing.T) bindingFixture {
	t.Helper()
	var f bindingFixture
	readBindings(t, &f)
	return f
}

// expectServerParse fikstürün geçerli sunucu mesajları ayrışır, geçersizleri reddedilir.
func expectServerParse(t *testing.T, valid, invalid []json.RawMessage) {
	t.Helper()
	for _, raw := range valid {
		if _, err := ParseServer(raw); err != nil {
			t.Errorf("geçerli mesaj reddedildi %s: %v", raw, err)
		}
	}
	for _, raw := range invalid {
		if _, err := ParseServer(raw); err == nil {
			t.Errorf("geçersiz mesaj kabul edildi: %s", raw)
		}
	}
}

// expectRequestRoundTrip fikstürün geçerli binding.request'leri Go tipinden birebir aynı JSON'a kodlanır.
func expectRequestRoundTrip(t *testing.T, valid []json.RawMessage) {
	t.Helper()
	for _, raw := range valid {
		var m BindingRequest
		if err := decodeStrict(raw, &m); err != nil {
			t.Fatal(err)
		}
		out, err := Encode(m)
		if err != nil || !jsonEqual(t, raw, out) {
			t.Errorf("%s → %s %v", raw, out, err)
		}
	}
}

// TestAC181BindingServerMessagesStrict ortak fixture: binding.offer/issued sıkı ayrıştırılır (bilinmeyen/eksik alan,
// biçimsiz anahtar red); bilinmeyen tip yine hata (mevcut davranış).
func TestAC181BindingServerMessagesStrict(t *testing.T) {
	f := loadBindings(t)
	expectServerParse(t, f.Valid["serverOutbound"], f.Invalid["serverOutbound"])
	m, err := ParseServer([]byte(`{"t":"binding.issued","bindingKey":"` + f.ValidKeys[0] + `","tenantName":"N","customerFirmName":null,"renewed":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if bi, ok := m.(BindingIssued); !ok || bi.CustomerFirmName != nil || !bi.Renewed {
		t.Fatalf("%#v", m)
	}
	for _, s := range []string{
		`{"t":"binding.issued","bindingKey":"` + f.ValidKeys[0] + `","tenantName":"N","customerFirmName":null,"renewed":"x"}`,
		`{"t":"binding.denied"}`,
		`{"t":"binding.request"}`, // istemciden sunucuya yönlü
	} {
		if _, err := ParseServer([]byte(s)); err == nil {
			t.Errorf("kabul edilmemeli: %s", s)
		}
	}
}

func TestAC181BindingRequestEncodeMatchesFixture(t *testing.T) {
	f := loadBindings(t)
	expectRequestRoundTrip(t, f.Valid["guestInbound"])
	for _, k := range f.InvalidKeys {
		if _, err := Encode(BindingRequest{T: "binding.request", PreviousKey: k}); err == nil {
			t.Errorf("geçersiz previousKey kodlandı: %s", k)
		}
	}
	for _, k := range f.ValidKeys {
		if _, err := Encode(BindingRequest{T: "binding.request", PreviousKey: k}); err != nil {
			t.Errorf("geçerli anahtar reddedildi: %s", k)
		}
	}
}

type multiFixture struct {
	Multi struct {
		Constants struct {
			MinVersion   string `json:"minVersion"`
			MaxPerDevice int    `json:"maxPerDevice"`
		} `json:"constants"`
		ErrorCode string                       `json:"errorCode"`
		Valid     map[string][]json.RawMessage `json:"valid"`
		Invalid   map[string][]json.RawMessage `json:"invalid"`
		Exclusive []json.RawMessage            `json:"exclusive"`
	} `json:"multi"`
}

func loadMulti(t *testing.T) multiFixture {
	t.Helper()
	var f multiFixture
	readBindings(t, &f)
	return f
}

// TestAC254MultiServerMessagesFixture P20 §6.1 fikstürü: `binding.offer.multi` yalnız true, `previousIndex` 0..4|null,
// `error BINDING_LIMIT` kabul; sınır dışı/tamsayı olmayan sıra ve `multi:false` red.
func TestAC254MultiServerMessagesFixture(t *testing.T) {
	f := loadMulti(t).Multi
	if f.Constants.MaxPerDevice != BindingMaxPerOrigin {
		t.Fatalf("maxPerDevice %d ≠ %d", f.Constants.MaxPerDevice, BindingMaxPerOrigin)
	}
	expectServerParse(t, f.Valid["serverOutbound"], f.Invalid["serverOutbound"])
	for _, s := range []string{`{"t":"binding.offer","multi":null}`, `{"t":"binding.offer","multi":"true"}`,
		`{"t":"binding.offer","Multi":true}`} {
		if _, err := ParseServer([]byte(s)); err == nil {
			t.Errorf("kabul edilmemeli: %s", s)
		}
	}
	m, err := ParseServer([]byte(`{"t":"binding.offer","multi":true}`))
	if err != nil || !m.(BindingOffer).IsMulti() {
		t.Fatalf("%#v %v", m, err)
	}
	if m, _ := ParseServer([]byte(`{"t":"binding.offer"}`)); m.(BindingOffer).IsMulti() {
		t.Fatal("alansız teklif multi değil")
	}
	m, err = ParseServer([]byte(`{"t":"binding.issued","bindingKey":"rsb_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","tenantName":"N","customerFirmName":null,"renewed":true,"previousIndex":3}`))
	if bi, ok := m.(BindingIssued); err != nil || !ok || bi.PreviousIndex == nil || *bi.PreviousIndex != 3 {
		t.Fatalf("%#v %v", m, err)
	}
	if m, err := ParseServer([]byte(`{"t":"error","code":"` + f.ErrorCode + `","message":"x"}`)); err != nil ||
		m.(ErrorMsg).Code != "BINDING_LIMIT" {
		t.Fatalf("BINDING_LIMIT: %#v %v", m, err)
	}
}

// TestAC254MultiRequestEncodeMatchesFixture istemcinin ürettiği `previousKeys`/`full` istekleri fikstürle birebir;
// sunucunun reddettiği biçimler (boş/6 öğe/yinelenen/biçimsiz) ve `previousKey`+`previousKeys` hiç kodlanmaz.
func TestAC254MultiRequestEncodeMatchesFixture(t *testing.T) {
	f := loadMulti(t).Multi
	expectRequestRoundTrip(t, f.Valid["guestInbound"])
	for _, raw := range append(f.Invalid["guestInbound"], f.Exclusive...) {
		var m BindingRequest
		if err := decodeStrict(raw, &m); err != nil {
			continue // Go tipine hiç sığmıyor (ör. `previousKeys` dize)
		}
		// İstemci bu biçimi üretemez: ya kodlama reddedilir ya da çıktı (omitempty ile `[]`/`null`/`false` düşer) farklıdır.
		if out, err := Encode(m); err == nil && jsonEqual(t, raw, out) {
			t.Errorf("geçersiz istek birebir kodlandı: %s", raw)
		}
	}
	if out, _ := Encode(BindingRequest{T: "binding.request", PreviousKeys: []string{}}); string(out) != `{"t":"binding.request"}` {
		t.Fatalf("boş liste alan olarak gitmemeli: %s", out)
	}
}
