package servis

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type fakeHandler struct {
	mu       sync.Mutex
	connects []*Connect
	kills    []string
	features int
	recs     []bool
}

func (f *fakeHandler) Connect(m *Connect) {
	f.mu.Lock()
	f.connects = append(f.connects, m)
	f.mu.Unlock()
}
func (f *fakeHandler) Disconnect(*Disconnect) {}
func (f *fakeHandler) Kill(r string)          { f.mu.Lock(); f.kills = append(f.kills, r); f.mu.Unlock() }
func (f *fakeHandler) LocalEnabled() bool     { return true }
func (f *fakeHandler) Features()              { f.mu.Lock(); f.features++; f.mu.Unlock() }
func (f *fakeHandler) Intervene(*Intervene)   {}
func (f *fakeHandler) Rejoin(*Rejoin)         {}
func (f *fakeHandler) RecState(on bool)       { f.mu.Lock(); f.recs = append(f.recs, on); f.mu.Unlock() }
func (f *fakeHandler) count() (int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.connects), len(f.kills)
}

// fakeServer `/ws/device` eşi: hello → auth imzasını doğrular → ready → script.
type fakeServer struct {
	t      *testing.T
	pub    ed25519.PublicKey
	origin string
	script func(ctx context.Context, ws *websocket.Conn)
	authed chan Auth
	header chan http.Header
	// closeAtAuth sıfır değilse auth'tan hemen sonra (ready yerine) bu kodla kapatılır (4401/4403).
	closeAtAuth websocket.StatusCode
}

func (s *fakeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.header <- r.Header.Clone()
	if r.URL.Path != DevicePath || r.URL.RawQuery != "" {
		http.Error(w, "yol", http.StatusNotFound)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{DeviceSubprotocol}})
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()
	ctx := r.Context()
	var nb [32]byte
	_, _ = rand.Read(nb[:])
	nonce := base64.RawURLEncoding.EncodeToString(nb[:])
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"t":"device.hello","v":1,"nonce":"`+nonce+`"}`))
	_, data, err := ws.Read(ctx)
	if err != nil {
		return
	}
	var a Auth
	_ = json.Unmarshal(data, &a)
	sig, _ := base64.RawURLEncoding.DecodeString(a.Sig)
	if !ed25519.Verify(s.pub, AuthPayload(nonce, a.DeviceID, s.origin), sig) {
		_ = ws.Close(CloseAuth, "")
		return
	}
	if s.closeAtAuth != 0 {
		_ = ws.Close(s.closeAtAuth, "")
		return
	}
	s.authed <- a
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"t":"device.ready","tenantName":"Nokta","customerName":"Örnek"}`))
	s.script(ctx, ws)
}

func startDevice(t *testing.T, script func(context.Context, *websocket.Conn)) (*DeviceClient, *fakeServer, *fakeHandler, *memEvents) {
	t.Helper()
	pub, priv, _ := GenerateKey()
	fs := &fakeServer{t: t, pub: pub, script: script, authed: make(chan Auth, 4), header: make(chan http.Header, 8)}
	srv := httptest.NewTLSServer(fs)
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	fs.origin = Origin(u)
	h, ev := &fakeHandler{}, &memEvents{}
	id := Identity{DeviceID: "01JD0000000000000000000001", Key: priv, Origin: fs.origin, Version: "0.13.0",
		SHA256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", OSVersion: "Windows 10.0.22631"}
	c := NewDeviceClient(srv.Client(), u, id, h, ev)
	c.sleep = func(ctx context.Context, _ time.Duration) bool { return ctx.Err() == nil }
	return c, fs, h, ev
}

const connectJSON = `{"t":"connect","sessionId":"01JD0000000000000000000002","ticket":"OSTHxpIxRYOEvsy1t7jssmOfVM9-lMgf5dSNuly4uso",` +
	`"techName":"Mehmet","tenantName":"Nokta","techIp":"203.0.113.7","expiresInSec":60,"indicatorText":"Uzaktan bağlantı: Mehmet — Nokta"}`

func TestAC273DeviceAuthConnectAndRevoke(t *testing.T) {
	c, fs, h, ev := startDevice(t, func(ctx context.Context, ws *websocket.Conn) {
		_ = ws.Write(ctx, websocket.MessageText, []byte(connectJSON))
		_, data, err := ws.Read(ctx) // cihazdan device.state
		if err != nil || string(data) != `{"t":"device.state","localEnabled":false}` {
			return
		}
		_ = ws.Write(ctx, websocket.MessageText, []byte(`{"t":"revoked"}`))
		_, _, _ = ws.Read(ctx)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go func() {
		for c.State() != StateOnline && ctx.Err() == nil {
			time.Sleep(5 * time.Millisecond)
		}
		c.Send(&State{LocalEnabled: false})
	}()
	if err := c.Run(ctx); !errors.Is(err, ErrRevoked) {
		t.Fatalf("Run = %v", err)
	}
	a := <-fs.authed
	if !a.LocalEnabled || a.DeviceID == "" || a.Version != "0.13.0" {
		t.Fatalf("auth = %+v", a)
	}
	hdr := <-fs.header
	if hdr.Get("Origin") != "" {
		t.Fatal("Origin başlığı gönderildi")
	}
	if n, k := h.count(); n != 1 || k != 1 || h.kills[0] != KillRevoked {
		t.Fatalf("connect=%d kill=%v", n, h.kills)
	}
	if c.State() != StateRevoked || ev.ids()[len(ev.ids())-1] != EvRevoked {
		t.Fatalf("durum %s, olaylar %v", c.State(), ev.ids())
	}
}

func TestAC297GateCloseRetriesAndLogsOnce(t *testing.T) {
	c, fs, _, ev := startDevice(t, func(context.Context, *websocket.Conn) {})
	fs.closeAtAuth = CloseGate
	ctx, cancel := context.WithCancel(context.Background())
	attempts := 0
	c.sleep = func(context.Context, time.Duration) bool {
		attempts++
		if attempts >= 3 {
			cancel()
			return false
		}
		return true
	}
	_ = c.Run(ctx)
	rej := 0
	for _, id := range ev.ids() {
		if id == EvRejected {
			rej++
		}
	}
	if rej != 1 {
		t.Fatalf("1004 sayısı %d (durum değişiminde bir kez)", rej)
	}
	if len(fs.header) < 3 || c.State() != StateOffline {
		t.Fatalf("yeniden denenmedi: %d, durum %s", len(fs.header), c.State())
	}
}

func TestDeviceProtocolViolationCloses(t *testing.T) {
	c, _, _, _ := startDevice(t, func(ctx context.Context, ws *websocket.Conn) {
		_ = ws.Write(ctx, websocket.MessageText, []byte(`{"t":"device.enable"}`))
		_, _, _ = ws.Read(ctx)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ready, err := c.session(ctx)
	if !ready || !errors.Is(err, errSchema) {
		t.Fatalf("ready=%v err=%v", ready, err)
	}
}

func TestBackoffJitterBounds(t *testing.T) {
	for i := 0; i < 1000; i++ {
		d := jitter(10 * time.Second)
		if d < 8*time.Second || d > 12*time.Second {
			t.Fatalf("titreşim sınır dışı: %v", d)
		}
	}
}

// AC-435 / K-P28u-8: belirteç alt protokol listesinde; device.features öncesi yeni C→S mesajı yazılmaz, sonra yazılır.
func TestAC435NewMessagesOnlyAfterFeatures(t *testing.T) {
	got := make(chan string, 4)
	c, fs, h, _ := startDevice(t, func(ctx context.Context, ws *websocket.Conn) {
		_, first, err := ws.Read(ctx)
		if err != nil {
			return
		}
		got <- string(first)
		_ = ws.Write(ctx, websocket.MessageText, []byte(`{"t":"device.features","caps":["consent1"]}`))
		_, second, err := ws.Read(ctx)
		if err == nil {
			got <- string(second)
		}
		_, _, _ = ws.Read(ctx)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx) }()
	for c.State() != StateOnline && ctx.Err() == nil {
		time.Sleep(5 * time.Millisecond)
	}
	c.Send(&DeviceUser{State: UserActive}) // features yok: düşürülmeli
	c.Send(&State{LocalEnabled: true})
	if m := <-got; m != `{"t":"device.state","localEnabled":true}` {
		t.Fatalf("features öncesi yazılan: %s", m)
	}
	for ctx.Err() == nil {
		h.mu.Lock()
		n := h.features
		h.mu.Unlock()
		if n == 1 && c.Consent1() {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	c.Send(&DeviceUser{State: UserLocked})
	if m := <-got; m != `{"t":"device.user","state":"locked"}` {
		t.Fatalf("features sonrası: %s", m)
	}
	hdr := <-fs.header
	if p := hdr.Get("Sec-WebSocket-Protocol"); !strings.Contains(p, DeviceCapConsent) || !strings.Contains(p, DeviceSubprotocol) {
		t.Fatalf("alt protokol listesi %q", p)
	}
}

func TestAC435InterveneBeforeFeaturesIsViolation(t *testing.T) {
	if _, err := ParseServer([]byte(`{"t":"intervene","sessionId":"01JD0000000000000000000002","id":"01JD0000000000000000000009","cmd":"lock"}`)); err != nil {
		t.Fatalf("ayrıştırma: %v", err)
	}
	done := make(chan struct{})
	c, _, _, _ := startDevice(t, func(ctx context.Context, ws *websocket.Conn) {
		_ = ws.Write(ctx, websocket.MessageText, []byte(`{"t":"intervene","sessionId":"01JD0000000000000000000002","id":"01JD0000000000000000000009","cmd":"lock"}`))
		_, _, err := ws.Read(ctx)
		if websocket.CloseStatus(err) == websocket.StatusPolicyViolation {
			close(done)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx) }()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("features öncesi intervene 1008 ile kapatılmadı")
	}
}
