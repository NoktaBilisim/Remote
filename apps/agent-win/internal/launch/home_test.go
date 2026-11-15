package launch

import (
	"context"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/autorun"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
)

// homeAPI anahtar başına status yanıtı; talep oluşturma sayılır.
type homeAPI struct {
	fakeAPI
	mu    sync.Mutex
	errs  map[string]error
	names map[string]string
}

func (a *homeAPI) BindingStatus(ctx context.Context, k string) (*api.BindingInfo, error) {
	a.mu.Lock()
	err, name := a.errs[k], a.names[k]
	a.mu.Unlock()
	a.fakeAPI.mu.Lock()
	a.statusKeys = append(a.statusKeys, k)
	a.fakeAPI.mu.Unlock()
	if err != nil {
		return nil, err
	}
	b := &api.BindingInfo{}
	b.Tenant.Name = name
	b.ConsentText.Version = 1
	return b, nil
}

// homeUI firma listesi + talep UI: kararlar sırayla; toggle çağrıları görünümden yapılabilir.
type homeUI struct {
	fakeReqUI
	acts  []FirmAction
	views []FirmView
	onV   func(v FirmView)
}

func (u *homeUI) FirmHome(_ context.Context, v FirmView) FirmAction {
	u.views = append(u.views, v)
	if u.onV != nil {
		u.onV(v)
	}
	if len(u.acts) == 0 {
		return FirmAction{Kind: FirmClose}
	}
	a := u.acts[0]
	u.acts = u.acts[1:]
	return a
}

type fakeAuto struct {
	state     autorun.State
	stateErr  error
	enabled   int
	disabled  int
	enableR   autorun.Reason
	verify    autorun.Check
	disableEr error
}

func (f *fakeAuto) State() (autorun.State, error) { return f.state, f.stateErr }
func (f *fakeAuto) Enable() (autorun.Reason, error) {
	f.enabled++
	if f.enableR == autorun.ReasonOK {
		f.state.On = true
	}
	return f.enableR, nil
}
func (f *fakeAuto) Disable() error {
	f.disabled++
	f.state.On = false
	return f.disableEr
}
func (f *fakeAuto) Verify() (autorun.Check, error) { return f.verify, nil }

type homeEnv struct {
	a  *homeAPI
	u  *homeUI
	as *fakeAuto
	s  *remember.Store
	d  Deps
}

func homeSetup(t *testing.T, bs ...remember.Binding) *homeEnv {
	t.Helper()
	e := setup(t, bareFile, nil)
	h := &homeEnv{a: &homeAPI{errs: map[string]error{}, names: map[string]string{}}, u: &homeUI{}, as: &fakeAuto{},
		s: storeWith(t, bs...)}
	for _, b := range bs {
		h.a.names[b.Key] = b.TenantName
	}
	h.d = e.d
	h.d.API, h.d.Store, h.d.Autostart = h.a, h.s, h.as
	h.d.Request.UI = h.u
	return h
}

func (h *homeEnv) keys(t *testing.T) []string {
	t.Helper()
	d, _ := h.s.Load()
	var out []string
	for _, b := range d.Bindings {
		out = append(out, b.Key)
	}
	slices.Sort(out)
	return out
}

// TestAC254HomeListsFirmsWithDateAndOtherOriginSeparately G-P20-12 / K-P20-12: her satırda kayıt tarihi; başka kökenli
// kayıtlar ayrı başlık altında, seçilemez; tek kayıtta liste yerine satır.
func TestAC254HomeListsFirmsWithDateAndOtherOriginSeparately(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "Nokta"), bnd(server, 30, "Nokta"), bnd(other, 3, "Staging"))
	Run(context.Background(), h.d)
	v := h.u.views[0]
	if len(v.Firms) != 2 || v.Single || len(v.Others) != 1 || v.Others[0].Host != "staging.example" {
		t.Fatalf("%+v", v)
	}
	for _, r := range append(slices.Clone(v.Others[0].Rows), v.Firms[0].Text, v.Firms[1].Text) {
		if !strings.Contains(r, "(kayıt: ") {
			t.Fatalf("tarih yok: %q", r)
		}
	}
	if v.Firms[0].Text == v.Firms[1].Text {
		t.Fatal("aynı adlı iki firma tarihle ayrılmalı")
	}
	if slices.Contains(h.a.statusKeys, bkey(3)) {
		t.Fatal("başka kökenli anahtar sunucuya gönderilmemeli (T43)")
	}
	h = homeSetup(t, bnd(server, 1, "Nokta"))
	Run(context.Background(), h.d)
	if !h.u.views[0].Single {
		t.Fatal("tek kayıtta satır")
	}
}

// TestGP208OnlyBindingInvalidDeletesItem G-P20-8: yalnız BINDING_INVALID o öğeyi siler; RATE_LIMITED, 5xx,
// CLIENT_OUTDATED, kodsuz 404 hiçbir öğeyi silmez; ağ hatası kalan denetimleri durdurur ama silmez.
func TestGP208OnlyBindingInvalidDeletesItem(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "A"), bnd(server, 2, "B"), bnd(server, 3, "C"), bnd(server, 4, "D"), bnd(server, 5, "E"))
	h.a.errs[bkey(1)] = &api.Error{Status: 429, Code: "RATE_LIMITED"}
	h.a.errs[bkey(2)] = &api.Error{Status: 503, Code: "INTERNAL"}
	h.a.errs[bkey(3)] = &api.Error{Status: 426, Code: "CLIENT_OUTDATED"}
	h.a.errs[bkey(4)] = &api.Error{Status: 404}
	h.a.errs[bkey(5)] = &api.Error{Status: 404, Code: "BINDING_INVALID"}
	Run(context.Background(), h.d)
	if got := h.keys(t); !slices.Equal(got, []string{bkey(1), bkey(2), bkey(3), bkey(4)}) {
		t.Fatalf("yalnız 5 silinmeli: %v", got)
	}
	if v := h.u.views[0]; len(v.Firms) != 4 || !strings.Contains(v.Notice, "E: bu bilgisayarın kaydı artık geçerli değil") {
		t.Fatalf("%+v", v)
	}
	h = homeSetup(t, bnd(server, 1, "A"), bnd(server, 2, "B"))
	h.a.errs[bkey(1)] = &api.Error{Status: 0}
	h.a.errs[bkey(2)] = &api.Error{Status: 0}
	Run(context.Background(), h.d)
	if len(h.keys(t)) != 2 || len(h.a.statusKeys) != 1 {
		t.Fatalf("ağ hatası: kayıt=%v status=%v", h.keys(t), h.a.statusKeys)
	}
}

// TestGP208OnBindingInvalidUsesRequestKey talep sırasında BINDING_INVALID → silinen anahtar talebin anahtarıdır
// (listede başka öğe seçili/sırası değişmiş olsa da); liste bilgiyle yeniden gösterilir.
func TestGP208OnBindingInvalidUsesRequestKey(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "A"), bnd(server, 2, "B"))
	// ilk gösterimde status geçerli; seçilen öğe (B, dizin 0 = en son kullanılan) talepte geçersiz olur
	h.u.onV = func(v FirmView) {
		if len(h.u.views) == 1 {
			h.a.errs[v.Firms[0].Key] = &api.Error{Status: 404, Code: "BINDING_INVALID"}
			// talep sürerken A en son kullanılan olur (başka süreç): sıra değişir, silme yine B'nin anahtarıyla
			_ = h.s.TouchBinding(bkey(1), time.Now())
		}
	}
	h.u.acts = []FirmAction{{Kind: FirmSupport, Index: 0}}
	Run(context.Background(), h.d)
	if got := h.keys(t); !slices.Equal(got, []string{bkey(1)}) {
		t.Fatalf("yalnız talebin anahtarı (B) silinmeli: %v", got)
	}
	if len(h.u.views) != 2 || !strings.Contains(h.u.views[1].Notice, request.MsgBindingInvalid) || len(h.u.views[1].Firms) != 1 {
		t.Fatalf("listeye dönüş: %+v", h.u.views)
	}
}

// TestAC254SupportSelectedFirmSkipsRequestHome seçilen firmayla talep: status o anahtarla, talebin ana ekranı otomatik
// geçilir (form açılır), talep oluşturma o anahtarla, form başlığı/kayıt etiketi seçilenin.
func TestAC254SupportSelectedFirmSkipsRequestHome(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "A"), bnd(server, 2, "B"))
	h.u.acts = []FirmAction{{Kind: FirmSupport, Index: 1}}
	Run(context.Background(), h.d)
	sel := h.u.views[0].Firms[1].Key
	if len(h.u.hviews) != 0 || len(h.u.fviews) != 1 || len(h.u.views) != 1 {
		t.Fatalf("talep ana ekranı geçilmeli: home=%d form=%d list=%d", len(h.u.hviews), len(h.u.fviews), len(h.u.views))
	}
	if last := h.a.statusKeys[len(h.a.statusKeys)-1]; last != sel {
		t.Fatalf("status seçilen anahtarla: %s ≠ %s", last, sel)
	}
}

// TestAC254ForgetOneRevokesOnlyThatKey "Bu firmayı unut": yalnız o öğe yerelde silinir ve yalnız o anahtar iptal
// edilir; son öğe gidince Run değeri silinir ve kaynaksız ana ekran.
func TestAC254ForgetOneRevokesOnlyThatKey(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "A"), bnd(server, 2, "B"))
	h.u.acts = []FirmAction{{Kind: FirmForgetOne, Index: 0}}
	Run(context.Background(), h.d)
	gone := h.u.views[0].Firms[0].Key
	if len(h.keys(t)) != 1 || slices.Contains(h.keys(t), gone) || !slices.Equal(h.a.revoked, []string{gone}) {
		t.Fatalf("kayıt=%v revoke=%v", h.keys(t), h.a.revoked)
	}
	if !strings.Contains(h.u.views[1].Notice, "bu bilgisayardan unutuldu") || h.as.disabled != 0 {
		t.Fatalf("%+v disabled=%d", h.u.views[1], h.as.disabled)
	}
	h = homeSetup(t, bnd(server, 1, "A"))
	h.u.acts = []FirmAction{{Kind: FirmForgetOne, Index: 0}}
	Run(context.Background(), h.d)
	if h.as.disabled != 1 || len(h.u.hviews) != 1 || h.u.hviews[0].Support {
		t.Fatalf("son öğe: disabled=%d home=%+v", h.as.disabled, h.u.hviews)
	}
}

// TestAC254ForgetAllRevokesOwnOriginOnly "Bu bilgisayarı unut": dosya silinir, yalnız gömülü kökenin anahtarları iptal
// edilir (başka köken yerelde silinir, sunucuya gitmez), Run silinir.
func TestAC254ForgetAllRevokesOwnOriginOnly(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "A"), bnd(server, 2, "B"), bnd(other, 3, "S"))
	h.u.acts = []FirmAction{{Kind: FirmForgetAll}}
	Run(context.Background(), h.d)
	if _, ok := h.s.Load(); ok {
		t.Fatal("dosya silinmeli")
	}
	slices.Sort(h.a.revoked)
	if !slices.Equal(h.a.revoked, []string{bkey(1), bkey(2)}) || h.as.disabled != 1 {
		t.Fatalf("revoke=%v disabled=%d", h.a.revoked, h.as.disabled)
	}
	if v := h.u.hviews[0]; v.Notice != request.MsgForgotten {
		t.Fatalf("%+v", v)
	}
}

// TestGP2012StatusRenameUpdatesOnce sunucudaki ad değişince yerel güncellenir ve bir kez bilgi gösterilir.
func TestGP2012StatusRenameUpdatesOnce(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "Eski"))
	h.a.names[bkey(1)] = "Yeni"
	h.u.acts = []FirmAction{{Kind: FirmForgetOne, Index: 5}} // geçersiz dizin: yok sayılır, liste yeniden
	Run(context.Background(), h.d)
	if len(h.u.views) != 2 || h.u.views[0].Notice != "Firma adı değişti: Eski → Yeni" || h.u.views[1].Notice != "" {
		t.Fatalf("%+v", h.u.views)
	}
	if d, _ := h.s.Load(); d.Bindings[0].TenantName != "Yeni" || !d.Bindings[0].IssuedAt.Equal(t0.Add(time.Hour)) {
		t.Fatalf("%+v", d.Bindings)
	}
}

// TestAC253TogglesTrayGatesAutostart "Windows açılışında başlat" yalnız tepsi açıkken; tepsi kapanınca Run silinir;
// yükseltilmiş süreçte ikisi pasif + açıklama; ret nedeni metni gösterilir.
func TestAC253TogglesTrayGatesAutostart(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "A"))
	var got []Toggles
	h.u.onV = func(v FirmView) {
		got = append(got, v.Toggles, v.SetAutostart(true), v.SetTray(true), v.SetAutostart(true), v.SetTray(false))
	}
	Run(context.Background(), h.d)
	if got[0].Tray || got[0].AutostartEnabled || got[0].Hint != hintTrayFirst {
		t.Fatalf("başta: %+v", got[0])
	}
	if h.as.enabled != 1 || !got[3].Autostart || !got[2].AutostartEnabled || got[4].Tray || got[4].Autostart || h.as.disabled != 1 {
		t.Fatalf("%+v enabled=%d disabled=%d", got, h.as.enabled, h.as.disabled)
	}
	h = homeSetup(t, bnd(server, 1, "A"))
	h.d.Flow.SelfElevated = true
	Run(context.Background(), h.d)
	if tg := h.u.views[0].Toggles; tg.TrayEnabled || tg.AutostartEnabled || tg.Hint != autorun.ReasonElevated.Message() {
		t.Fatalf("yükseltilmiş: %+v", tg)
	}
	h = homeSetup(t, bnd(server, 1, "A"))
	h.as.state.Blocked = autorun.ReasonWeakACL
	_ = h.s.SetPrefs(remember.Prefs{Tray: true})
	Run(context.Background(), h.d)
	if tg := h.u.views[0].Toggles; !tg.Tray || tg.AutostartEnabled || tg.Hint != autorun.ReasonWeakACL.Message() {
		t.Fatalf("zayıf ACL: %+v", tg)
	}
}

// TestGP2018UnreadableOffersForgetAndNotices sınıf-2 okuma: kayıtsız gibi (firma listesi yok), "Bu bilgisayarı unut"
// kaynaksız ana ekranda; öneri ve göç engeli (G-P20-9 cümlesiyle) bilgi satırında; Verify silmesi bildirilir.
func TestGP2018UnreadableOffersForgetAndNotices(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "A"))
	h.d.Startup = &remember.MigrateResult{LoadResult: remember.LoadResult{Status: remember.StatusUnreadable, SuggestForget: true},
		Blocked: "Eski Firma"}
	h.as.verify = autorun.Check{Present: true, Removed: true, Reason: autorun.ReasonWeakACL}
	h.u.homes = []request.HomeAction{request.HomeForget}
	Run(context.Background(), h.d)
	v := h.u.hviews[0]
	if len(h.u.views) != 0 || v.Support {
		t.Fatalf("firma listesi gösterilmemeli: %+v", v)
	}
	for _, want := range []string{NoticeSuggestForget, BlockedText("Eski Firma"), NoticeOldVersion, NoticeRunRemoved} {
		if !strings.Contains(v.Notice, want) {
			t.Fatalf("eksik %q: %q", want, v.Notice)
		}
	}
	if _, ok := h.s.Load(); ok {
		t.Fatal("unut okuma durumundan bağımsız silmeli")
	}
}

// TestAC253SPK1MissingTargetNotice S-P20-K1: Run değeri bulunamayan exe'yi gösteriyordu, Verify sildi → ana ekranda
// "Windows açılışında başlatma kapatıldı: program bulunamadı; …" bilgi satırı.
func TestAC253SPK1MissingTargetNotice(t *testing.T) {
	h := homeSetup(t, bnd(server, 1, "A"))
	h.as.verify = autorun.Check{Present: true, Removed: true, Reason: autorun.ReasonMissing}
	Run(context.Background(), h.d)
	want := NoticeRunRemoved + autorun.ReasonMissing.Message() + "."
	if len(h.u.views) == 0 || !strings.Contains(h.u.views[0].Notice, want) ||
		!strings.Contains(want, "kapatıldı: program bulunamadı") {
		t.Fatalf("bilgi satırı: %+v", h.u.views)
	}
}

// TestAC254CreateTouchesBinding kayıtla talep 201 → TouchBinding (yerel sıra); kayıtsız/başarısız talepte yok.
func TestAC254CreateTouchesBinding(t *testing.T) {
	var touched []string
	o := &observedAPI{API: okCreateAPI{&fakeAPI{}}, touch: func(k string) { touched = append(touched, k) }}
	_, _ = o.CreateRequest(context.Background(), api.CreateRequestBody{BindingKey: bkey(1)})
	_, _ = o.CreateRequest(context.Background(), api.CreateRequestBody{Ref: "abcdefghijk23456"})
	o.API = &fakeAPI{} // CreateRequest hata döner
	_, _ = o.CreateRequest(context.Background(), api.CreateRequestBody{BindingKey: bkey(2)})
	if !slices.Equal(touched, []string{bkey(1)}) {
		t.Fatalf("%v", touched)
	}
}

type okCreateAPI struct{ API }

func (okCreateAPI) CreateRequest(context.Context, api.CreateRequestBody) (*api.CreateRequestResult, error) {
	return &api.CreateRequestResult{}, nil
}
