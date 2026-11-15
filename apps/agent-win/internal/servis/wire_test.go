package servis

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"remote-support/agent-win/internal/signal"
)

// Sözleşme fikstürü (contracts K1): valid.* geçer, invalid.* reddedilir; sunucu → cihaz ParseServer, cihaz → sunucu
// strict çözüm + validateClient (gönderim öncesi denetim).
type deviceFixture struct {
	AuthMessage struct {
		Nonce, DeviceID, Origin, Expected string
	} `json:"authMessage"`
	Valid   map[string][]json.RawMessage `json:"valid"`
	Invalid map[string][]json.RawMessage `json:"invalid"`
}

func loadFixture(t *testing.T) deviceFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "ws-device.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f deviceFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// parseClient cihaz mesajını kategoriye göre çözer: auth yalnız "deviceAuth", diğerleri "deviceInbound".
func parseClient(cat string, raw []byte) error {
	var head struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	var m any
	switch {
	case cat == "deviceAuth" && head.T == tAuth:
		m = &Auth{}
	case cat == "deviceInbound" && head.T == tConnectResult:
		m = &ConnectResult{}
	case cat == "deviceInbound" && head.T == tState:
		m = &State{}
	case cat == "deviceInbound" && head.T == tClosed:
		m = &Closed{}
	case cat == "deviceInbound" && head.T == tUnregister:
		m = &Unregister{}
	default:
		return errSchema
	}
	if err := signal.DecodeStrict(raw, m); err != nil {
		return err
	}
	if !validateClient(m) {
		return errSchema
	}
	return nil
}

func TestAC273WsDeviceFixtureValid(t *testing.T) {
	f := loadFixture(t)
	for _, raw := range f.Valid["deviceOutbound"] {
		if _, err := ParseServer(raw); err != nil {
			t.Errorf("geçerli sunucu mesajı reddedildi: %s: %v", raw, err)
		}
	}
	for _, cat := range []string{"deviceAuth", "deviceInbound"} {
		for _, raw := range f.Valid[cat] {
			if err := parseClient(cat, raw); err != nil {
				t.Errorf("geçerli cihaz mesajı reddedildi (%s): %s: %v", cat, raw, err)
			}
		}
	}
}

func TestAC273WsDeviceFixtureInvalid(t *testing.T) {
	f := loadFixture(t)
	for _, raw := range f.Invalid["deviceOutbound"] {
		if _, err := ParseServer(raw); err == nil {
			t.Errorf("geçersiz sunucu mesajı kabul edildi: %s", raw)
		}
	}
	for _, cat := range []string{"deviceAuth", "deviceInbound"} {
		for _, raw := range f.Invalid[cat] {
			if err := parseClient(cat, raw); err == nil {
				t.Errorf("geçersiz cihaz mesajı kabul edildi (%s): %s", cat, raw)
			}
		}
	}
}

func TestAC273AuthPayloadMatchesContract(t *testing.T) {
	a := loadFixture(t).AuthMessage
	if got := string(AuthPayload(a.Nonce, a.DeviceID, a.Origin)); got != a.Expected {
		t.Fatalf("imza dizesi = %q, beklenen %q", got, a.Expected)
	}
}

func TestAC295NoEnableMessageFromServer(t *testing.T) {
	for _, raw := range []string{`{"t":"device.enable"}`, `{"t":"device.state","localEnabled":true}`} {
		if _, err := ParseServer([]byte(raw)); err == nil {
			t.Errorf("sunucudan anahtar değiştiren mesaj kabul edildi: %s", raw)
		}
	}
}

func TestEncodeClientRejectsInvalid(t *testing.T) {
	if _, err := encodeClient(&ConnectResult{SessionID: "01JD0000000000000000000002", OK: false}); err == nil {
		t.Fatal("reason'sız ok:false gönderilmemeli")
	}
	if _, err := encodeClient(&Closed{SessionID: "x", Reason: "ended"}); err == nil {
		t.Fatal("geçersiz sessionId gönderilmemeli")
	}
	b, err := encodeClient(&State{LocalEnabled: false})
	if err != nil || string(b) != `{"t":"device.state","localEnabled":false}` {
		t.Fatalf("device.state = %s, %v", b, err)
	}
	if _, err := ParseServer(make([]byte, DeviceMaxMessage+1)); err == nil {
		t.Fatal("4 KB üstü kabul edildi")
	}
}
