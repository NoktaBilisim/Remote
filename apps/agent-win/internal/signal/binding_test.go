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

func loadBindings(t *testing.T) bindingFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "bindings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f bindingFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// TestAC181BindingServerMessagesStrict ortak fixture: binding.offer/issued sıkı ayrıştırılır (bilinmeyen/eksik alan,
// biçimsiz anahtar red); bilinmeyen tip yine hata (mevcut davranış).
func TestAC181BindingServerMessagesStrict(t *testing.T) {
	f := loadBindings(t)
	for _, raw := range f.Valid["serverOutbound"] {
		if _, err := ParseServer(raw); err != nil {
			t.Errorf("geçerli mesaj reddedildi %s: %v", raw, err)
		}
	}
	for _, raw := range f.Invalid["serverOutbound"] {
		if _, err := ParseServer(raw); err == nil {
			t.Errorf("geçersiz mesaj kabul edildi: %s", raw)
		}
	}
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
	for _, raw := range f.Valid["guestInbound"] {
		var m BindingRequest
		if err := decodeStrict(raw, &m); err != nil {
			t.Fatal(err)
		}
		out, err := Encode(m)
		if err != nil || !jsonEqual(t, raw, out) {
			t.Errorf("%s → %s %v", raw, out, err)
		}
	}
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
