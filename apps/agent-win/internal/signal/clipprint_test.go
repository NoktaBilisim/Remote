package signal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// clipPrintFixture `packages/contracts/fixtures/clip-print.json` (P28a-K1; Go K3 ile ortak).
type clipPrintFixture struct {
	Subprotocols   map[string]string            `json:"subprotocols"`
	Constants      map[string]json.RawMessage   `json:"constants"`
	Results        map[string][]string          `json:"results"`
	Valid          map[string][]json.RawMessage `json:"valid"`
	Invalid        map[string][]json.RawMessage `json:"invalid"`
	GuestNoFeature []json.RawMessage            `json:"guestNoFeature"`
}

func loadClipPrint(t *testing.T) clipPrintFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "clip-print.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f clipPrintFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// decodeClipPrintGuest misafirin P28a mesajını Go struct'ına katı çözüp Encode'dan geçirir.
func decodeClipPrintGuest(raw []byte) ([]byte, error) {
	var m Outbound
	switch msgType(raw) {
	case "clip.consent":
		m = &ClipConsentSet{}
	case "clip.report":
		m = &ClipReport{}
	case "print.report":
		m = &PrintReport{}
	default:
		return nil, errors.New("misafir bu tipi gönderemez")
	}
	if err := decodeStrict(raw, m); err != nil {
		return nil, err
	}
	return Encode(m)
}

func TestAC343P28aGuestMessagesMatchFixture(t *testing.T) {
	f := loadClipPrint(t)
	for _, raw := range append(append([]json.RawMessage{}, f.Valid["guest"]...), f.GuestNoFeature...) {
		out, err := decodeClipPrintGuest(raw)
		if err != nil {
			t.Errorf("geçerli misafir mesajı reddedildi %s: %v", raw, err)
			continue
		}
		if !jsonEqual(t, raw, out) {
			t.Errorf("yeniden kodlama farklı:\n in  %s\n out %s", raw, out)
		}
	}
	for _, raw := range f.Invalid["guest"] {
		if _, err := decodeClipPrintGuest(raw); err == nil {
			t.Errorf("geçersiz misafir mesajı kabul edildi: %s", raw)
		}
	}
}

func TestAC343P28aServerMessagesMatchFixture(t *testing.T) {
	f := loadClipPrint(t)
	seen := map[string]bool{}
	for _, raw := range f.Valid["server"] {
		m, err := ParseServer(raw)
		if typ := msgType(raw); typ == "clip.status" || typ == "print.status" {
			if !errors.Is(err, ErrNotForGuest) {
				t.Errorf("%s misafire yönelik değil sayılmalı: %v", typ, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("geçerli sunucu mesajı reddedildi %s: %v", raw, err)
			continue
		}
		seen[m.Type()] = true
	}
	for _, typ := range []string{"clip.consent", "clip.push", "clip.pull", "print.request", "print.cancel", "caps.update"} {
		if !seen[typ] {
			t.Errorf("fikstürde %s örneği yok", typ)
		}
	}
	for _, raw := range f.Invalid["server"] {
		if _, err := ParseServer(raw); err == nil {
			t.Errorf("geçersiz sunucu mesajı kabul edildi: %s", raw)
		}
	}
	// Teknisyen mesajları sunucuda id'siz yeniden kurulup misafire iletilir: geçerliler geçer, geçersizler (sınır/alan)
	// misafirde de reddedilir.
	strip := func(raw []byte) []byte {
		var obj map[string]any
		_ = json.Unmarshal(raw, &obj)
		delete(obj, "id")
		b, _ := json.Marshal(obj)
		return b
	}
	for _, raw := range f.Valid["tech"] {
		if _, err := ParseServer(strip(raw)); err != nil {
			t.Errorf("iletilen %s reddedildi: %v", raw, err)
		}
	}
	for _, raw := range f.Invalid["tech"] {
		if _, err := ParseServer(strip(raw)); err == nil {
			t.Errorf("geçersiz teknisyen mesajı misafirde kabul edildi: %s", raw)
		}
	}
}

func TestAC352P28aConstantsAndResultsMatchFixture(t *testing.T) {
	f := loadClipPrint(t)
	if f.Subprotocols["clipboard"] != FeatureClip || f.Subprotocols["print"] != FeaturePrint {
		t.Fatalf("belirteçler %v", f.Subprotocols)
	}
	nums := map[string]int{"CLIP_MAX_BYTES": ClipMaxBytes, "CLIP_GUEST_DEADLINE_MS": ClipGuestDeadlineMs,
		"PRINT_MAX_BYTES": PrintMaxBytes, "PRINT_MIN_BYTES": PrintMinBytes, "PRINT_CONSENT_TIMEOUT_MS": PrintConsentTimeoutMs,
		"PRINT_GUEST_TRANSFER_DEADLINE_MS": PrintGuestTransferMs, "PRINT_MAX_PAGES": PrintMaxPages, "ID_REUSE_WINDOW": IDReuseWindow}
	for k, want := range nums {
		var got int
		if err := json.Unmarshal(f.Constants[k], &got); err != nil || got != want {
			t.Errorf("%s = %s, Go %d", k, f.Constants[k], want)
		}
	}
	var pat string
	_ = json.Unmarshal(f.Constants["CLIP_PRINT_ID_PATTERN"], &pat)
	if pat != clipPrintIDPatternString {
		t.Errorf("kimlik deseni %q", pat)
	}
	for name, want := range map[string][]string{"clipGuest": clipGuestResults, "printGuest": printGuestResults,
		"printDecisions": printDecisions} {
		if !slices.Equal(f.Results[name], want) {
			t.Errorf("%s = %v, Go %v", name, f.Results[name], want)
		}
	}
	if !slices.Equal(caps, []string{"remote_control", "file_transfer", "clipboard", "print"}) {
		t.Errorf("caps %v", caps)
	}
}

func TestAC352P28aSubprotocolFeatures(t *testing.T) {
	got, err := subprotocols("rs.ticket.x", []string{FeatureClip, FeaturePrint})
	if err != nil || !slices.Equal(got, []string{"rs.v1", "rs.ticket.x", "rs.cap.clip1", "rs.cap.print1"}) {
		t.Fatalf("%v %v", got, err)
	}
	if got, _ := subprotocols("rs.ticket.x", nil); !slices.Equal(got, []string{"rs.v1", "rs.ticket.x"}) {
		t.Fatalf("özelliksiz (yardımcı): %v", got)
	}
	for _, bad := range [][]string{{"rs.cap.voice1"}, {FeatureClip, FeatureClip}, {"rs.ticket.y"}} {
		if _, err := subprotocols("rs.ticket.x", bad); err == nil {
			t.Errorf("kabul edilmemeliydi: %v", bad)
		}
	}
}
