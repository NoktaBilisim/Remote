package flow

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/coder/websocket"

	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// AC-234: her neden kodu share.state alanlarına birebir çevrilir; HRESULT/işlem adı gitmez, tipsiz hata OTHER.
func TestAC234ShareFailureFields(t *testing.T) {
	cases := []struct {
		err            error
		reason, method string
	}{
		{&capture.Error{Reason: capture.ReasonDXGIUnsupported, Op: "DuplicateOutput", HR: 0x887A0004}, "DXGI_UNSUPPORTED", "DXGI"},
		{&capture.Error{Reason: capture.ReasonDXGIAccessDenied}, "DXGI_ACCESS_DENIED", "DXGI"},
		{&capture.Error{Reason: capture.ReasonDXGINotAvailable}, "DXGI_NOT_AVAILABLE", "DXGI"},
		{&capture.Error{Reason: capture.ReasonD3DDevice}, "D3D_DEVICE", "DXGI"},
		{&capture.Error{Reason: capture.ReasonFirstFrameTimeout}, "FIRST_FRAME_TIMEOUT", "DXGI"},
		{&capture.Error{Reason: capture.ReasonGDI, Op: "BitBlt"}, "GDI_FAILED", "GDI"},
		{&capture.Error{Reason: capture.ReasonNoOutput}, "NO_OUTPUT", ""},
		{&capture.Error{Reason: capture.ReasonMFStartup}, "MF_STARTUP", ""},
		{&capture.Error{Reason: capture.ReasonNoH264Encoder}, "NO_H264_ENCODER", ""},
		{&capture.Error{Reason: capture.ReasonEncoderConfig}, "ENCODER_CONFIG", ""},
		{&capture.Error{Reason: capture.ReasonEncodeFailed, Method: capture.MethodGDI}, "ENCODE_FAILED", "GDI"},
		{&capture.Error{Reason: capture.ReasonEncodeFailed, Method: capture.MethodDXGI1}, "ENCODE_FAILED", "DXGI"},
		{&capture.Error{Reason: capture.ReasonOther, Op: "CoInitializeEx", HR: 0x80004005}, "OTHER", ""},
		{errors.New(`C:\Users\ahmet\x.dll`), "OTHER", ""},
		{nil, "", ""},
	}
	for _, c := range cases {
		r, m := shareFailure(c.err)
		if r != c.reason || m != c.method {
			t.Errorf("AC-234 %v: (%q,%q), beklenen (%q,%q)", c.err, r, m, c.reason, c.method)
		}
		b, err := signal.Encode(signal.ShareState{T: "share.state", State: "stopped", Reason: r, Method: m})
		if err != nil {
			t.Errorf("AC-234 %v: sözleşme dışı: %v", c.err, err)
			continue
		}
		var got map[string]any
		_ = json.Unmarshal(b, &got)
		if _, has := got["reason"]; has != (r != "") {
			t.Errorf("AC-234 %v: reason alanı %s", c.err, b)
		}
		if _, has := got["method"]; has != (m != "") {
			t.Errorf("AC-234 %v: method alanı %s", c.err, b)
		}
	}
}

// AC-234: kaynak açılamazsa share.state {stopped, reason, method}; paylaşım alanları (monitors) gitmez.
func TestAC234StoppedReasonOnOpenFailure(t *testing.T) {
	h := newHarness(t)
	h.deps.Capture = func(int) (rtc.Source, error) {
		return nil, &capture.Error{Reason: capture.ReasonDXGIUnsupported, Op: "DuplicateOutput", HR: 0x887A0004}
	}
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, h.peers)
	sh := recv(t, c.sent).(signal.ShareState)
	if sh.State != "stopped" || sh.Reason != "DXGI_UNSUPPORTED" || sh.Method != "DXGI" || sh.Monitors != nil {
		t.Fatalf("AC-234 share.state: %+v", sh)
	}
	h.events <- Event{Kind: EvEnd}
	recv(t, c.sent)
	recv(t, out)
}

// AC-234: aynı neden (aynı soket) 5 sn içinde tekrar gönderilmez, sonra gider; farklı neden ve durum değişimi hemen.
func TestAC234StoppedRepeatLimit(t *testing.T) {
	clk := &clock{t: time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)}
	c := newConn()
	s := &session{d: withDefaults(Deps{Now: clk.now}), conn: c}
	ctx := context.Background()
	stop := signal.ShareState{T: "share.state", State: "stopped", Reason: "DXGI_UNSUPPORTED", Method: "DXGI"}
	s.sendShareMsg(ctx, stop)
	recv(t, c.sent)
	clk.add(4 * time.Second)
	s.sendShareMsg(ctx, stop)
	noMore(t, c.sent)
	clk.add(2 * time.Second)
	s.sendShareMsg(ctx, stop)
	if got := recv(t, c.sent).(signal.ShareState); got.Reason != "DXGI_UNSUPPORTED" {
		t.Fatalf("5 sn sonra yeniden gitmeli: %+v", got)
	}
	other := signal.ShareState{T: "share.state", State: "stopped", Reason: "GDI_FAILED", Method: "GDI"}
	s.sendShareMsg(ctx, other)
	if got := recv(t, c.sent).(signal.ShareState); got.Reason != "GDI_FAILED" {
		t.Fatalf("farklı neden hemen gitmeli: %+v", got)
	}
	s.sendShareMsg(ctx, signal.ShareState{T: "share.state", State: "sharing"})
	recv(t, c.sent)
	s.sendShareMsg(ctx, other)
	if got := recv(t, c.sent).(signal.ShareState); got.State != "stopped" {
		t.Fatalf("durum değişimi her zaman gitmeli: %+v", got)
	}
}

// AC-234: yeniden bağlanmada (yeni soket) aynı neden 5 sn dolmadan da yeniden gönderilir (sunucu durumu yeni sokette alır).
func TestAC234StoppedResentAfterReconnect(t *testing.T) {
	h := newHarness(t)
	clk := &clock{t: time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)}
	h.deps.Now = clk.now
	h.deps.Capture = func(int) (rtc.Source, error) {
		return nil, &capture.Error{Reason: capture.ReasonGDI, Op: "BitBlt"}
	}
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, h.peers)
	if sh := recv(t, c.sent).(signal.ShareState); sh.Reason != "GDI_FAILED" || sh.Method != "GDI" {
		t.Fatalf("%+v", sh)
	}
	c.toClient <- errors.New("ağ koptu")
	c2 := recv(t, h.conns)
	c2.toClient <- hello(token)
	recv(t, h.peers)
	if sh := recv(t, c2.sent).(signal.ShareState); sh.State != "stopped" || sh.Reason != "GDI_FAILED" {
		t.Fatalf("yeni sokette yeniden gönderilmeli: %+v", sh)
	}
	h.events <- Event{Kind: EvEnd}
	recv(t, c2.sent)
	recv(t, out)
}

// AC-234 (I1 kabul): sahte sinyal sunucusu — yayında kalıcı hata anından share.state'in sunucuya ulaşması ≤ 1 sn;
// gerçek signal.Dial/Conn (TLS + rs.v1) ve sözleşme doğrulaması ile.
func TestAC234StoppedReachesFakeServerWithin1s(t *testing.T) {
	type rx struct {
		at  time.Time
		raw []byte
	}
	got := make(chan rx, 8)
	helloJSON := `{"t":"hello","role":"guest","sessionId":"01JC0000000000000000000000","peerPresent":true,` +
		`"iceServers":[],"maxEndsAt":null,"reconnectToken":"` + token + `"}`
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{signal.Subprotocol}})
		if err != nil {
			return
		}
		ctx := r.Context()
		if c.Write(ctx, websocket.MessageText, []byte(helloJSON)) != nil {
			return
		}
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				return
			}
			got <- rx{at: time.Now(), raw: data}
		}
	}))
	defer srv.Close()
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	hc := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}}
	u, _ := url.Parse(srv.URL)

	h := newHarness(t)
	failAt := make(chan time.Time, 1)
	release := make(chan struct{})
	h.deps.Dial = func(ctx context.Context, cred signal.Credential) (Conn, error) {
		return signal.Dial(ctx, hc, u, cred, nil)
	}
	h.media.stream = timedFail(release, failAt)
	h.deps.Monitors = func() ([]signal.Monitor, error) {
		return []signal.Monitor{{ID: 1, Name: "Ekran 1", W: 1920, H: 1080, Primary: true}}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out := make(chan Outcome, 1)
	go func() {
		out <- RunTicket(ctx, h.deps, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "Ali", "")
	}()
	var sh map[string]any
	for { // env.state (K8) önce gelebilir
		first := recv(t, got)
		if json.Unmarshal(first.raw, &sh) == nil && sh["t"] == "share.state" {
			break
		}
	}
	if sh["state"] != "sharing" {
		t.Fatalf("önce sharing: %v", sh)
	}
	close(release)
	at := recv(t, failAt)
	var stopped rx
	for {
		stopped = recv(t, got)
		if json.Unmarshal(stopped.raw, &sh) == nil && sh["t"] == "share.state" {
			break
		}
	}
	if sh["state"] != "stopped" || sh["reason"] != "ENCODE_FAILED" || sh["method"] != "GDI" {
		t.Fatalf("AC-234: %s", stopped.raw)
	}
	if d := stopped.at.Sub(at); d > time.Second {
		t.Fatalf("AC-234: hata → sunucu %v (> 1 sn)", d)
	}
	cancel()
	recv(t, out)
}

// timedFail yayını release kapanınca tipli kodlama hatasıyla bitirir ve hata anını bildirir.
func timedFail(release <-chan struct{}, failAt chan<- time.Time) func(context.Context, rtc.Source) error {
	return func(ctx context.Context, _ rtc.Source) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
		}
		failAt <- time.Now()
		return &capture.Error{Reason: capture.ReasonEncodeFailed, Op: "Encode", Method: capture.MethodGDI}
	}
}

// AC-250: kayıt isteği → soket kopuşu → yeniden bağlanma + yeni teklif → tam 1 yeni istek.
func TestAC250DisconnectResetsBindingPending(t *testing.T) {
	h := newHarness(t)
	b := &fakeBinding{prev: prevKey}
	h.deps.Binding = b
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, c.sent) // share.state
	c.toClient <- signal.BindingOffer{T: "binding.offer"}
	if _, ok := recv(t, c.sent).(signal.BindingRequest); !ok {
		t.Fatal("ilk istek")
	}
	c.toClient <- errors.New("ağ koptu")
	c2 := recv(t, h.conns)
	c2.toClient <- hello(token)
	recv(t, c2.sent) // share.state
	c2.toClient <- signal.BindingOffer{T: "binding.offer", Multi: &multiTrue}
	if req, ok := recv(t, c2.sent).(signal.BindingRequest); !ok || len(req.PreviousKeys) != 1 || req.PreviousKeys[0] != prevKey {
		t.Fatalf("AC-250: kopuştan sonra yeni teklife istek gitmeli: %#v", req)
	}
	c2.toClient <- signal.BindingOffer{T: "binding.offer"}
	noMore(t, c2.sent) // yanıt beklenirken ikinci istek yok (tam 1)
	c2.toClient <- issued()
	c2.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	recv(t, out)
	if b.count() != 1 {
		t.Fatalf("AC-250: kayıt %d kez yazıldı", b.count())
	}
}

// AC-239: kabul kodlu talep → lobi ekranı kodu gösterir (hello'dan önce); kodsuz talep eski akış ("bağlanıyor").
func TestAC239RunTicketAdmitCodeShowsLobby(t *testing.T) {
	for _, c := range []struct{ code, want string }{
		{"4821", "lobby:4821:Ali"},
		{"", "connecting:Ali"},
	} {
		h := newHarness(t)
		out := make(chan Outcome, 1)
		go func() {
			out <- RunTicket(context.Background(), h.deps, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "Ali", c.code)
		}()
		conn := recv(t, h.conns)
		expectCall(t, h.ui, c.want)
		if c.code != "" {
			conn.toClient <- signal.LobbyWait{T: "lobby.wait", ExpiresAt: "2026-11-15T10:05:00.000Z"}
		}
		conn.toClient <- hello(token)
		expectCall(t, h.ui, "active:Ali:Ekran 2")
		conn.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
		recv(t, out)
	}
}
