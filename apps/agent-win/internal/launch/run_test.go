package launch

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/signal"
)

const (
	key      = "rsb_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	server   = "https://remote.example:443"
	refFile  = `C:\Users\a\Downloads\NoktaDestek-Ornek-abcdefghijk23456.exe`
	codeFile = `C:\Users\a\Downloads\Destek-12345678.exe`
	bareFile = `C:\Users\a\Downloads\NoktaDestek.exe`
)

type fakeAPI struct {
	mu         sync.Mutex
	resolveErr error
	infoErr    error
	statusErr  error
	resolves   int
	statusKeys []string
	revoked    []string
}

func (f *fakeAPI) Resolve(context.Context, string) (*api.ResolveResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resolves++
	if f.resolveErr != nil {
		return nil, f.resolveErr
	}
	r := &api.ResolveResult{JoinNonce: "n"}
	r.Tenant.Name = "Nokta"
	return r, nil
}
func (f *fakeAPI) Join(context.Context, api.JoinRequest) (*api.JoinResult, error) {
	return nil, errors.New("çağrılmamalı")
}
func (f *fakeAPI) TenantInfo(context.Context, string) (*api.TenantRequestInfo, error) {
	if f.infoErr != nil {
		return nil, f.infoErr
	}
	i := &api.TenantRequestInfo{WaitMinutes: 30}
	i.Tenant.Name = "Ref Firma"
	return i, nil
}
func (f *fakeAPI) BindingStatus(_ context.Context, k string) (*api.BindingInfo, error) {
	f.mu.Lock()
	f.statusKeys = append(f.statusKeys, k)
	f.mu.Unlock()
	if f.statusErr != nil {
		return nil, f.statusErr
	}
	b := &api.BindingInfo{}
	b.Tenant.Name = "Kayıt Firma"
	return b, nil
}
func (f *fakeAPI) CreateRequest(context.Context, api.CreateRequestBody) (*api.CreateRequestResult, error) {
	return nil, errors.New("çağrılmamalı")
}
func (f *fakeAPI) CancelRequest(context.Context, string) error { return nil }
func (f *fakeAPI) RevokeBinding(_ context.Context, k string) error {
	f.mu.Lock()
	f.revoked = append(f.revoked, k)
	f.mu.Unlock()
	return nil
}

// fakeReqUI ana ekran kararlarını sırayla verir; diğer çağrılar beklenmez (gömülü nil arayüz → panik = test hatası).
type fakeReqUI struct {
	request.UI
	homes  []request.HomeAction
	hviews []request.HomeView
	fviews []request.FormView
	probs  []request.Problem
}

func (u *fakeReqUI) RequestHome(_ context.Context, v request.HomeView) request.HomeAction {
	u.hviews = append(u.hviews, v)
	if len(u.homes) == 0 {
		return request.HomeClose
	}
	a := u.homes[0]
	u.homes = u.homes[1:]
	return a
}
func (u *fakeReqUI) RequestForm(_ context.Context, v request.FormView) (request.FormAction, request.Form) {
	u.fviews = append(u.fviews, v)
	return request.FormClose, request.Form{}
}
func (u *fakeReqUI) RequestFormClose() {}

func (u *fakeReqUI) RequestProblem(_ context.Context, p request.Problem) request.ProblemAction {
	u.probs = append(u.probs, p)
	return request.ProblemClose
}

type fakeFlowUI struct {
	flow.UI
	welcomes []flow.Welcome
	asked    int
}

func (u *fakeFlowUI) Welcome(_ context.Context, w flow.Welcome) (string, bool) {
	u.welcomes = append(u.welcomes, w)
	return "", false
}
func (u *fakeFlowUI) AskCode(context.Context, string) (string, bool) { u.asked++; return "", false }

func xor(b []byte) ([]byte, error) {
	out := make([]byte, len(b))
	for i, c := range b {
		out[i] = c ^ 0x33
	}
	return out, nil
}

func newStore(t *testing.T, b *remember.Binding) *remember.Store {
	s := &remember.Store{Dir: filepath.Join(t.TempDir(), "NoktaDestek"), Protect: xor, Unprotect: xor}
	if b != nil {
		if err := s.SaveBinding(*b); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func binding(srv string) *remember.Binding {
	return &remember.Binding{Server: srv, Key: key, TenantName: "Eski Firma", CustomerName: "Müşteri",
		IssuedAt: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)}
}

type env struct {
	a  *fakeAPI
	ru *fakeReqUI
	fu *fakeFlowUI
	s  *remember.Store
	d  Deps
}

func setup(t *testing.T, exe string, b *remember.Binding) *env {
	srv, _ := url.Parse("https://Remote.Example")
	e := &env{a: &fakeAPI{}, ru: &fakeReqUI{}, fu: &fakeFlowUI{}, s: newStore(t, b)}
	e.d = Deps{Exe: exe, ServerURL: srv, API: e.a, Store: e.s,
		Flow:    flow.Deps{UI: e.fu},
		Request: request.Deps{UI: e.ru, Version: "0.10.0"}}
	return e
}

func TestAC182Row1CodeFlowResolvedOnceWithNotice(t *testing.T) {
	e := setup(t, codeFile, nil)
	Run(context.Background(), e.d)
	if e.a.resolves != 1 || len(e.fu.welcomes) != 1 || len(e.ru.hviews) != 0 {
		t.Fatalf("resolve=%d welcome=%d home=%d", e.a.resolves, len(e.fu.welcomes), len(e.ru.hviews))
	}
	if e.fu.welcomes[0].RememberNote != remember.NoticeText("Nokta") {
		t.Fatalf("AC-188: %q", e.fu.welcomes[0].RememberNote)
	}
}

func TestAC183Row2ExpiredCodeWithBindingOpensBindingHome(t *testing.T) {
	e := setup(t, codeFile, binding(server))
	e.a.resolveErr = &api.Error{Status: 410, Code: "SESSION_EXPIRED"}
	Run(context.Background(), e.d)
	v := e.ru.hviews[0]
	if v.Notice != NoticeCodeExpired || !v.Support || v.Registered != "Kayıt Firma" || len(e.a.statusKeys) != 1 || e.a.statusKeys[0] != key {
		t.Fatalf("%+v status=%v", v, e.a.statusKeys)
	}
}

func TestAC183Row3ExpiredCodeNoBindingShowsMessageAndCode(t *testing.T) {
	e := setup(t, codeFile, nil)
	e.a.resolveErr = &api.Error{Status: 410, Code: "SESSION_CONSUMED"}
	e.ru.homes = []request.HomeAction{request.HomeCode}
	Run(context.Background(), e.d)
	v := e.ru.hviews[0]
	if v.Support || !strings.HasPrefix(v.Notice, "Bu bağlantı zaten kullanıldı.") || e.fu.asked != 1 {
		t.Fatalf("%+v asked=%d", v, e.fu.asked)
	}
}

func TestAC182Row4And5RefFile(t *testing.T) {
	e := setup(t, refFile, binding(server))
	Run(context.Background(), e.d)
	if v := e.ru.hviews[0]; v.Tenant != "Ref Firma" || v.Registered != "Eski Firma – Müşteri" || len(e.a.statusKeys) != 0 {
		t.Fatalf("satır 4: %+v", v)
	}
	e = setup(t, refFile, binding(server))
	e.a.infoErr = &api.Error{Status: 404, Code: "REQUEST_REF_INVALID"}
	Run(context.Background(), e.d)
	if v := e.ru.hviews[0]; v.Notice != NoticeRefBinding || v.Tenant != "Kayıt Firma" || len(e.a.statusKeys) != 1 {
		t.Fatalf("satır 5: %+v", v)
	}
	e = setup(t, refFile, nil)
	e.a.infoErr = &api.Error{Status: 404, Code: "REQUEST_REF_INVALID"}
	Run(context.Background(), e.d)
	if len(e.ru.probs) != 1 || !e.ru.probs[0].CodeMode || len(e.ru.hviews) != 0 {
		t.Fatalf("satır 6: %+v", e.ru.probs)
	}
}

func TestAC190Row7And8BareFile(t *testing.T) {
	e := setup(t, bareFile, binding(server))
	Run(context.Background(), e.d)
	if v := e.ru.hviews[0]; !v.Support || v.Tenant != "Kayıt Firma" {
		t.Fatalf("satır 7: %+v", v)
	}
	e = setup(t, bareFile, nil)
	Run(context.Background(), e.d)
	if v := e.ru.hviews[0]; v.Support || v.Hint != request.MsgNoSource {
		t.Fatalf("satır 8: %+v", v)
	}
}

// TestT43ForeignOriginBindingIgnoredNotDeleted başka sunucunun kaydı kullanılmaz, gönderilmez, silinmez.
func TestT43ForeignOriginBindingIgnoredNotDeleted(t *testing.T) {
	e := setup(t, bareFile, binding("https://evil.example:443"))
	e.ru.homes = []request.HomeAction{request.HomeClose}
	Run(context.Background(), e.d)
	if v := e.ru.hviews[0]; v.Support || v.Registered != "" || len(e.a.statusKeys) != 0 {
		t.Fatalf("%+v", v)
	}
	if d, ok := e.s.Load(); !ok || d.Binding == nil {
		t.Fatal("yabancı kayıt silinmemeli")
	}
	if k := e.d.Flow.Binding; k != nil {
		t.Fatal("Run kopya Deps alır; çağıranın Deps'i değişmemeli")
	}
	kp := newKeeper(e.s, server, binding("https://evil.example:443"), time.Now)
	if kp.PreviousKey() != "" {
		t.Fatal("previousKey yalnız aynı kökene")
	}
}

func TestAC185StatusInvalidClearsBindingKeepsPersonal(t *testing.T) {
	e := setup(t, bareFile, binding(server))
	_ = e.s.SavePersonal(remember.Personal{Name: "Ayşe", Phone: "+905321234567", DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"})
	e.a.statusErr = &api.Error{Status: 404, Code: "BINDING_INVALID"}
	Run(context.Background(), e.d)
	d, ok := e.s.Load()
	if !ok || d.Binding != nil || d.Personal == nil {
		t.Fatalf("kayıt silinmeli, kişisel kalmalı: %+v", d)
	}
	if v := e.ru.hviews[0]; v.Notice != request.MsgBindingInvalid || v.Support {
		t.Fatalf("%+v", v)
	}
}

func TestAC186ForgetComputerDeletesThenRevokes(t *testing.T) {
	e := setup(t, bareFile, binding(server))
	_ = e.s.SavePersonal(remember.Personal{Name: "Ayşe", Phone: "+905321234567", DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"})
	e.ru.homes = []request.HomeAction{request.HomeForget, request.HomeClose}
	Run(context.Background(), e.d)
	if _, ok := e.s.Load(); ok {
		t.Fatal("dosya silinmeli")
	}
	if len(e.a.revoked) != 1 || e.a.revoked[0] != key || e.ru.hviews[1].Notice != request.MsgForgotten {
		t.Fatalf("revoke=%v %+v", e.a.revoked, e.ru.hviews)
	}
	e = setup(t, bareFile, binding("https://evil.example:443"))
	e.ru.homes = []request.HomeAction{request.HomeForget, request.HomeClose}
	Run(context.Background(), e.d)
	if len(e.a.revoked) != 0 {
		t.Fatal("yabancı kökenli anahtar gönderilmemeli")
	}
	if _, ok := e.s.Load(); ok {
		t.Fatal("unut yabancı kaydı da yerelde siler")
	}
}

func TestAC187KeeperSavesCanonicalAndReportsChange(t *testing.T) {
	s := newStore(t, nil)
	now := func() time.Time { return time.Date(2026, 11, 12, 10, 0, 0, 5, time.UTC) }
	firm := "Yeni\u200b Müşteri"
	k := newKeeper(s, server, nil, now)
	if c := k.Issued(signal.BindingIssued{T: "binding.issued", BindingKey: key, TenantName: "Nokta", CustomerFirmName: &firm}); c != "" {
		t.Fatalf("ilk kayıtta değişiklik bilgisi yok: %q", c)
	}
	d, _ := s.Load()
	if d.Binding == nil || d.Binding.Server != server || d.Binding.CustomerName != "Yeni Müşteri" || k.PreviousKey() != key {
		t.Fatalf("%+v", d.Binding)
	}
	if c := k.Issued(signal.BindingIssued{T: "binding.issued", BindingKey: key, TenantName: "Nokta", CustomerFirmName: &firm}); c != "" {
		t.Fatal("aynı firma/müşteri yenilemesi bilgi göstermez")
	}
	if c := k.Issued(signal.BindingIssued{T: "binding.issued", BindingKey: key, TenantName: "Başka"}); c != "Başka" ||
		ChangedText(c) != "Bu bilgisayar artık Başka için kayıtlı." {
		t.Fatalf("%q", c)
	}
	bad := newKeeper(&failStore{Store: s}, server, nil, now)
	if c := bad.Issued(signal.BindingIssued{T: "binding.issued", BindingKey: key, TenantName: "X"}); c != "" {
		t.Fatal("yazılamazsa sessiz")
	}
}

type failStore struct{ *remember.Store }

func (failStore) SaveBinding(remember.Binding) error { return errors.New("disk") }

// TestNoStoreDisablesBinding LocalAppData yoksa kayıt kapalı (teklif yok sayılır, AC-188 satırı yok).
func TestNoStoreDisablesBinding(t *testing.T) {
	e := setup(t, codeFile, nil)
	e.d.Store = nil
	Run(context.Background(), e.d)
	if e.fu.welcomes[0].RememberNote != "" {
		t.Fatal("depo yokken bilgi satırı olmamalı")
	}
	// QA P8c-2 Tur 1 madde 1: talep formunda da aynı kural (depo yok → boş, var → dolu).
	for _, withStore := range []bool{false, true} {
		e = setup(t, refFile, nil)
		if !withStore {
			e.d.Store = nil
		}
		e.ru.homes = []request.HomeAction{request.HomeSupport}
		Run(context.Background(), e.d)
		if got := e.ru.fviews[0].RememberNote; (got != "") != withStore {
			t.Fatalf("depo=%v form satırı %q", withStore, got)
		}
	}
	// Kanonik olmayan (IDN) gömülü adres: kayıt kapalı → satır yok (S1).
	e = setup(t, refFile, nil)
	e.d.ServerURL, _ = url.Parse("https://bücher.example")
	e.ru.homes = []request.HomeAction{request.HomeSupport}
	Run(context.Background(), e.d)
	if e.ru.fviews[0].RememberNote != "" {
		t.Fatal("IDN adreste kayıt kapalı, satır olmamalı")
	}
}
