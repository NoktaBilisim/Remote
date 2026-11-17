package signal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// voiceFixture `packages/contracts/fixtures/voice.json` (P28d-K0; TS ile ortak).
type voiceFixture struct {
	Subprotocols map[string]string            `json:"subprotocols"`
	Constants    map[string]json.RawMessage   `json:"constants"`
	Sets         map[string][]string          `json:"sets"`
	Valid        map[string][]json.RawMessage `json:"valid"`
	Invalid      map[string][]json.RawMessage `json:"invalid"`
}

func loadVoice(t *testing.T) voiceFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "voice.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f voiceFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// decodeVoiceGuest voice1 misafirin ses mesajını katı çözüp Encode'dan geçirir.
func decodeVoiceGuest(raw []byte) ([]byte, error) {
	var m Outbound
	switch msgType(raw) {
	case "voice.answer":
		m = &VoiceAnswer{}
	case "voice.end":
		m = &VoiceEnd{}
	default:
		return nil, errors.New("misafir bu tipi gönderemez")
	}
	if err := decodeStrict(raw, m); err != nil {
		return nil, err
	}
	return Encode(m)
}

func TestAC377P28dConstantsMatchFixture(t *testing.T) {
	f := loadVoice(t)
	if f.Subprotocols["voice"] != FeatureVoice {
		t.Fatalf("belirteç %q", f.Subprotocols["voice"])
	}
	ints := map[string]int{"VOICE_REQUEST_TIMEOUT_MS": VoiceRequestTimeoutMs, "VOICE_DENY_COOLDOWN_MS": VoiceDenyCooldownMs,
		"VOICE_REQUESTS_PER_SESSION": VoiceRequestsPerSession, "VOICE_MAX_OPUS_BYTES": VoiceMaxOpusBytes,
		"VOICE_MAX_PKT_PER_SEC": VoiceMaxPktPerSec}
	for k, want := range ints {
		var got int
		if err := json.Unmarshal(f.Constants[k], &got); err != nil || got != want {
			t.Errorf("%s: fikstür %d, Go %d", k, got, want)
		}
	}
	var pat string
	if err := json.Unmarshal(f.Constants["CALL_ID_PATTERN"], &pat); err != nil || pat != callIDPatternText {
		t.Errorf("CALL_ID_PATTERN %q", pat)
	}
	sets := map[string][]string{"phases": voicePhases, "endReasons": voiceEndReasons, "guestEndReasons": voiceGuestEndReasons}
	for k, want := range sets {
		if !slices.Equal(f.Sets[k], want) {
			t.Errorf("%s: fikstür %v, Go %v", k, f.Sets[k], want)
		}
	}
	if _, err := subprotocols("rs.ticket.x", []string{FeatureMulti, FeatureVoice}); err != nil {
		t.Errorf("Dial voice1 belirtecini kabul etmeli: %v", err)
	}
	if !slices.Contains(wsErrorCodes, "CLIENT_UNSUPPORTED") {
		t.Error("wsErrorCodes TS WS_ERROR_CODES ile eş olmalı (CLIENT_UNSUPPORTED)")
	}
}

func TestAC374P28dGuestInboundMatchesFixture(t *testing.T) {
	f := loadVoice(t)
	for _, raw := range f.Valid["guestInbound"] {
		out, err := decodeVoiceGuest(raw)
		if err != nil {
			t.Errorf("geçerli mesaj reddedildi %s: %v", raw, err)
			continue
		}
		if !jsonEqual(t, raw, out) {
			t.Errorf("yeniden kodlama farklı:\n in  %s\n out %s", raw, out)
		}
	}
	for _, raw := range f.Invalid["guestInbound"] {
		if _, err := decodeVoiceGuest(raw); err == nil {
			t.Errorf("geçersiz mesaj kabul edildi: %s", raw)
		}
	}
	// Encode da doğrular: istemci yanlış neden/callId üretemez.
	if _, err := Encode(VoiceEnd{T: "voice.end", CallID: "AbCdEfGhIjKlMnOpQrSt_-", Reason: "tech"}); err == nil {
		t.Error("misafir tech nedeniyle bitiremez")
	}
	if _, err := Encode(VoiceAnswer{T: "voice.answer", CallID: "kisa", Accept: true}); err == nil {
		t.Error("geçersiz callId kodlandı")
	}
}

func TestAC378P28dGuestOutboundMatchesFixture(t *testing.T) {
	f := loadVoice(t)
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
	// Teknisyen biçimleri (guestVoice'lu hello/peer.joined, teknisyen voice.request) misafirde reddedilir.
	for _, raw := range f.Valid["techOutbound"] {
		switch msgType(raw) {
		case "hello", "peer.joined":
			if _, err := ParseServer(raw); err == nil {
				t.Errorf("teknisyen biçimi misafirde kabul edildi: %s", raw)
			}
		}
	}
	for _, raw := range f.Valid["techInbound"] {
		if msgType(raw) == "voice.request" {
			if _, err := ParseServer(raw); err == nil {
				t.Errorf("teknisyen voice.request biçimi misafirde kabul edildi: %s", raw)
			}
		}
	}
}
