package signal

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type wsFixture struct {
	Valid   map[string][]json.RawMessage `json:"valid"`
	Invalid map[string][]json.RawMessage `json:"invalid"`
}

func loadWS(t *testing.T) wsFixture {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "ws-messages.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f wsFixture
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func msgType(raw []byte) string {
	var e struct {
		T string `json:"t"`
	}
	_ = json.Unmarshal(raw, &e)
	return e.T
}

// decodeGuest guestInboundSchema eşi: fixture'daki misafir mesajını Go struct'ına katı çözüp Encode doğrulamasından
// geçirir ve yeniden kodlanan JSON'un girdiyle aynı olduğunu döner (alan adları/biçim birebir).
func decodeGuest(raw []byte) ([]byte, error) {
	var m Outbound
	switch msgType(raw) {
	case "sdp.answer":
		m = &SdpAnswer{}
	case "ice":
		m = &Ice{}
	case "share.state":
		m = &ShareState{}
	case "session.end":
		m = &SessionEnd{}
	case "file.meta":
		m = &FileMeta{}
	case "control.state":
		m = &ControlState{}
	case "env.state":
		m = &EnvState{}
	case "monitor.denied":
		m = &MonitorDenied{}
	default:
		return nil, errors.New("misafir bu tipi gönderemez")
	}
	if err := decodeStrict(raw, m); err != nil {
		return nil, err
	}
	return Encode(m)
}

func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	xa, _ := json.Marshal(x)
	ya, _ := json.Marshal(y)
	return string(xa) == string(ya)
}

func TestAC119GuestOutboundMatchesContractsFixture(t *testing.T) {
	f := loadWS(t)
	for _, raw := range f.Valid["guest"] {
		out, err := decodeGuest(raw)
		if err != nil {
			t.Errorf("geçerli misafir mesajı reddedildi %s: %v", raw, err)
			continue
		}
		if !jsonEqual(t, raw, out) {
			t.Errorf("yeniden kodlama farklı:\n in  %s\n out %s", raw, out)
		}
	}
	for _, raw := range f.Invalid["guest"] {
		if _, err := decodeGuest(raw); err == nil {
			t.Errorf("geçersiz misafir mesajı kabul edildi: %s", raw)
		}
	}
}

func TestAC112ServerMessagesMatchContractsFixture(t *testing.T) {
	f := loadWS(t)
	seen := map[string]bool{}
	for _, raw := range f.Valid["server"] {
		m, err := ParseServer(raw)
		typ := msgType(raw)
		if slices.Contains(techOnlyTypes, typ) {
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
	for _, typ := range []string{"hello", "lobby.wait", "peer.joined", "session.ended", "error"} {
		if !seen[typ] {
			t.Errorf("fixture'da %s örneği bulunamadı", typ)
		}
	}
	// Teknisyen yönündeki sdp.offer/ice/ice.restart sunucu tarafından id'siz yeniden kurulup misafire iletilir.
	for _, raw := range f.Valid["tech"] {
		switch typ := msgType(raw); typ {
		case "sdp.offer", "ice", "ice.restart":
			var obj map[string]any
			_ = json.Unmarshal(raw, &obj)
			delete(obj, "id")
			b, _ := json.Marshal(obj)
			if _, err := ParseServer(b); err != nil {
				t.Errorf("iletilen %s reddedildi: %v", typ, err)
			}
		}
	}
}

func TestServerMessageStrictness(t *testing.T) {
	bad := []string{
		`{"t":"lobby.wait","expiresAt":"2026-11-11T12:05:00.000Z","x":1}`, // bilinmeyen alan
		`{"t":"lobby.wait","ExpiresAt":"2026-11-11T12:05:00.000Z"}`,       // harf duyarlı
		`{"t":"lobby.wait","expiresAt":"2026-11-11 12:05"}`,               // ISO değil
		`{"t":"session.ended","reason":"bye"}`,                            // enum
		`{"t":"session.ended"}`,                                           // eksik alan
		`{"t":"hello","role":"guest","sessionId":"x","peerPresent":true,"iceServers":[],"maxEndsAt":null}`,
		`{"t":"hello","role":"guest","sessionId":"01JC0000000000000000000000","peerPresent":true,"iceServers":[{"urls":["stun:a"],"extra":1}],"maxEndsAt":null}`,
		`{"t":"hello","role":"guest","sessionId":"01JC0000000000000000000000","peerPresent":true,"iceServers":[],"maxEndsAt":null,"caps":["admin"]}`,
		`{"t":"sdp.offer","id":"1","sdp":"v=0"}`, // sunucu id'yi atar
		`{"t":"control.grant"}`,                  // sözleşmede yok (izin yalnız istemcide)
		`[]`, `not json`,
	}
	for _, s := range bad {
		if _, err := ParseServer([]byte(s)); err == nil {
			t.Errorf("kabul edilmemeliydi: %s", s)
		}
	}
	ok := `{"t":"hello","role":"guest","sessionId":"01JC0000000000000000000000","peerPresent":true,"iceServers":[],"maxEndsAt":null}`
	if _, err := ParseServer([]byte(ok)); err != nil {
		t.Fatal(err)
	}
}

func TestEncodeRejectsInvalidOutbound(t *testing.T) {
	idx, badMon := 17, monitorIDMax+1
	for _, m := range []Outbound{
		SdpAnswer{T: "sdp.answer"},
		SdpAnswer{T: "sdp.offer", SDP: "v=0"},
		Ice{T: "ice", SdpMLineIndex: &idx},
		ShareState{T: "share.state", State: "paused"},
		ShareState{T: "share.state", State: "sharing", Monitors: make([]Monitor, monitorsMax+1)},
		ShareState{T: "share.state", State: "sharing", Monitors: []Monitor{{ID: 0, Name: "A", W: 0, H: 1}}},
		ShareState{T: "share.state", State: "sharing", ActiveMonitor: &badMon},
		FileMeta{T: "file.meta", Direction: "TO_TECH", FileName: "a", SizeBytes: 1, SHA256: strings.Repeat("A", 64), Result: "OK"},
		SessionEnd{T: "session.end", ID: strings.Repeat("x", 27)},
	} {
		if _, err := Encode(m); err == nil {
			t.Errorf("geçersiz mesaj kodlandı: %+v", m)
		}
	}
}

func TestAC14DialUsesSubprotocolNoOriginNoQuery(t *testing.T) {
	ticket := strings.Repeat("T", 43)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ws/guest" || r.URL.RawQuery != "" || r.Header.Get("Origin") != "" {
			t.Errorf("istek %s origin=%q", r.URL, r.Header.Get("Origin"))
		}
		var protos []string
		for _, v := range r.Header.Values("Sec-WebSocket-Protocol") {
			for _, p := range strings.Split(v, ",") {
				protos = append(protos, strings.TrimSpace(p))
			}
		}
		if !slices.Equal(protos, []string{"rs.v1", "rs.ticket." + ticket}) {
			t.Errorf("subprotocol %v", protos)
		}
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"rs.v1"}})
		if err != nil {
			return
		}
		ctx := r.Context()
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"t":"lobby.wait","expiresAt":"2026-11-11T12:05:00.000Z"}`))
		_, data, err := c.Read(ctx)
		if err != nil || string(data) != `{"t":"session.end"}` {
			t.Errorf("okunan %s %v", data, err)
		}
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"t":"peer.pending","guestId":"01JC0000000000000000000000","name":"x","guestKind":"AGENT","since":"2026-11-11T12:05:00.000Z"}`))
		_, _, _ = c.Read(ctx)
	}))
	defer srv.Close()
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	hc := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}}
	u, _ := url.Parse(srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := Dial(ctx, hc, u, Credential{Ticket: ticket}, nil)
	if err != nil {
		t.Fatal(err)
	}
	m, err := conn.Read(ctx)
	if err != nil || m.Type() != "lobby.wait" {
		t.Fatalf("lobby.wait beklenirdi: %v %v", m, err)
	}
	if err := conn.Send(ctx, SessionEnd{T: "session.end"}); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Read(ctx); !errors.Is(err, ErrNotForGuest) {
		t.Fatalf("teknisyen tipi reddedilmeli: %v", err)
	}
}

func TestAC109DialRejectsUntrustedCertAndBadCredential(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("doğrulanmamış sunucuya istek ulaşmamalı")
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	ctx := context.Background()
	if _, err := Dial(ctx, &http.Client{}, u, Credential{Ticket: strings.Repeat("T", 43)}, nil); err == nil {
		t.Fatal("güvenilmeyen sertifika reddedilmeli")
	}
	for _, c := range []Credential{{}, {Ticket: "a b"}, {Ticket: strings.Repeat("T", 43), Reconnect: strings.Repeat("R", 43)}, {Reconnect: "kisa"}} {
		if _, err := Dial(ctx, &http.Client{}, u, c, nil); err == nil {
			t.Errorf("geçersiz kimlik bilgisi kabul edildi: %+v", c)
		}
	}
}

func TestAC99P7ServerControlMessages(t *testing.T) {
	good := map[string]string{
		`{"t":"control.request"}`:                      "control.request",
		`{"t":"monitor.request","monitorId":2}`:        "monitor.request",
		`{"t":"control.revoke","reason":"permission"}`: "control.revoke",
		`{"t":"control.revoke","reason":"audit"}`:      "control.revoke",
		`{"t":"control.revoke","reason":"reconnect"}`:  "control.revoke",
		`{"t":"control.revoke","reason":"stale"}`:      "control.revoke",
		`{"t":"control.release"}`:                      "control.release",
		`{"t":"control.cancel"}`:                       "control.cancel",
		`{"t":"caps.update","caps":[]}`:                "caps.update",
		`{"t":"caps.update","caps":["file_transfer"]}`: "caps.update",
	}
	for raw, typ := range good {
		m, err := ParseServer([]byte(raw))
		if err != nil || m.Type() != typ {
			t.Errorf("%s: %v", raw, err)
		}
	}
	bad := []string{`{"t":"control.request","x":1}`, `{"t":"monitor.request","monitorId":1.5}`,
		`{"t":"monitor.request","monitorId":65}`, `{"t":"monitor.request"}`, `{"t":"control.revoke","reason":"x"}`,
		`{"t":"caps.update","caps":["admin"]}`, `{"t":"caps.update"}`, `{"t":"caps.update","caps":null}`,
		`{"t":"control.grant"}`, `{"t":"control.release","x":1}`, `{"t":"control.cancel","reason":"x"}`}
	for _, raw := range bad {
		if _, err := ParseServer([]byte(raw)); err == nil {
			t.Errorf("kabul edildi: %s", raw)
		}
	}
	for _, raw := range []string{`{"t":"control.state","state":"GRANTED","source":"UI"}`,
		`{"t":"env.state","elevatedForeground":true,"secureDesktop":false,"selfElevated":false}`, `{"t":"monitor.denied","monitorId":1}`} {
		if _, err := ParseServer([]byte(raw)); !errors.Is(err, ErrNotForGuest) {
			t.Errorf("%s misafire yönelik değil: %v", raw, err)
		}
	}
}

func TestAC111ControlStateEncode(t *testing.T) {
	for _, m := range []ControlState{{T: "control.state", State: "GRANTED", Source: "UI"},
		{T: "control.state", State: "VIEW", Source: "HOTKEY"}, {T: "control.state", State: "VIEW", Source: "SYSTEM"},
		{T: "control.state", State: "VIEW", Source: "DENIED"},
		{T: "control.state", State: "VIEW", Source: "OS_PERMISSION"},        // P28f AC-391
		{T: "control.state", State: "VIEW", Source: "WAYLAND_NO_CONTROL"}} { // P28g AC-399
		b, err := Encode(m)
		if err != nil {
			t.Fatalf("%+v: %v", m, err)
		}
		if out, err := decodeGuest(b); err != nil || !jsonEqual(t, b, out) {
			t.Fatalf("gidiş-dönüş: %s %v", b, err)
		}
	}
	for _, m := range []ControlState{{T: "control.state", State: "GRANTED", Source: "SYSTEM"},
		{T: "control.state", State: "GRANTED", Source: "OS_PERMISSION"},      // yalnız VIEW ile (mimari-p28f §4.2)
		{T: "control.state", State: "GRANTED", Source: "WAYLAND_NO_CONTROL"}, // yalnız VIEW ile (mimari-p28g §4.2)
		{T: "control.state", State: "OPEN", Source: "UI"}, {T: "control.state", State: "VIEW", Source: "X"},
		// S7-10 / §3: RECONNECT ve TECH yalnız sunucu üretir; misafir göndermez.
		{T: "control.state", State: "VIEW", Source: "RECONNECT"}, {T: "control.state", State: "VIEW", Source: "TECH"}} {
		if _, err := Encode(m); err == nil {
			t.Errorf("geçersiz control.state kodlandı: %+v", m)
		}
	}
	// K4: monitör reddi.
	if b, err := Encode(MonitorDenied{T: "monitor.denied", MonitorID: 2}); err != nil || string(b) != `{"t":"monitor.denied","monitorId":2}` {
		t.Fatalf("monitor.denied: %s %v", b, err)
	}
	for _, id := range []int{-1, 65} {
		if _, err := Encode(MonitorDenied{T: "monitor.denied", MonitorID: id}); err == nil {
			t.Errorf("monitorId %d kodlandı", id)
		}
	}
	// K8: selfElevated false iken de yazılır (strict şema zorunlu alan; omitempty olsaydı sunucu 1008 verirdi).
	b, err := Encode(EnvState{T: "env.state", SecureDesktop: true})
	if err != nil || string(b) != `{"t":"env.state","elevatedForeground":false,"secureDesktop":true,"selfElevated":false}` {
		t.Fatalf("env.state: %s %v", b, err)
	}
	if _, err := decodeGuest([]byte(`{"t":"env.state","elevatedForeground":false,"secureDesktop":false}`)); err == nil {
		t.Fatal("K8: selfElevated eksik env.state reddedilmeli")
	}
}

// AC-234: share.state reason/method sözleşmesi (contracts SHARE_FAIL_REASON_PATTERN, SHARE_METHODS); 0.10.x biçimi
// (alansız) geçerli kalır; teknisyen hello `share` anlık görüntüsü de aynı kurallarla.
func TestAC234ShareStateReasonMethod(t *testing.T) {
	ok := []ShareState{
		{T: "share.state", State: "stopped"},
		{T: "share.state", State: "stopped", Reason: "DXGI_UNSUPPORTED", Method: "DXGI"},
		{T: "share.state", State: "stopped", Reason: "D3D_DEVICE"},
		{T: "share.state", State: "stopped", Reason: "GDI_FAILED", Method: "GDI"},
		{T: "share.state", State: "stopped", Reason: "OTHER", Method: "WGC"},
		{T: "share.state", State: "stopped", Reason: strings.Repeat("A", 32)},
	}
	for _, m := range ok {
		if _, err := Encode(m); err != nil {
			t.Errorf("AC-234 geçerli reddedildi %+v: %v", m, err)
		}
	}
	bad := []ShareState{
		{T: "share.state", State: "stopped", Reason: "dxgi"},
		{T: "share.state", State: "stopped", Reason: "OTHER 0x80004005"},
		{T: "share.state", State: "stopped", Reason: strings.Repeat("A", 33)},
		{T: "share.state", State: "stopped", Method: "DXGI1"},
	}
	for _, m := range bad {
		if _, err := Encode(m); err == nil {
			t.Errorf("AC-234 geçersiz kabul edildi %+v", m)
		}
	}
	raw := `{"t":"hello","role":"tech","sessionId":"01JC0000000000000000000000","peerPresent":true,"iceServers":[],` +
		`"maxEndsAt":null,"share":{"state":"stopped","reason":"NO_H264_ENCODER","method":"DXGI"}}`
	if _, err := ParseServer([]byte(raw)); err != nil {
		t.Fatalf("hello.share reason/method: %v", err)
	}
	if _, err := ParseServer([]byte(strings.Replace(raw, `"DXGI"`, `"X"`, 1))); err == nil {
		t.Fatal("hello.share geçersiz method kabul edildi")
	}
}
