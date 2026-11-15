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
	infos      int
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
	f.mu.Lock()
	f.infos++
	f.mu.Unlock()
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

// fakeReqUI talep modu: form kapatılır, engel ekranı kapatılır; diğer çağrılar beklenmez (gömülü nil arayüz → panik =
// test hatası).
type fakeReqUI struct {
	request.UI
	fviews []request.FormView
	probs  []request.Problem
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
		if err := s.SaveBinding(*b, ""); err != nil {
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
	u  *homeUI // tek ana ekran + talep UI
	ru *fakeReqUI
	fu *fakeFlowUI
	s  *remember.Store
	d  Deps
}

func setup(t *testing.T, exe string, b *remember.Binding) *env {
	srv, _ := url.Parse("https://Remote.Example")
	u := &homeUI{}
	e := &env{a: &fakeAPI{}, u: u, ru: &u.fakeReqUI, fu: &fakeFlowUI{}, s: newStore(t, b)}
	e.d = Deps{Exe: exe, ServerURL: srv, API: e.a, Store: e.s, Home: u,
		Flow:    flow.Deps{UI: e.fu},
		Request: request.Deps{UI: u, Version: "0.10.0"}}
	return e
}

func TestAC182Row1CodeFlowResolvedOnceWithNotice(t *testing.T) {
	e := setup(t, codeFile, nil)
	Run(context.Background(), e.d)
	if e.a.resolves != 1 || len(e.fu.welcomes) != 1 || len(e.u.views) != 0 {
		t.Fatalf("resolve=%d welcome=%d home=%d", e.a.resolves, len(e.fu.welcomes), len(e.u.views))
	}
	if e.fu.welcomes[0].RememberNote != remember.NoticeText("Nokta") {
		t.Fatalf("AC-188: %q", e.fu.welcomes[0].RememberNote)
	}
}

func TestAC183Row2ExpiredCodeWithBindingOpensFirmHome(t *testing.T) {
	e := setup(t, codeFile, binding(server))
	e.a.resolveErr = &api.Error{Status: 410, Code: "SESSION_EXPIRED"}
	Run(context.Background(), e.d)
	v := e.u.views[0]
	if !strings.HasPrefix(v.Notice, NoticeCodeExpired) || len(v.Firms) != 1 || v.Firms[0].Key != key || v.Firms[0].File ||
		len(e.a.statusKeys) != 1 || e.a.statusKeys[0] != key {
		t.Fatalf("%+v status=%v", v, e.a.statusKeys)
	}
}

func TestAC183Row3ExpiredCodeNoBindingShowsMessageAndCode(t *testing.T) {
	e := setup(t, codeFile, nil)
	e.a.resolveErr = &api.Error{Status: 410, Code: "SESSION_CONSUMED"}
	e.u.acts = []FirmAction{{Kind: FirmCode}}
	Run(context.Background(), e.d)
	v := e.u.views[0]
	if len(v.Firms) != 0 || !strings.HasPrefix(v.Notice, "Bu bağlantı zaten kullanıldı.") || e.fu.asked != 1 {
		t.Fatalf("%+v asked=%d", v, e.fu.asked)
	}
}

// TestAC182RefOpensFirmHomeWithFileFirmSelected tek ekran (2026-11-15): geçerli firma dosyası eski tek firma ekranını
// değil firma listeli ana ekranı açar; dosyanın firması (sunucu adıyla) ilk satırdır — liste ilk satır seçili açılır —
// kayıtlı firmalar altındadır; "Destek iste" talebi o ref ile, açılıştaki yanıtı tekrar sormadan açar.
func TestAC182RefOpensFirmHomeWithFileFirmSelected(t *testing.T) {
	e := setup(t, refFile, binding(server))
	e.u.acts = []FirmAction{{Kind: FirmSupport, Index: 0}}
	Run(context.Background(), e.d)
	v := e.u.views[0]
	if len(v.Firms) != 2 || v.Single || !v.Firms[0].File || v.Firms[0].Key != "" || v.Firms[0].Text != "Bu dosyanın firması: Ref Firma" ||
		v.Firms[1].Key != key || v.Firms[1].File {
		t.Fatalf("satır 4: %+v", v.Firms)
	}
	if len(e.ru.fviews) != 1 || e.ru.fviews[0].Tenant != "Ref Firma" || e.a.infos != 1 {
		t.Fatalf("talep ref ile, ilk yanıt yeniden sorulmaz: form=%+v info=%d", e.ru.fviews, e.a.infos)
	}
	// Kayıtsız bilgisayar: yalnız dosyanın firması (tek satır).
	e = setup(t, refFile, nil)
	Run(context.Background(), e.d)
	if v := e.u.views[0]; len(v.Firms) != 1 || !v.Firms[0].File || !v.Single || len(e.ru.fviews) != 0 {
		t.Fatalf("kayıtsız: %+v", v)
	}
}

// TestAC182RefRows5And6AndNetError satır 5: kayıtla ana ekran (dosya satırı yok); satır 6: kayıtsız, satırsız ana ekran +
// bilgi satırı ("Bağlantı kodum var"); ağ hatası: dosya satırı, "Destek iste" bugünkü engel ekranını (Tekrar dene) açar.
func TestAC182RefRows5And6AndNetError(t *testing.T) {
	e := setup(t, refFile, binding(server))
	e.a.infoErr = &api.Error{Status: 404, Code: "REQUEST_REF_INVALID"}
	Run(context.Background(), e.d)
	if v := e.u.views[0]; !strings.HasPrefix(v.Notice, NoticeRefBinding) || len(v.Firms) != 1 || v.Firms[0].File || len(e.a.statusKeys) != 1 {
		t.Fatalf("satır 5: %+v", v)
	}
	e = setup(t, refFile, nil)
	e.a.infoErr = &api.Error{Status: 404, Code: "REQUEST_REF_INVALID"}
	Run(context.Background(), e.d)
	if v := e.u.views[0]; v.Notice != NoticeRefGone || len(v.Firms) != 0 || len(e.ru.probs) != 0 {
		t.Fatalf("satır 6: %+v probs=%+v", v, e.ru.probs)
	}
	e = setup(t, refFile, nil)
	e.a.infoErr = &api.Error{Status: 0}
	e.u.acts = []FirmAction{{Kind: FirmSupport, Index: 0}}
	Run(context.Background(), e.d)
	if v := e.u.views[0]; len(v.Firms) != 1 || v.Firms[0].Text != "Bu dosyanın firması" || len(e.ru.probs) != 1 || !e.ru.probs[0].Retry {
		t.Fatalf("ağ hatası: %+v probs=%+v", v, e.ru.probs)
	}
}

// TestAC253RefOpenTogglesSameRules firma dosyasıyla açılışta tepsi/başlatma kutuları normal açılıştaki kurallarla:
// kayıtlı firma varken etkin; kayıt yokken (tercih yalnız kayıtla tutulur) pasif + açıklama; yükseltilmiş süreçte pasif.
func TestAC253RefOpenTogglesSameRules(t *testing.T) {
	e := setup(t, refFile, binding(server))
	e.d.Autostart = &fakeAuto{}
	var on Toggles
	e.u.onV = func(v FirmView) { on = v.SetTray(true) }
	Run(context.Background(), e.d)
	if tg := e.u.views[0].Toggles; !tg.TrayEnabled || tg.AutostartHidden || !on.Tray || !on.AutostartEnabled {
		t.Fatalf("kayıtlı: %+v → %+v", tg, on)
	}
	if d, _ := e.s.Load(); d.Prefs == nil || !d.Prefs.Tray {
		t.Fatal("tercih yazılmalı")
	}
	e = setup(t, refFile, nil)
	e.d.Autostart = &fakeAuto{}
	e.u.onV = func(v FirmView) { on = v.SetTray(true) }
	Run(context.Background(), e.d)
	if tg := e.u.views[0].Toggles; tg.TrayEnabled || tg.AutostartEnabled || tg.Hint != hintTrayNoFirm || on.Tray {
		t.Fatalf("kayıtsız: %+v → %+v", tg, on)
	}
	e = setup(t, refFile, binding(server))
	e.d.Autostart = &fakeAuto{}
	e.d.Flow.SelfElevated = true
	Run(context.Background(), e.d)
	if tg := e.u.views[0].Toggles; tg.TrayEnabled || tg.AutostartEnabled {
		t.Fatalf("yükseltilmiş: %+v", tg)
	}
}

func TestAC190Row7And8BareFile(t *testing.T) {
	e := setup(t, bareFile, binding(server))
	Run(context.Background(), e.d)
	if v := e.u.views[0]; len(v.Firms) != 1 || v.Firms[0].Key != key || v.Firms[0].File {
		t.Fatalf("satır 7: %+v", v)
	}
	e = setup(t, bareFile, nil)
	Run(context.Background(), e.d)
	if v := e.u.views[0]; len(v.Firms) != 0 || len(e.a.statusKeys) != 0 {
		t.Fatalf("satır 8: %+v", v)
	}
}

// TestT43ForeignOriginBindingIgnoredNotDeleted başka sunucunun kaydı kullanılmaz, gönderilmez, silinmez.
func TestT43ForeignOriginBindingIgnoredNotDeleted(t *testing.T) {
	e := setup(t, bareFile, binding("https://evil.example:443"))
	Run(context.Background(), e.d)
	if v := e.u.views[0]; len(v.Firms) != 0 || len(v.Others) != 1 || len(e.a.statusKeys) != 0 {
		t.Fatalf("%+v", v)
	}
	if d, ok := e.s.Load(); !ok || len(d.Bindings) == 0 {
		t.Fatal("yabancı kayıt silinmemeli")
	}
	if k := e.d.Flow.Binding; k != nil {
		t.Fatal("Run kopya Deps alır; çağıranın Deps'i değişmemeli")
	}
	kp := newKeeper(e.s, server, time.Now)
	if req, _, ok := kp.Request(true); !ok || req.PreviousKeys != nil || req.Full {
		t.Fatalf("previousKeys yalnız aynı kökenden: %#v", req)
	}
}

func TestAC185StatusInvalidClearsBindingKeepsPersonal(t *testing.T) {
	e := setup(t, bareFile, binding(server))
	_ = e.s.SavePersonal(remember.Personal{Name: "Ayşe", Phone: "+905321234567", DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"})
	e.a.statusErr = &api.Error{Status: 404, Code: "BINDING_INVALID"}
	Run(context.Background(), e.d)
	d, ok := e.s.Load()
	if !ok || len(d.Bindings) != 0 || d.Personal == nil {
		t.Fatalf("kayıt silinmeli, kişisel kalmalı: %+v", d)
	}
	if v := e.u.views[0]; len(v.Firms) != 0 || !strings.Contains(v.Notice, "bu bilgisayarın kaydı artık geçerli değil") {
		t.Fatalf("%+v", v)
	}
}

func TestAC186ForgetComputerDeletesThenRevokes(t *testing.T) {
	e := setup(t, bareFile, binding(server))
	_ = e.s.SavePersonal(remember.Personal{Name: "Ayşe", Phone: "+905321234567", DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"})
	e.u.acts = []FirmAction{{Kind: FirmForgetAll}}
	Run(context.Background(), e.d)
	if _, ok := e.s.Load(); ok {
		t.Fatal("dosya silinmeli")
	}
	if len(e.a.revoked) != 1 || e.a.revoked[0] != key || !strings.HasPrefix(e.u.views[1].Notice, request.MsgForgotten) || len(e.u.views[1].Firms) != 0 {
		t.Fatalf("revoke=%v %+v", e.a.revoked, e.u.views)
	}
	e = setup(t, bareFile, binding("https://evil.example:443"))
	e.u.acts = []FirmAction{{Kind: FirmForgetAll}}
	Run(context.Background(), e.d)
	if len(e.a.revoked) != 0 {
		t.Fatal("yabancı kökenli anahtar gönderilmemeli")
	}
	if _, ok := e.s.Load(); ok {
		t.Fatal("unut yabancı kaydı da yerelde siler")
	}
}

type failStore struct{ *remember.Store }

func (failStore) SaveBinding(remember.Binding, string) error { return errors.New("disk") }

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
		e.u.acts = []FirmAction{{Kind: FirmSupport, Index: 0}}
		Run(context.Background(), e.d)
		if got := e.ru.fviews[0].RememberNote; (got != "") != withStore {
			t.Fatalf("depo=%v form satırı %q", withStore, got)
		}
	}
	// Kanonik olmayan (IDN) gömülü adres: kayıt kapalı → satır yok (S1).
	e = setup(t, refFile, nil)
	e.d.ServerURL, _ = url.Parse("https://bücher.example")
	e.u.acts = []FirmAction{{Kind: FirmSupport, Index: 0}}
	Run(context.Background(), e.d)
	if e.ru.fviews[0].RememberNote != "" {
		t.Fatal("IDN adreste kayıt kapalı, satır olmamalı")
	}
}
