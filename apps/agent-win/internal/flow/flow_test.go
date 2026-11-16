package flow

import (
	"context"
	"encoding/json"
	"errors"
	"image"
	"net/url"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

// --- sahteler -----------------------------------------------------------------------------------------------

type fakeAPI struct {
	mu       sync.Mutex
	resolves []string
	resolveE []error
	joins    []api.JoinRequest
	joinE    []error
	logoURL  string
	abuse    *string
	rec      *api.RecordingOffer // P28e
}

func (a *fakeAPI) Resolve(_ context.Context, code string) (*api.ResolveResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.resolves = append(a.resolves, code)
	if len(a.resolveE) > 0 {
		e := a.resolveE[0]
		a.resolveE = a.resolveE[1:]
		if e != nil {
			return nil, e
		}
	}
	r := &api.ResolveResult{TechVerifyCode: "4821", JoinNonce: "nonce"}
	r.Technician.Name = "Ali Teknisyen"
	r.Tenant.Name = "Acme"
	r.ConsentText = api.ConsentText{ID: "ct1", Version: 3, Body: "KVKK metni", Recording: a.rec}
	r.Tenant.LogoURL = a.logoURL
	r.AbuseEmail = a.abuse
	return r, nil
}

func (a *fakeAPI) Join(_ context.Context, req api.JoinRequest) (*api.JoinResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.joins = append(a.joins, req)
	if len(a.joinE) > 0 {
		e := a.joinE[0]
		a.joinE = a.joinE[1:]
		if e != nil {
			return nil, e
		}
	}
	return &api.JoinResult{WsTicket: "ticket-abcdefghijklmnop", AdmitCode: "1234", TechnicianName: "Ali Teknisyen"}, nil
}

type fakeConn struct {
	toClient chan any
	sent     chan signal.Outbound
	env      chan signal.EnvState
	closed   chan struct{}
	once     sync.Once
}

func newConn() *fakeConn {
	return &fakeConn{toClient: make(chan any, 16), sent: make(chan signal.Outbound, 32), env: make(chan signal.EnvState, 32), closed: make(chan struct{})}
}

func (c *fakeConn) Read(ctx context.Context) (signal.Inbound, error) {
	select {
	case v := <-c.toClient:
		if err, ok := v.(error); ok {
			return nil, err
		}
		return v.(signal.Inbound), nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.closed:
		return nil, errors.New("kapalı")
	}
}

func (c *fakeConn) Send(_ context.Context, m signal.Outbound) error {
	if _, err := signal.Encode(m); err != nil {
		return err
	}
	if e, ok := m.(signal.EnvState); ok { // K8: her hello'dan sonra gider; ayrı kanalda denetlenir
		c.env <- e
		return nil
	}
	c.sent <- m
	return nil
}

func (c *fakeConn) Close() error { c.once.Do(func() { close(c.closed) }); return nil }

type fakePeer struct {
	mu     sync.Mutex
	caps   []string
	h      rtc.Handlers
	offers chan string
	ctl    chan []byte
	live   chan bool // P28e: nil değilse Stream başlangıç/bitişi bildirilir
}

func (p *fakePeer) HandleOffer(sdp string) (signal.SdpAnswer, error) {
	p.offers <- sdp
	return signal.SdpAnswer{T: "sdp.answer", SDP: "answer-for-" + sdp}, nil
}
func (p *fakePeer) AddRemoteICE(signal.RemoteIce) error    { return nil }
func (p *fakePeer) SetICEServers([]signal.IceServer) error { return nil }
func (p *fakePeer) SendCtl(b []byte) error                 { p.ctl <- b; return nil }
func (p *fakePeer) SetCaps(c []string) {
	p.mu.Lock()
	p.caps = append([]string(nil), c...)
	p.mu.Unlock()
}
func (p *fakePeer) Stream(ctx context.Context, _ rtc.Source) error {
	if p.live != nil {
		p.live <- true
		defer func() { p.live <- false }()
	}
	<-ctx.Done()
	return ctx.Err()
}
func (p *fakePeer) Close() error { return nil }

type fakeSrc struct{}

func (fakeSrc) NextFrame(ctx context.Context) (rtc.Frame, error) {
	<-ctx.Done()
	return rtc.Frame{}, ctx.Err()
}
func (fakeSrc) Close() error { return nil }

type fakeUI struct {
	calls    chan string
	codes    []string
	welcome  []bool
	monitor  int
	window   uintptr
	welcomes []Welcome
	mu       sync.Mutex
}

func (u *fakeUI) log(s string) { u.calls <- s }

func (u *fakeUI) AskCode(_ context.Context, notice string) (string, bool) {
	u.log("askcode:" + notice)
	u.mu.Lock()
	defer u.mu.Unlock()
	if len(u.codes) == 0 {
		return "", false
	}
	c := u.codes[0]
	u.codes = u.codes[1:]
	return c, true
}

func (u *fakeUI) Welcome(_ context.Context, w Welcome) (string, bool) {
	u.mu.Lock()
	u.welcomes = append(u.welcomes, w)
	ok := true
	if len(u.welcome) > 0 {
		ok = u.welcome[0]
		u.welcome = u.welcome[1:]
	}
	u.mu.Unlock()
	u.log("welcome")
	return "Ayşe Yılmaz", ok
}

func (u *fakeUI) Lobby(code, tech string) { u.log("lobby:" + code + ":" + tech) }
func (u *fakeUI) Connecting(tech string)  { u.log("connecting:" + tech) }
func (u *fakeUI) ChooseShare(_ context.Context, m []signal.Monitor, def int, windows bool) (ShareChoice, bool) {
	if windows {
		u.log("choose:windows")
	} else {
		u.log("choose")
	}
	return ShareChoice{Monitor: u.monitor, Window: u.window}, true
}
func (u *fakeUI) Active(tech string, m signal.Monitor) { u.log("active:" + tech + ":" + m.Name) }
func (u *fakeUI) Status(msg string)                    { u.log("status:" + msg) }
func (u *fakeUI) Chat(text string)                     { u.log("chat:" + text) }
func (u *fakeUI) Annot(m dc.Ctl)                       { u.log("annot:" + m.T) }
func (u *fakeUI) FileOffer(p transfer.Prompt)          { u.log("fileoffer:" + p.Name) }
func (u *fakeUI) FileOfferWithdrawn(string)            { u.log("withdrawn") }
func (u *fakeUI) FileProgress(int64, int64)            {}
func (u *fakeUI) FileResult(r transfer.Result)         { u.log("fileresult:" + r.Status) }
func (u *fakeUI) Ended(m Message)                      { u.log("ended:" + m.Title) }
func (u *fakeUI) ControlRequest(p ControlPrompt)       { u.log("ctlreq:" + p.TechName + ":" + p.Hotkey) }
func (u *fakeUI) MonitorRequest(m signal.Monitor)      { u.log("monreq:" + m.Name) }
func (u *fakeUI) ControlPromptClosed()                 { u.log("promptclosed") }
func (u *fakeUI) MonitorPromptClosed()                 { u.log("monpromptclosed") }
func (u *fakeUI) MonitorChanged(m signal.Monitor)      { u.log("monchanged:" + m.Name) }
func (u *fakeUI) ControlState(on bool, hk string) {
	if on {
		u.log("control:on:" + hk)
	} else {
		u.log("control:off")
	}
}

type harness struct {
	api    *fakeAPI
	ui     *fakeUI
	conns  chan *fakeConn
	creds  chan signal.Credential
	peers  chan *fakePeer
	events chan Event
	deps   Deps
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		api:    &fakeAPI{},
		ui:     &fakeUI{calls: make(chan string, 64), monitor: 2},
		conns:  make(chan *fakeConn, 4),
		creds:  make(chan signal.Credential, 4),
		peers:  make(chan *fakePeer, 4),
		events: make(chan Event, 4),
	}
	h.deps = Deps{
		Host: "destek.example:4450", Version: "1.0.0", Fingerprint: "abcd1234",
		API: h.api,
		Dial: func(_ context.Context, cred signal.Credential) (Conn, error) {
			h.creds <- cred
			c := newConn()
			h.conns <- c
			return c, nil
		},
		NewPeer: func(_ []signal.IceServer, _ []string, hd rtc.Handlers) (Peer, error) {
			p := &fakePeer{h: hd, offers: make(chan string, 4), ctl: make(chan []byte, 4)}
			h.peers <- p
			return p, nil
		},
		Monitors: func() ([]signal.Monitor, error) {
			return []signal.Monitor{{ID: 1, Name: "Ekran 1", W: 1920, H: 1080, Primary: true},
				{ID: 2, Name: "Ekran 2", W: 1280, H: 1024}}, nil
		},
		Capture:        func(int) (rtc.Source, error) { return fakeSrc{}, nil },
		DownloadDir:    func() (string, error) { return t.TempDir(), nil },
		MOTW:           func(string) error { return nil },
		UI:             h.ui,
		Events:         h.events,
		ReconnectEvery: 10 * time.Millisecond,
	}
	return h
}

func recv[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(5 * time.Second):
		t.Fatal("zaman aşımı")
	}
	var z T
	return z
}

// expectCall sıradaki çağrılar arasında want'ı arar (aradaki farklı çağrılar atlanır; sıra korunur).
func expectCall(t *testing.T, u *fakeUI, want string) {
	t.Helper()
	for {
		if recv(t, u.calls) == want {
			return
		}
	}
}

func start(h *harness, code string) chan Outcome {
	out := make(chan Outcome, 1)
	go func() { out <- Run(context.Background(), h.deps, code) }()
	return out
}

func hello(token string) signal.Hello {
	return signal.Hello{T: "hello", Role: "guest", SessionID: "01JC0000000000000000000000", PeerPresent: true,
		IceServers: []signal.IceServer{}, Caps: []string{"file_transfer"}, ReconnectToken: token}
}

const token = "rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr"

// --- testler ------------------------------------------------------------------------------------------------

func TestAC97ManualCodeAfterInvalidAndNotFound(t *testing.T) {
	h := newHarness(t)
	h.ui.codes = []string{"12", "1234 5678", "8765-4321"}
	h.ui.welcome = []bool{false}
	h.api.resolveE = []error{&api.Error{Status: 404, Code: "NOT_FOUND"}}
	out := start(h, "")
	expectCall(t, h.ui, "askcode:")
	expectCall(t, h.ui, "askcode:Kod 8 rakamdan oluşmalıdır.")
	expectCall(t, h.ui, "askcode:"+msgNotFound.Title+". "+msgNotFound.Body)
	expectCall(t, h.ui, "welcome")
	if o := recv(t, out); o.Message != (Message{}) {
		t.Fatalf("pencere kapatıldı → son ekran yok: %+v", o)
	}
	if got := h.api.resolves; len(got) != 2 || got[0] != "12345678" || got[1] != "87654321" {
		t.Fatalf("resolve kodları: %v", got)
	}
}

func TestAC97ExpiredAndConsumedShowFinalMessage(t *testing.T) {
	for code, want := range map[string]Message{"SESSION_EXPIRED": msgExpired, "SESSION_CONSUMED": msgConsumed} {
		h := newHarness(t)
		h.api.resolveE = []error{&api.Error{Status: 410, Code: code}}
		if o := recv(t, start(h, "12345678")); o.Message != want {
			t.Fatalf("%s: %+v", code, o)
		}
	}
}

func TestClassifyTable(t *testing.T) {
	cases := []struct {
		name string
		err  error
		msg  Message
		out  apiOutcome
	}{
		{"tls", &api.Error{Err: errors.New("x509"), TLS: true}, msgTLS, outFinal},
		{"ağ", &api.Error{Err: errors.New("dial")}, msgNetwork, outRetryCode},
		{"404", &api.Error{Status: 404, Code: "NOT_FOUND"}, msgNotFound, outRetryCode},
		{"400", &api.Error{Status: 400, Code: "VALIDATION"}, msgNotFound, outRetryCode},
		{"410", &api.Error{Status: 410, Code: "SESSION_EXPIRED"}, msgExpired, outFinal},
		{"tüketilmiş", &api.Error{Status: 410, Code: "SESSION_CONSUMED"}, msgConsumed, outFinal},
		{"iptal", &api.Error{Status: 410, Code: "SESSION_CANCELLED"}, msgCancelled, outFinal},
		{"lobi", &api.Error{Status: 409, Code: "LOBBY_FULL"}, msgLobbyFull, outFinal},
		{"403", &api.Error{Status: 403, Code: "FORBIDDEN"}, msgForbidden, outFinal},
		{"429", &api.Error{Status: 429, Code: "RATE_LIMITED"}, msgRate, outFinal},
		{"500", &api.Error{Status: 500, Code: "INTERNAL"}, msgError, outRetryCode},
		{"api dışı", errors.New("x"), msgError, outRetryCode},
	}
	for _, c := range cases {
		m, o := classify(c.err)
		if m != c.msg || o != c.out {
			t.Errorf("%s: %+v %v", c.name, m, o)
		}
	}
	if _, o := classify(&api.Error{Status: 400, Code: "NONCE_INVALID"}); o != outRetryNonce {
		t.Errorf("nonce: %v", o)
	}
}

func TestAC109TLSErrorShowsFinalNotCodeEntry(t *testing.T) {
	h := newHarness(t)
	h.api.resolveE = []error{&api.Error{Err: errors.New("x509: unknown authority"), TLS: true}}
	if o := recv(t, start(h, "12345678")); o.Message != msgTLS {
		t.Fatalf("TLS → son ekran beklenirdi: %+v", o)
	}
	for {
		select {
		case c := <-h.ui.calls:
			if len(c) >= 7 && c[:7] == "askcode" {
				t.Fatalf("kod giriş ekranına düşmemeli: %v", c)
			}
		default:
			if n := len(h.api.resolves); n != 1 {
				t.Fatalf("TLS hatası yeniden çözülmemeli: %d", n)
			}
			return
		}
	}
}

func TestAC98NoJoinWithoutConsent(t *testing.T) {
	h := newHarness(t)
	h.ui.welcome = []bool{false}
	out := start(h, "12345678")
	expectCall(t, h.ui, "welcome")
	recv(t, out)
	if len(h.api.joins) != 0 {
		t.Fatal("onaysız join gönderildi")
	}
	w := h.ui.welcomes[0]
	if w.Host != "destek.example:4450" || w.Fingerprint != "abcd1234" || w.TechVerifyCode != "4821" || w.ConsentBody == "" {
		t.Fatalf("karşılama verisi eksik: %+v", w)
	}
}

// QA-P6-1: karşılamadaki firma logosu yalnız gömülü sunucu kökeninden; başka kökende veya indirme hatasında
// Welcome.Logo nil kalır (arayüz sistem logosunu gösterir) ve karşılama yine açılır.
func TestAC98WelcomeLogoOnlyFromServerHost(t *testing.T) {
	base, _ := url.Parse("https://destek.example:4450")
	client := api.New(base, "1.0.0")
	logo := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	cases := []struct {
		raw    string
		want   bool
		called bool
	}{
		{"/api/v1/public/files/logo/t1/a.png", true, true},
		{"https://destek.example:4450/api/v1/public/files/logo/t1/a.png", true, true},
		{"https://evil.example/logo.png", false, true},
		{"//evil.example/logo.png", false, true},
		{"", false, false},
	}
	for _, c := range cases {
		h := newHarness(t)
		h.api.logoURL = c.raw
		h.ui.welcome = []bool{false}
		var fetched []string
		h.deps.Logo = func(_ context.Context, raw string) (image.Image, error) {
			fetched = append(fetched, raw)
			u, err := client.LogoURL(raw) // api.Client.Logo ile aynı köken kuralı (ağ yok)
			if err != nil {
				return nil, err
			}
			if u.Host != "destek.example:4450" {
				t.Errorf("%q başka hosta gidiyor: %s", c.raw, u)
			}
			return logo, nil
		}
		recv(t, start(h, "12345678"))
		w := h.ui.welcomes[0]
		if (w.Logo != nil) != c.want || (len(fetched) == 1) != c.called {
			t.Errorf("%q: logo=%v çağrı=%v", c.raw, w.Logo != nil, fetched)
		}
	}
}

func TestAC98WelcomeLogoFetchErrorFallsBack(t *testing.T) {
	h := newHarness(t)
	h.api.logoURL = "/l.png"
	h.ui.welcome = []bool{false}
	h.deps.Logo = func(context.Context, string) (image.Image, error) { return nil, api.ErrLogo }
	recv(t, start(h, "12345678"))
	if h.ui.welcomes[0].Logo != nil {
		t.Fatal("hatalı logo karşılamaya geçti")
	}
}

// S6-7: geçersiz abuseEmail istemcide reddedilir; "Kötüye kullanımı bildir" gizlenir.
func TestS67InvalidAbuseEmailHidden(t *testing.T) {
	for raw, want := range map[string]string{"abuse@example.com": "abuse@example.com",
		"a@example.com?subject=x": "", "a@example.com&cc=b@c.d": "", "not-an-email": ""} {
		h := newHarness(t)
		h.api.abuse = &raw
		h.ui.welcome = []bool{false}
		recv(t, start(h, "12345678"))
		if got := h.ui.welcomes[0].AbuseEmail; got != want {
			t.Errorf("%q → %q", raw, got)
		}
	}
}

func TestNonceInvalidReResolves(t *testing.T) {
	h := newHarness(t)
	h.ui.welcome = []bool{true, false}
	h.api.joinE = []error{&api.Error{Status: 400, Code: "NONCE_INVALID"}}
	out := start(h, "12345678")
	recv(t, out)
	if len(h.api.resolves) != 2 || h.ui.welcomes[1].Notice != statusNonce {
		t.Fatalf("resolves %v welcomes %+v", h.api.resolves, h.ui.welcomes)
	}
}

// Mutlu yol: join → lobi (admitCode) → hello → monitör seçimi → share.state → offer/answer → session.ended.
func TestAC106AC107HappyPath(t *testing.T) {
	h := newHarness(t)
	out := start(h, "12345678")
	if cred := recv(t, h.creds); cred.Ticket == "" || cred.Reconnect != "" {
		t.Fatalf("ilk bağlantı ticket ile: %+v", cred)
	}
	j := h.api.joins[0]
	if !j.ConsentAccepted || j.ConsentTextID != "ct1" || j.CustomerName != "Ayşe Yılmaz" || j.JoinNonce != "nonce" {
		t.Fatalf("join: %+v", j)
	}
	c := recv(t, h.conns)
	expectCall(t, h.ui, "welcome")
	expectCall(t, h.ui, "lobby:1234:Ali Teknisyen")
	c.toClient <- signal.LobbyWait{T: "lobby.wait", ExpiresAt: "2026-11-11T10:00:00Z"}
	c.toClient <- hello(token)
	p := recv(t, h.peers)
	expectCall(t, h.ui, "choose")
	expectCall(t, h.ui, "active:Ali Teknisyen:Ekran 2")
	sh := recv(t, c.sent).(signal.ShareState)
	if sh.State != "sharing" || sh.ActiveMonitor == nil || *sh.ActiveMonitor != 2 || len(sh.Monitors) != 2 {
		t.Fatalf("share.state: %+v", sh)
	}
	c.toClient <- signal.SdpOffer{T: "sdp.offer", SDP: "o1"}
	recv(t, p.offers)
	if a := recv(t, c.sent).(signal.SdpAnswer); a.SDP != "answer-for-o1" {
		t.Fatalf("answer: %+v", a)
	}
	// DC chat → UI; kullanıcı chat → ctl (şemaya uygun)
	p.h.Ctl(dc.Ctl{T: "chat", Text: "Merhaba"})
	expectCall(t, h.ui, "chat:Merhaba")
	h.events <- Event{Kind: EvChat, Text: "Selam"}
	b := recv(t, p.ctl)
	var chat map[string]any
	if err := json.Unmarshal(b, &chat); err != nil || chat["t"] != "chat" || chat["text"] != "Selam" {
		t.Fatalf("chat: %s", b)
	}
	p.h.Ctl(dc.Ctl{T: "annot.clear"})
	expectCall(t, h.ui, "annot:annot.clear")

	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "tech"}
	if o := recv(t, out); o.Message != msgEnded {
		t.Fatalf("%+v", o)
	}
}

func TestAC24ReconnectWithTokenCreatesNewPeer(t *testing.T) {
	h := newHarness(t)
	out := start(h, "12345678")
	recv(t, h.creds)
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, h.peers)
	recv(t, c.sent) // share.state
	c.toClient <- errors.New("ağ koptu")
	if cred := recv(t, h.creds); cred.Reconnect != token || cred.Ticket != "" {
		t.Fatalf("yeniden bağlanma kimliği: %+v", cred)
	}
	expectCall(t, h.ui, "status:"+statusReconnecting)
	c2 := recv(t, h.conns)
	c2.toClient <- hello(token)
	recv(t, h.peers) // yeni PeerConnection
	if sh := recv(t, c2.sent).(signal.ShareState); sh.State != "sharing" {
		t.Fatalf("%+v", sh)
	}
	h.events <- Event{Kind: EvEnd}
	if m := recv(t, c2.sent); m.(signal.SessionEnd).T != "session.end" {
		t.Fatalf("%+v", m)
	}
	if o := recv(t, out); o.Message != msgSelfEnd {
		t.Fatalf("%+v", o)
	}
}

func TestProtocolViolationDoesNotReconnect(t *testing.T) {
	h := newHarness(t)
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- hello(token)
	recv(t, c.sent)
	c.toClient <- errors.Join(signal.ErrProtocol, errors.New("x"))
	if o := recv(t, out); o.Message != msgProtocol || !o.Failed {
		t.Fatalf("%+v", o)
	}
}

func TestLobbyCancelSendsSessionEnd(t *testing.T) {
	h := newHarness(t)
	out := start(h, "12345678")
	c := recv(t, h.conns)
	expectCall(t, h.ui, "welcome")
	expectCall(t, h.ui, "lobby:1234:Ali Teknisyen")
	h.events <- Event{Kind: EvEnd}
	if m := recv(t, c.sent); m.(signal.SessionEnd).T != "session.end" {
		t.Fatalf("%+v", m)
	}
	if o := recv(t, out); o.Message != msgLeft || o.Failed {
		t.Fatalf("kullanıcı kararı Failed sayılmaz: %+v", o)
	}
}

func TestAC112LobbyRejected(t *testing.T) {
	h := newHarness(t)
	out := start(h, "12345678")
	c := recv(t, h.conns)
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "rejected"}
	if o := recv(t, out); o.Message != msgRejected || o.Failed {
		t.Fatalf("sunucu son durumu Failed sayılmaz: %+v", o)
	}
}

// TestRunTicketDialFailureIsFailed hello'dan önce /ws/guest kurulamazsa Outcome.Failed: talep modu /ws/request'i 1001
// ile bırakır (sunucu CONNECT_FAILED "Müşteri bağlanamadı" yazar, "vazgeçti" değil).
func TestRunTicketDialFailureIsFailed(t *testing.T) {
	h := newHarness(t)
	h.deps.Dial = func(context.Context, signal.Credential) (Conn, error) { return nil, errors.New("ağ") }
	if o := RunTicket(context.Background(), h.deps, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "Mehmet", ""); !o.Failed || o.Message != msgLost {
		t.Fatalf("%+v", o)
	}
}

// TestAC154AC156RunTicketSkipsLobbyAndSignalsAdmitted talepten doğan oturum: kod/karşılama/join/lobi yok; ticket ile
// /ws/guest; ilk hello'da Admitted bir kez; sonrası normal oturum yolu (AC-156).
func TestAC154AC156RunTicketSkipsLobbyAndSignalsAdmitted(t *testing.T) {
	h := newHarness(t)
	admitted := make(chan struct{}, 2)
	h.deps.Admitted = func() { admitted <- struct{}{} }
	out := make(chan Outcome, 1)
	go func() {
		out <- RunTicket(context.Background(), h.deps, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "Mehmet", "")
	}()
	if cred := recv(t, h.creds); cred.Ticket != "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" || cred.Reconnect != "" {
		t.Fatalf("%+v", cred)
	}
	c := recv(t, h.conns)
	expectCall(t, h.ui, "connecting:Mehmet")
	select {
	case <-admitted:
		t.Fatal("hello'dan önce Admitted çağrılmamalı")
	default:
	}
	c.toClient <- hello(token)
	recv(t, admitted)
	expectCall(t, h.ui, "active:Mehmet:Ekran 2")
	c.toClient <- signal.SessionEnded{T: "session.ended", Reason: "customer"}
	if o := recv(t, out); o.Message != msgSelfEnd {
		t.Fatalf("%+v", o)
	}
	if len(h.api.resolves) != 0 {
		t.Fatal("talep yolunda resolve/join olmamalı")
	}
	select {
	case <-admitted:
		t.Fatal("Admitted bir kez")
	default:
	}
}

func TestAC133ResolveOutdatedIsFinal(t *testing.T) {
	if m, o := classify(&api.Error{Status: 426, Code: "CLIENT_OUTDATED"}); o != outFinal || m != msgOutdated {
		t.Fatalf("%v %v", m, o)
	}
}
