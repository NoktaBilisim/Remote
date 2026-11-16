package signal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// fsrvFixture `packages/contracts/fixtures/fsrv.json` (P28b-K2; Go K5 ile ortak).
type fsrvFixture struct {
	Subprotocol string                       `json:"subprotocol"`
	Constants   map[string]json.RawMessage   `json:"constants"`
	Sets        map[string][]string          `json:"sets"`
	Valid       map[string][]json.RawMessage `json:"valid"`
	Invalid     map[string][]json.RawMessage `json:"invalid"`
	Features    []struct {
		Case         string   `json:"case"`
		Unattended   bool     `json:"unattended"`
		GuestKind    string   `json:"guestKind"`
		Subprotocols []string `json:"subprotocols"`
		HasFsrv      bool     `json:"hasFsrv"`
	} `json:"features"`
}

func loadFsrv(t *testing.T) fsrvFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "fsrv.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f fsrvFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

// decodeFsrvGuest misafirin fsrv mesajını Go struct'ına katı çözüp Encode'dan geçirir.
func decodeFsrvGuest(raw []byte) ([]byte, error) {
	var m Outbound
	switch msgType(raw) {
	case "fsrv.accept":
		m = &FsrvAccept{}
	case "fsrv.reject":
		m = &FsrvReject{}
	case "fsrv.result":
		m = &FsrvResult{}
	case "fsrv.cancel":
		m = &FsrvCancel{}
	default:
		return nil, errors.New("misafir bu tipi gönderemez")
	}
	if err := decodeStrict(raw, m); err != nil {
		return nil, err
	}
	return Encode(m)
}

func TestAC355P28bInboundMessagesMatchFixture(t *testing.T) {
	f := loadFsrv(t)
	for _, raw := range f.Valid["inbound"] {
		if msgType(raw) == "fsrv.init" {
			continue // Windows istemci yükleme yapmaz (P28b K8: Upload akışı yok); fsrv.init yalnız web misafirinde
		}
		out, err := decodeFsrvGuest(raw)
		if err != nil {
			t.Errorf("geçerli mesaj reddedildi %s: %v", raw, err)
			continue
		}
		if !jsonEqual(t, raw, out) {
			t.Errorf("yeniden kodlama farklı:\n in  %s\n out %s", raw, out)
		}
	}
	for _, raw := range f.Invalid["inbound"] {
		if _, err := decodeFsrvGuest(raw); err == nil {
			t.Errorf("geçersiz mesaj kabul edildi: %s", raw)
		}
	}
}

func TestAC355P28bServerMessagesMatchFixture(t *testing.T) {
	f := loadFsrv(t)
	seen := map[string]bool{}
	for _, raw := range f.Valid["server"] {
		m, err := ParseServer(raw)
		if err != nil {
			t.Errorf("geçerli sunucu mesajı reddedildi %s: %v", raw, err)
			continue
		}
		seen[m.Type()] = true
		if h, ok := m.(Hello); ok && h.FileMode != FileModeServer {
			t.Errorf("hello.fileMode okunmadı: %+v", h)
		}
	}
	for _, typ := range []string{"fsrv.upload", "fsrv.status", "fsrv.offer", "fsrv.download", "hello", "peer.joined"} {
		if !seen[typ] {
			t.Errorf("fikstürde %s örneği yok", typ)
		}
	}
	for _, raw := range f.Invalid["server"] {
		if _, err := ParseServer(raw); err == nil {
			t.Errorf("geçersiz sunucu mesajı kabul edildi: %s", raw)
		}
	}
}

func TestAC355P28bConstantsAndSetsMatchFixture(t *testing.T) {
	f := loadFsrv(t)
	if f.Subprotocol != FeatureFsrv {
		t.Fatalf("belirteç %q", f.Subprotocol)
	}
	nums := map[string]int{"FSRV_CHUNK_BYTES": FsrvChunkBytes, "FSRV_MAX_BYTES": FsrvMaxBytes, "FSRV_MAX_CHUNKS": FsrvMaxChunks,
		"FSRV_PRINT_MAX_BYTES": FsrvPrintMaxBytes, "FSRV_DOWNLOAD_TTL_MS": FsrvDownloadTTLMs,
		"FSRV_DOWNLOAD_TOKENS_PER_FILE": FsrvDownloadTokensPerFile}
	for k, want := range nums {
		var got int
		if err := json.Unmarshal(f.Constants[k], &got); err != nil || got != want {
			t.Errorf("%s = %s, Go %d", k, f.Constants[k], want)
		}
	}
	strs := map[string]string{"FSRV_PRINT_FILE_NAME": FsrvPrintFileName, "FSRV_XID_PATTERN": clipPrintIDPatternString,
		"FSRV_FID_PATTERN": ulidRe.String(), "FSRV_TOKEN_PATTERN": tokenRe.String(), "SHA256_HEX_PATTERN": sha256Re.String(),
		"AV_SIGNATURE_PATTERN": avSignatureRe.String()}
	for k, want := range strs {
		var got string
		if err := json.Unmarshal(f.Constants[k], &got); err != nil || got != want {
			t.Errorf("%s = %s, Go %q", k, f.Constants[k], want)
		}
	}
	for name, want := range map[string][]string{"fileModes": fileModes, "purposes": fsrvPurposes, "wireStates": fsrvWireStates,
		"gateReasons": fsrvGateReasons, "scanReasons": avScanReasons, "peerFeatures": guestFeatureValues} {
		if !slices.Equal(f.Sets[name], want) {
			t.Errorf("%s = %v, Go %v", name, f.Sets[name], want)
		}
	}
}

// AC-355 / §5.1: 0.14 istemci katılımlı oturumda üç belirteci bildirir; gözetimsiz yardımcı hiç bildirmez (features=nil).
func TestAC355P28bSubprotocolFeatures(t *testing.T) {
	f := loadFsrv(t)
	for _, c := range f.Features {
		if c.GuestKind != "AGENT" {
			continue
		}
		var feats []string
		if !c.Unattended {
			feats = c.Subprotocols[1:]
		}
		got, err := subprotocols("rs.ticket.x", feats)
		if err != nil {
			t.Fatalf("%s: %v", c.Case, err)
		}
		if has := slices.Contains(got, FeatureFsrv); has != c.HasFsrv {
			t.Errorf("%s: fsrv bildirimi %v, beklenen %v", c.Case, has, c.HasFsrv)
		}
	}
	if _, err := subprotocols("rs.ticket.x", []string{FeatureFsrv, FeatureFsrv}); err == nil {
		t.Error("tekrarlı belirteç kabul edildi")
	}
}
