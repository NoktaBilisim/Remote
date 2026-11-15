package request

import (
	"context"
	"errors"
	"net/url"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/remember"
)

const testRef = "abcdefghijk23456"
const testSecret = "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS"

type fakeAPI struct {
	mu         sync.Mutex
	tenant     string // boşsa "Demo Firma"
	infoErr    []error
	min        *string
	createErrs []error
	bodies     []api.CreateRequestBody
	cancels    int
	// P8c
	statusErr  []error
	statusKeys []string
	customer   string
}

func (f *fakeAPI) TenantInfo(context.Context, string) (*api.TenantRequestInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.infoErr) > 0 {
		e := f.infoErr[0]
		f.infoErr = f.infoErr[1:]
		return nil, e
	}
	i := &api.TenantRequestInfo{WaitMinutes: 30, MinAgentVersion: f.min}
	i.Tenant.Name = "Demo Firma"
	if f.tenant != "" {
		i.Tenant.Name = f.tenant
	}
	i.ConsentText = api.ConsentText{ID: "01JC0000000000000000000000", Version: 3, Body: "metin"}
	return i, nil
}

func (f *fakeAPI) CreateRequest(_ context.Context, b api.CreateRequestBody) (*api.CreateRequestResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.bodies = append(f.bodies, b)
	if len(f.createErrs) > 0 {
		e := f.createErrs[0]
		f.createErrs = f.createErrs[1:]
		if e != nil {
			return nil, e
		}
	}
	return &api.CreateRequestResult{RequestID: "01JC0000000000000000000009", RequestSecret: testSecret, RequestCode: "042917", Position: 2}, nil
}

func (f *fakeAPI) BindingStatus(_ context.Context, key string) (*api.BindingInfo, error) {
	f.mu.Lock()
	f.statusKeys = append(f.statusKeys, key)
	var e error
	if len(f.statusErr) > 0 {
		e, f.statusErr = f.statusErr[0], f.statusErr[1:]
	}
	f.mu.Unlock()
	if e != nil {
		return nil, e
	}
	info, _ := f.TenantInfo(context.Background(), "")
	b := &api.BindingInfo{TenantRequestInfo: *info}
	if f.customer != "" {
		b.Customer = &struct {
			Name string `json:"name"`
		}{f.customer}
	}
	return b, nil
}

func (f *fakeAPI) CancelRequest(context.Context, string) error {
	f.mu.Lock()
	f.cancels++
	f.mu.Unlock()
	return nil
}

type fakeConn struct {
	in     chan Inbound
	sent   chan Outbound
	msgs   chan ChatSend // P20 sohbet çerçeveleri
	closed chan bool
	once   sync.Once
}

func newConn() *fakeConn {
	return &fakeConn{in: make(chan Inbound, 8), sent: make(chan Outbound, 8), msgs: make(chan ChatSend, 8),
		closed: make(chan bool, 1)}
}

func (c *fakeConn) Read(ctx context.Context) (Inbound, error) {
	select {
	case m := <-c.in:
		return m, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (c *fakeConn) Send(_ context.Context, m Outbound) error { c.sent <- m; return nil }
func (c *fakeConn) SendMessage(_ context.Context, body, id string) error {
	c.msgs <- ChatSend{Body: body, ClientMsgID: id}
	return nil
}
func (c *fakeConn) Close(normal bool) error {
	c.once.Do(func() { c.closed <- normal })
	return nil
}

// fakeUI form kararlarını sırayla verir; bekleme ekranı çağrılarını kaydeder.
type fakeUI struct {
	mu       sync.Mutex
	forms    []func(FormView) (FormAction, Form)
	views    []FormView
	problems []ProblemAction
	probSeen []Problem
	closed   []ClosedAction
	cviews   []ClosedView
	accepted chan AcceptView
	waiting  chan WaitView
	opened   []string
	chats    chan ChatView // P20 sohbet görünümleri
	chatIn   chan string
}

func newUI() *fakeUI {
	return &fakeUI{accepted: make(chan AcceptView, 8), waiting: make(chan WaitView, 64), chats: make(chan ChatView, 256),
		chatIn: make(chan string, 8)}
}

func (u *fakeUI) RequestProblem(_ context.Context, p Problem) ProblemAction {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.probSeen = append(u.probSeen, p)
	if len(u.problems) == 0 {
		return ProblemClose
	}
	a := u.problems[0]
	u.problems = u.problems[1:]
	return a
}
func (u *fakeUI) RequestForm(_ context.Context, v FormView) (FormAction, Form) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.views = append(u.views, v)
	if len(u.forms) == 0 {
		return FormClose, Form{}
	}
	f := u.forms[0]
	u.forms = u.forms[1:]
	return f(v)
}
func (u *fakeUI) RequestFormBusy(string) {}
func (u *fakeUI) RequestFormClose()      {}
func (u *fakeUI) RequestWaiting(v WaitView) {
	select {
	case u.waiting <- v:
	default:
	}
}
func (u *fakeUI) RequestAccepted(v AcceptView)      { u.accepted <- v }
func (u *fakeUI) RequestAcceptedTick(time.Duration) {}
func (u *fakeUI) RequestWaitClose()                 {}
func (u *fakeUI) RequestChatSends() <-chan string   { return u.chatIn }
func (u *fakeUI) RequestChat(v ChatView) {
	select {
	case u.chats <- v:
	default:
	}
}
func (u *fakeUI) OpenURL(s string) { u.mu.Lock(); u.opened = append(u.opened, s); u.mu.Unlock() }
func (u *fakeUI) RequestClosed(_ context.Context, v ClosedView) ClosedAction {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.cviews = append(u.cviews, v)
	if len(u.closed) == 0 {
		return ClosedClose
	}
	a := u.closed[0]
	u.closed = u.closed[1:]
	return a
}

type memRemember struct {
	d         *remember.Personal
	forgot    int
	forgetErr error // silme başarısız (QA-P8b2-2): dosya diskte kalır
}

func (m *memRemember) LoadPersonal() (remember.Personal, bool) {
	if m.d == nil {
		return remember.Personal{}, false
	}
	return *m.d, true
}
func (m *memRemember) SavePersonal(d remember.Personal) error { m.d = &d; return nil }
func (m *memRemember) ClearPersonal() error {
	m.forgot++
	if m.forgetErr != nil {
		return m.forgetErr
	}
	m.d = nil
	return nil
}

func submit(f Form) func(FormView) (FormAction, Form) {
	return func(FormView) (FormAction, Form) { return FormSubmit, f }
}

var goodForm = Form{Name: "Ayşe Yılmaz", Phone: "0532 123 45 67", Description: "Yazıcı çalışmıyor acil", Consent: true}

func deps(a *fakeAPI, u *fakeUI, conn *fakeConn, ev chan UserAction, rem Remember) Deps {
	srv, _ := url.Parse("https://remote.example")
	return Deps{API: a, UI: u, Events: ev, Remember: rem, ServerURL: srv, Ref: testRef, Version: "0.9.0",
		Dial: func(context.Context, string) (Conn, error) { return conn, nil },
		After: func(time.Duration) <-chan time.Time {
			c := make(chan time.Time, 1)
			c <- time.Now()
			return c
		},
		Jitter: func(time.Duration) time.Duration { return 0 }, TickEvery: time.Hour}
}

func runAsync(d Deps) chan Outcome {
	out := make(chan Outcome, 1)
	go func() { out <- Run(context.Background(), d) }()
	return out
}

func wait[T any](t *testing.T, c chan T) T {
	t.Helper()
	select {
	case v := <-c:
		return v
	case <-time.After(3 * time.Second):
		t.Fatal("zaman aşımı")
	}
	var z T
	return z
}

// connected bir request.state gönderip ekrana yansımasını bekler (soket bağlandı).
func connected(t *testing.T, u *fakeUI, conn *fakeConn) {
	t.Helper()
	conn.in <- State{T: "request.state", Status: "PENDING", RequestCode: "042917", Position: 7,
		CreatedAt: "2026-11-12T10:00:00.000Z", ExpiresAt: "2026-11-12T10:30:00.000Z", ServerTime: "2026-11-12T10:01:05.000Z"}
	for v := wait(t, u.waiting); v.Position != 7; v = wait(t, u.waiting) {
	}
}

func TestAC139AC154HappyPathRememberAndShare(t *testing.T) {
	a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
	rem := &memRemember{}
	f := goodForm
	f.Remember = true
	u.forms = []func(FormView) (FormAction, Form){submit(f)}
	out := runAsync(deps(a, u, conn, ev, rem))
	conn.in <- State{T: "request.state", Status: "PENDING", RequestCode: "042917", Position: 1,
		CreatedAt: "2026-11-12T10:00:00.000Z", ExpiresAt: "2026-11-12T10:30:00.000Z", ServerTime: "2026-11-12T10:01:05.000Z"}
	for v := wait(t, u.waiting); v.Position != 1; v = wait(t, u.waiting) {
	}
	conn.in <- acc
	av := wait(t, u.accepted)
	if av.TechName != "Mehmet" || av.TechVerifyCode != "4821" || av.RequestCode != "042917" {
		t.Fatalf("%+v", av)
	}
	ev <- UserShare
	o := wait(t, out)
	if o.Kind != OutShare || o.Ticket != acc.WsTicket || o.TechName != "Mehmet" {
		t.Fatalf("%+v", o)
	}
	select {
	case <-conn.closed:
		t.Fatal("/ws/request hello gelmeden kapatılmamalı (1000 = vazgeçme)")
	default:
	}
	o.Release(ReleaseAdmitted)
	if normal := wait(t, conn.closed); !normal {
		t.Fatal("hello sonrası 1000 ile kapanmalı")
	}
	b := a.bodies[0]
	if b.Phone != "+905321234567" || b.DeviceKey == "" || len(b.DeviceKey) != 22 || b.Ref != testRef || b.ClientVersion != "0.9.0" || len(b.ClientInstanceID) != 22 {
		t.Fatalf("%+v", b)
	}
	if rem.d == nil || rem.d.DeviceKey != b.DeviceKey || rem.d.Phone != "+905321234567" || rem.d.Name != "Ayşe Yılmaz" {
		t.Fatalf("201 sonrası hatırlanmalı: %+v", rem.d)
	}
}

func TestAC136UncheckedSubmitForgetsAndSendsNoDeviceKey(t *testing.T) {
	a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
	rem := &memRemember{d: &remember.Personal{Name: "Eski Ad", Phone: "+905321234567", DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"}}
	u.forms = []func(FormView) (FormAction, Form){submit(goodForm)}
	out := runAsync(deps(a, u, conn, ev, rem))
	connected(t, u, conn)
	ev <- UserClose
	if o := wait(t, out); o.Kind != OutClose {
		t.Fatalf("%+v", o)
	}
	if !u.views[0].Remembered || !u.views[0].Values.Remember || u.views[0].Values.Name != "Eski Ad" {
		t.Fatalf("hatırlanan bilgilerle açılmalı + ipucu: %+v", u.views[0])
	}
	if a.bodies[0].DeviceKey != "" || rem.d != nil || rem.forgot == 0 {
		t.Fatal("işaretsiz gönderim dosyayı silmeli ve deviceKey göndermemeli")
	}
	if s := wait(t, conn.sent); s != SendCancel {
		t.Fatalf("pencere kapatma önce request.cancel: %v", s)
	}
	if !wait(t, conn.closed) {
		t.Fatal("sonra 1000")
	}
}

func TestAC137ForgetClearsForm(t *testing.T) {
	a, u, ev := &fakeAPI{}, newUI(), make(chan UserAction)
	rem := &memRemember{d: &remember.Personal{Name: "Eski Ad", Phone: "+905321234567", DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"}}
	u.forms = []func(FormView) (FormAction, Form){func(FormView) (FormAction, Form) { return FormForget, Form{} }}
	o := Run(context.Background(), deps(a, u, newConn(), ev, rem))
	if o.Kind != OutClose || rem.d != nil || len(u.views) != 2 {
		t.Fatalf("%+v", o)
	}
	v := u.views[1]
	if v.Values != (Form{}) || v.Remembered || v.Notice != "Bilgileriniz silindi." {
		t.Fatalf("%+v", v)
	}
}

func TestAC134AC164ValidationErrorsFocusFirstField(t *testing.T) {
	a, u := &fakeAPI{}, newUI()
	u.forms = []func(FormView) (FormAction, Form){submit(Form{Name: "Ayşe Yılmaz", Phone: "12", Description: "kısa"})}
	Run(context.Background(), deps(a, u, newConn(), nil, nil))
	v := u.views[1]
	if v.Focus != FieldPhone || v.Errors[FieldDescription] == "" || v.Errors[FieldConsent] == "" || len(a.bodies) != 0 {
		t.Fatalf("geçersiz form sunucuya gitmemeli, ilk hatalı alana odak: %+v", v)
	}
}

func TestS8b8NotReadyRetriedOnceThenNotice(t *testing.T) {
	busy := &api.Error{Status: 503, Code: "NOT_READY", RetryAfter: time.Second}
	a, u := &fakeAPI{createErrs: []error{busy, busy}}, newUI()
	u.forms = []func(FormView) (FormAction, Form){submit(goodForm)}
	Run(context.Background(), deps(a, u, newConn(), nil, nil))
	if len(a.bodies) != 2 || u.views[1].Notice != noticeBusy {
		t.Fatalf("en çok 2 deneme: %d %q", len(a.bodies), u.views[1].Notice)
	}
}

func TestAC133InfoProblemsAndCodeMode(t *testing.T) {
	a, u := &fakeAPI{infoErr: []error{&api.Error{Status: 0, TLS: true}, &api.Error{Status: 404, Code: "REQUEST_REF_INVALID"}}}, newUI()
	u.problems = []ProblemAction{ProblemRetry, ProblemCodeMode}
	o := Run(context.Background(), deps(a, u, newConn(), nil, nil))
	if o.Kind != OutCodeMode || u.probSeen[0].Message != msgTLS || !u.probSeen[0].Retry || u.probSeen[1].Message != msgRefGone || u.probSeen[1].Retry {
		t.Fatalf("%+v %+v", o, u.probSeen)
	}
}

func TestAC133OutdatedBlocksFormAndOpensFixedURL(t *testing.T) {
	min := "0.9.1"
	a, u := &fakeAPI{min: &min}, newUI()
	u.problems = []ProblemAction{ProblemDownload, ProblemCodeMode}
	o := Run(context.Background(), deps(a, u, newConn(), nil, nil))
	if o.Kind != OutClose || len(u.views) != 0 || len(u.opened) != 1 ||
		u.opened[0] != "https://remote.example/api/v1/public/agent/request-download?ref="+testRef {
		t.Fatalf("%+v views=%d opened=%v", o, len(u.views), u.opened)
	}
}

func TestAC142ExpiredRecreateKeepsForm(t *testing.T) {
	a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
	u.forms = []func(FormView) (FormAction, Form){submit(goodForm)}
	u.closed = []ClosedAction{ClosedRecreate}
	out := runAsync(deps(a, u, conn, ev, nil))
	conn.in <- Closed{T: "request.closed", Status: "EXPIRED"}
	if o := wait(t, out); o.Kind != OutClose {
		t.Fatalf("%+v", o)
	}
	if u.cviews[0].Title != "Talebiniz zaman aşımına uğradı" || len(u.views) != 2 || u.views[1].Values.Name != goodForm.Name {
		t.Fatalf("yeniden talep formu dolu açılmalı: %+v", u.views)
	}
}

func TestAC154CancelRaceDeclinesLateAccept(t *testing.T) {
	a, u, conn, ev := &fakeAPI{}, newUI(), newConn(), make(chan UserAction, 4)
	u.forms = []func(FormView) (FormAction, Form){submit(goodForm)}
	d := deps(a, u, conn, ev, nil)
	d.After = time.After // iptal yanıtı bekleme süresi gerçek (sahte After hemen düşerdi)
	out := runAsync(d)
	connected(t, u, conn)
	ev <- UserCancel
	if s := wait(t, conn.sent); s != SendCancel {
		t.Fatal(s)
	}
	conn.in <- acc
	if s := wait(t, conn.sent); s != SendDecline {
		t.Fatalf("iptal sonrası kabul decline ile yanıtlanmalı: %v", s)
	}
	select {
	case <-u.accepted:
		t.Fatal("onay ekranı açılmamalı")
	default:
	}
	conn.in <- Closed{T: "request.closed", Status: "CANCELLED"}
	if o := wait(t, out); o.Kind != OutClose || u.views[1].Notice != noticeCancelled {
		t.Fatalf("%+v %+v", o, u.views)
	}
}

func TestAC141ReconnectAfterDropAnd403Ends(t *testing.T) {
	a, u, ev := &fakeAPI{}, newUI(), make(chan UserAction, 4)
	u.forms = []func(FormView) (FormAction, Form){submit(goodForm)}
	first := &dropConn{fakeConn: newConn()}
	calls := 0
	d := deps(a, u, nil, ev, nil)
	d.Dial = func(context.Context, string) (Conn, error) {
		calls++
		if calls == 1 {
			return first, nil
		}
		return nil, &DialError{Status: 403, Err: errors.New("x")}
	}
	// QA önerisi: kopmadan sonraki ilk deneme de 0..1 sn jitter bekler (sürü etkisi); ilk bağlantı beklemez.
	var mu sync.Mutex
	var waits, jitters []time.Duration
	d.Jitter = func(m time.Duration) time.Duration {
		mu.Lock()
		defer mu.Unlock()
		jitters = append(jitters, m)
		return 700 * time.Millisecond
	}
	after := d.After
	d.After = func(x time.Duration) <-chan time.Time {
		mu.Lock()
		waits = append(waits, x)
		mu.Unlock()
		return after(x)
	}
	o := Run(context.Background(), d)
	if o.Kind != OutClose || calls != 2 || u.cviews[0].Message != msgGone {
		t.Fatalf("%+v calls=%d %+v", o, calls, u.cviews)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(waits) != 1 || waits[0] != 700*time.Millisecond || len(jitters) != 1 || jitters[0] != time.Second {
		t.Fatalf("kopma sonrası ilk deneme 0..1 sn jitter beklemeli: waits=%v jitters=%v", waits, jitters)
	}
}

// dropConn ilk okumada kopar.
type dropConn struct{ *fakeConn }

func (c *dropConn) Read(context.Context) (Inbound, error) { return nil, errors.New("eof") }
