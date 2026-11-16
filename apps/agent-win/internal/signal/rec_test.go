package signal

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// recFixture `packages/contracts/fixtures/rec.json` (P28e-K2; TS ve servis ile ortak).
type recFixture struct {
	Subprotocols map[string]string            `json:"subprotocols"`
	Consent      map[string]string            `json:"consent"`
	Constants    map[string]json.RawMessage   `json:"constants"`
	Valid        map[string][]json.RawMessage `json:"valid"`
	Invalid      map[string][]json.RawMessage `json:"invalid"`
}

func loadRec(t *testing.T) recFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "rec.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f recFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// decodeRecGuest misafirin rec mesajını katı çözüp Encode'dan geçirir.
func decodeRecGuest(raw []byte) ([]byte, error) {
	var m Outbound
	switch msgType(raw) {
	case "rec.consent":
		m = &RecConsent{}
	case "rec.revoke":
		m = &RecRevoke{}
	default:
		return nil, errors.New("misafir bu tipi gönderemez")
	}
	if err := decodeStrict(raw, m); err != nil {
		return nil, err
	}
	return Encode(m)
}

// parseRecServer misafire gelen rec.state (K2: ParseServer tablosunda değil, K5 bağlar) ve hello.rec.
func parseRecServer(raw []byte) error {
	if msgType(raw) == "rec.state" {
		_, err := decodeValid(raw, validRecState)
		return err
	}
	_, err := ParseServer(raw)
	return err
}

func TestAC381P28eConsentLineAndConstants(t *testing.T) {
	f := loadRec(t)
	sum := sha256.Sum256([]byte(RecConsentLine))
	if hex.EncodeToString(sum[:]) != RecConsentLineSHA256 {
		t.Fatalf("SHA sabiti cümleyle uyuşmuyor")
	}
	if f.Consent["line"] != RecConsentLine || f.Consent["lineSha256"] != RecConsentLineSHA256 {
		t.Fatalf("fikstür rıza metni farklı: %v", f.Consent)
	}
	if f.Subprotocols["rec"] != FeatureRec {
		t.Fatalf("belirteç %q", f.Subprotocols["rec"])
	}
	var ack int
	if err := json.Unmarshal(f.Constants["REC_REVOKE_ACK_MS"], &ack); err != nil || ack != RecRevokeAckMs {
		t.Fatalf("REC_REVOKE_ACK_MS %d", ack)
	}
}

func TestAC382P28eGuestInboundMatchesFixture(t *testing.T) {
	f := loadRec(t)
	for _, raw := range f.Valid["guestInbound"] {
		out, err := decodeRecGuest(raw)
		if err != nil {
			t.Errorf("geçerli mesaj reddedildi %s: %v", raw, err)
			continue
		}
		if !jsonEqual(t, raw, out) {
			t.Errorf("yeniden kodlama farklı:\n in  %s\n out %s", raw, out)
		}
	}
	for _, raw := range f.Invalid["guestInbound"] {
		if _, err := decodeRecGuest(raw); err == nil {
			t.Errorf("geçersiz mesaj kabul edildi: %s", raw)
		}
	}
}

func TestAC382P28eGuestOutboundMatchesFixture(t *testing.T) {
	f := loadRec(t)
	for _, raw := range f.Valid["guestOutbound"] {
		if err := parseRecServer(raw); err != nil {
			t.Errorf("geçerli sunucu mesajı reddedildi %s: %v", raw, err)
		}
	}
	for _, raw := range f.Invalid["guestOutbound"] {
		if err := parseRecServer(raw); err == nil {
			t.Errorf("geçersiz sunucu mesajı kabul edildi: %s", raw)
		}
	}
	// Teknisyen biçimi (rid/basis/upload) misafirde katı çözümde reddedilir.
	for _, raw := range f.Valid["techOutbound"] {
		if err := parseRecServer(raw); err == nil {
			t.Errorf("teknisyen mesajı misafirde kabul edildi: %s", raw)
		}
	}
}
