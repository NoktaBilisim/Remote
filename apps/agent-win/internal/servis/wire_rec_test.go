package servis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"remote-support/agent-win/internal/signal"
)

// P28e-K2: record1 cihaz soketi sözleşme eşi (`packages/contracts/fixtures/rec.json` deviceOutbound).
type recDeviceFixture struct {
	Subprotocols map[string]string            `json:"subprotocols"`
	Valid        map[string][]json.RawMessage `json:"valid"`
	Invalid      map[string][]json.RawMessage `json:"invalid"`
}

func loadRecFixture(t *testing.T) recDeviceFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "rec.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f recDeviceFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// parseRecDevice record1 sokette gelen mesaj: rec.state (K6 ParseServer'a bağlar) ya da mevcut ayrıştırıcı + consent1 kuralı.
func parseRecDevice(raw []byte) bool {
	var head struct {
		T string `json:"t"`
	}
	if json.Unmarshal(raw, &head) != nil {
		return false
	}
	if head.T == tRecState {
		var m RecState
		return signal.DecodeStrict(raw, &m) == nil && validRecState(&m)
	}
	m, err := ParseServer(raw)
	if err != nil {
		return false
	}
	if c, ok := m.(*Connect); ok {
		return connectConsent(c)
	}
	return true
}

func TestAC448P28eRecordDeviceMessagesMatchFixture(t *testing.T) {
	f := loadRecFixture(t)
	if f.Subprotocols["record"] != DeviceCapRecord { // r3: AC-449 diyalog satırı Go'da yok (onay diyaloğu kalktı)
		t.Fatalf("belirteç fikstürle farklı: %v", f.Subprotocols)
	}
	for _, raw := range f.Valid["deviceOutbound"] {
		if !parseRecDevice(raw) {
			t.Errorf("geçerli mesaj reddedildi: %s", raw)
		}
	}
	for _, raw := range f.Invalid["deviceOutbound"] {
		if parseRecDevice(raw) {
			t.Errorf("geçersiz mesaj kabul edildi: %s", raw)
		}
	}
}

func TestAC449P28eConnectRecordingParsed(t *testing.T) {
	f := loadRecFixture(t)
	m, err := ParseServer(f.Valid["deviceOutbound"][0])
	if err != nil {
		t.Fatal(err)
	}
	if c := m.(*Connect); c.Recording == nil || !*c.Recording {
		t.Fatalf("connect.recording okunmadı: %+v", c)
	}
}
