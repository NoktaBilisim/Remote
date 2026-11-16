package signal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// techsFixture `packages/contracts/fixtures/multi.json` (P28c-K0; TS ile ortak).
type techsFixture struct {
	Subprotocols map[string]string            `json:"subprotocols"`
	Constants    map[string]json.RawMessage   `json:"constants"`
	Valid        map[string][]json.RawMessage `json:"valid"`
	Invalid      map[string][]json.RawMessage `json:"invalid"`
}

func loadTechs(t *testing.T) techsFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "multi.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f techsFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// decodeMultiGuest multi1 misafirin mesajını katı çözüp Encode'dan geçirir; multi1 sokette sdp.answer/ice `to` zorunlu.
func decodeMultiGuest(raw []byte) ([]byte, error) {
	var m Outbound
	var to func() string
	switch msgType(raw) {
	case "sdp.answer":
		a := &SdpAnswer{}
		m, to = a, func() string { return a.To }
	case "ice":
		c := &Ice{}
		m, to = c, func() string { return c.To }
	case "tech.remove":
		m = &TechRemove{}
	default:
		return nil, errors.New("misafir bu tipi gönderemez")
	}
	if err := decodeStrict(raw, m); err != nil {
		return nil, err
	}
	if to != nil && to() == "" {
		return nil, errors.New("multi1 sokette to zorunlu")
	}
	return Encode(m)
}

func TestAC372P28cConstantsMatchFixture(t *testing.T) {
	f := loadTechs(t)
	if f.Subprotocols["multi"] != FeatureMulti {
		t.Fatalf("belirteç %q", f.Subprotocols["multi"])
	}
	ints := map[string]int{"MAX_TECHS": MaxTechs, "LOW_FPS": LowFPS, "LOW_FPS_MIN": LowFPSMin, "LOW_BPS": LowBPS,
		"ROSTER_NAME_MAX": rosterNameMax, "WS_CLOSE_REMOVED": CloseRemoved}
	for k, want := range ints {
		var got int
		if err := json.Unmarshal(f.Constants[k], &got); err != nil || got != want {
			t.Errorf("%s: fikstür %d, Go %d", k, got, want)
		}
	}
	var pat string
	if err := json.Unmarshal(f.Constants["TID_PATTERN"], &pat); err != nil || pat != tidPatternText {
		t.Errorf("TID_PATTERN %q", pat)
	}
	if _, err := subprotocols("rs.ticket.x", []string{FeatureMulti}); err != nil {
		t.Errorf("Dial multi1 belirtecini kabul etmeli: %v", err)
	}
}

func TestAC366P28cGuestInboundMatchesFixture(t *testing.T) {
	f := loadTechs(t)
	for _, raw := range f.Valid["guestInbound"] {
		out, err := decodeMultiGuest(raw)
		if err != nil {
			t.Errorf("geçerli mesaj reddedildi %s: %v", raw, err)
			continue
		}
		if !jsonEqual(t, raw, out) {
			t.Errorf("yeniden kodlama farklı:\n in  %s\n out %s", raw, out)
		}
	}
	for _, raw := range f.Invalid["guestInbound"] {
		if _, err := decodeMultiGuest(raw); err == nil {
			t.Errorf("geçersiz mesaj kabul edildi: %s", raw)
		}
	}
}

func TestAC366P28cGuestOutboundMatchesFixture(t *testing.T) {
	f := loadTechs(t)
	for _, raw := range f.Valid["guestOutbound"] {
		if _, err := ParseServer(raw); err != nil {
			t.Errorf("geçerli sunucu mesajı reddedildi %s: %v", raw, err)
		}
	}
	for _, raw := range f.Invalid["guestOutbound"] {
		if _, err := ParseServer(raw); err == nil {
			t.Errorf("geçersiz sunucu mesajı kabul edildi: %s", raw)
		}
	}
	// Teknisyen hello'su (tid/techRole/roster) misafire gelmez; gelirse katı çözüm reddeder.
	for _, raw := range f.Valid["techOutbound"] {
		if msgType(raw) == "hello" {
			if _, err := ParseServer(raw); err == nil {
				t.Errorf("teknisyen hello'su misafirde kabul edildi: %s", raw)
			}
		}
	}
}
