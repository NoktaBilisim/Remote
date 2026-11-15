package request

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/remember"
)

const testBindingKey = "rsb_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

func bindingDeps(a *fakeAPI, u *fakeUI, conn *fakeConn, ev chan UserAction, rem Remember) Deps {
	d := deps(a, u, conn, ev, rem)
	d.Ref, d.BindingKey = "", testBindingKey
	return d
}

var errBindingInvalid = &api.Error{Status: 404, Code: "BINDING_INVALID"}

// TestAC190NoSourceReturnsHome kaynaksız talep yoktur (AC-190 ana ekranda, launch): ağ isteği yapmadan ana ekrana döner.
func TestAC190NoSourceReturnsHome(t *testing.T) {
	a, u := &fakeAPI{}, newUI()
	d := deps(a, u, nil, nil, nil)
	d.Ref = ""
	if o := Run(context.Background(), d); o.Kind != OutBack || o.Notice != "" || len(u.views) != 0 {
		t.Fatalf("%+v views=%d", o, len(u.views))
	}
	if len(a.statusKeys) != 0 || len(a.bodies) != 0 {
		t.Fatal("kaynaksız talepte ağ isteği olmamalı")
	}
}

// TestAC182BindingModeRequestUsesKeyNoRefNoDeviceKey kayıtla talep: ana ekran yok (doğrudan form), status anahtarla,
// talep gövdesinde bindingKey (ref yok), "hatırla" açıkken bile deviceKey yok (G-E10-5).
func TestAC182BindingModeRequestUsesKeyNoRefNoDeviceKey(t *testing.T) {
	a, u, conn, ev := &fakeAPI{customer: "Örnek‮ A.Ş."}, newUI(), newConn(), make(chan UserAction, 4)
	rem := &memRemember{}
	f := goodForm
	f.Remember, f.RememberChosen = true, true
	u.forms = []func(FormView) (FormAction, Form){submit(f)}
	d := bindingDeps(a, u, conn, ev, rem)
	d.BindingEnabled = true
	out := runAsync(d)
	connected(t, u, conn)
	ev <- UserClose
	wait(t, out)
	if len(a.statusKeys) != 1 || a.statusKeys[0] != testBindingKey {
		t.Fatalf("status: %v", a.statusKeys)
	}
	if v := u.views[0]; v.Tenant != "Demo Firma" {
		t.Fatalf("form: %+v", v)
	}
	b := a.bodies[0]
	if b.BindingKey != testBindingKey || b.Ref != "" || b.DeviceKey != "" {
		t.Fatalf("gövde: %+v", b)
	}
	if rem.d == nil || rem.d.DeviceKey == "" {
		t.Fatal("kişisel bilgiler yine hatırlanır (anahtar dosyada kalır, gönderilmez)")
	}
	if u.views[0].RememberNote != remember.NoticeText("Demo Firma") {
		t.Fatalf("AC-188 form bilgi satırı: %q", u.views[0].RememberNote)
	}
}

// TestAC185StatusInvalidClearsBindingKeepsPersonal açılışta BINDING_INVALID → kayıt silinir, form açılmaz, ana ekrana
// (firma listesi) AC-185 metniyle dönülür; kişisel bilgiler kalır (sonraki kullanım için).
func TestAC185StatusInvalidClearsBindingKeepsPersonal(t *testing.T) {
	a, u := &fakeAPI{statusErr: []error{errBindingInvalid}}, newUI()
	rem := &memRemember{d: &remember.Personal{Name: "Ayşe", Phone: "+905321234567", DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"}}
	cleared := 0
	d := bindingDeps(a, u, nil, nil, rem)
	d.OnBindingInvalid = func() { cleared++ }
	o := Run(context.Background(), d)
	if o.Kind != OutBack || o.Notice != MsgBindingInvalid || len(u.views) != 0 {
		t.Fatalf("%+v views=%d", o, len(u.views))
	}
	if cleared != 1 || rem.d == nil || rem.forgot != 0 {
		t.Fatalf("cleared=%d rem=%+v", cleared, rem.d)
	}
}

// TestAC188FormNoteOnlyWhenBindingEnabled kayıt alınamayacaksa (depo yok / köken kanonik değil) form satırı boş.
func TestAC188FormNoteOnlyWhenBindingEnabled(t *testing.T) {
	for _, on := range []bool{false, true} {
		u := newUI()
		d := deps(&fakeAPI{}, u, nil, nil, nil)
		d.BindingEnabled = on
		Run(context.Background(), d)
		if got := u.views[0].RememberNote; (got != "") != on {
			t.Fatalf("BindingEnabled=%v: %q", on, got)
		}
	}
}

// TestBP8c21Status404WithoutCodeKeepsBinding B-P8c2-1: kodsuz/başka kodlu 404 (geri alınmış sunucu, proxy) kaydı
// silmez; bugünkü ağ/sunucu engel ekranı gösterilir.
func TestBP8c21Status404WithoutCodeKeepsBinding(t *testing.T) {
	for _, e := range []error{&api.Error{Status: 404, Code: "NOT_FOUND"}, &api.Error{Status: 404, Code: "UNKNOWN"}} {
		u := newUI()
		cleared := 0
		d := bindingDeps(&fakeAPI{statusErr: []error{e}}, u, nil, nil, nil)
		d.OnBindingInvalid = func() { cleared++ }
		Run(context.Background(), d)
		if cleared != 0 || len(u.probSeen) != 1 || len(u.views) != 0 {
			t.Fatalf("%v: cleared=%d probs=%+v forms=%d", e, cleared, u.probSeen, len(u.views))
		}
	}
}

// TestAC185CreateInvalidReturnsToHome talep oluşturmada BINDING_INVALID → form kapanır, ana ekrana AC-185 metniyle.
func TestAC185CreateInvalidReturnsToHome(t *testing.T) {
	a, u := &fakeAPI{createErrs: []error{errBindingInvalid}}, newUI()
	u.forms = []func(FormView) (FormAction, Form){submit(goodForm)}
	cleared := 0
	d := bindingDeps(a, u, nil, nil, nil)
	d.OnBindingInvalid = func() { cleared++ }
	if o := Run(context.Background(), d); o.Kind != OutBack || o.Notice != MsgBindingInvalid {
		t.Fatalf("%+v", o)
	}
	if cleared != 1 || len(u.views) != 1 {
		t.Fatalf("cleared=%d forms=%d", cleared, len(u.views))
	}
}

// TestAC182PreloadedRefInfoNotRefetched launch'ın aldığı firma bilgisi tekrar istenmez; ilk hata (dosya geçersiz)
// "Bağlantı kodum var" seçenekli engel ekranıdır (satır 6).
func TestAC182PreloadedRefInfoNotRefetched(t *testing.T) {
	a, u := &fakeAPI{infoErr: []error{errors.New("çağrılmamalı")}}, newUI()
	info := &api.TenantRequestInfo{WaitMinutes: 30}
	info.Tenant.Name = "Önden Firma"
	d := deps(a, u, nil, nil, nil)
	d.Info = info
	Run(context.Background(), d)
	if len(u.views) == 0 || u.views[0].Tenant != "Önden Firma" {
		t.Fatalf("%+v", u.views)
	}
	u2 := newUI()
	d2 := deps(&fakeAPI{}, u2, nil, nil, nil)
	d2.InfoErr = &api.Error{Status: 404, Code: "REQUEST_REF_INVALID"}
	u2.problems = []ProblemAction{ProblemCodeMode}
	if o := Run(context.Background(), d2); o.Kind != OutCodeMode || !u2.probSeen[0].CodeMode || u2.probSeen[0].Message != msgRefGone {
		t.Fatalf("%+v %+v", o, u2.probSeen)
	}
}

// TestAC189OutdatedInBindingModeNoDownload kayıt modunda eski sürüm: indirme düğmesi yok (sabit indirme adresi ref ister).
func TestAC189OutdatedInBindingModeNoDownload(t *testing.T) {
	u := newUI()
	Run(context.Background(), bindingDeps(&fakeAPI{statusErr: []error{&api.Error{Status: 426, Code: "CLIENT_OUTDATED"}}}, u, nil, nil, nil))
	if len(u.probSeen) != 1 || u.probSeen[0].Message != msgOutdated || u.probSeen[0].Download {
		t.Fatalf("%+v", u.probSeen)
	}
}

func TestAC171ClosedReasonsCustomerPassiveBindingRevoked(t *testing.T) {
	for _, r := range []string{"CUSTOMER_PASSIVE", "BINDING_REVOKED"} {
		reason := r
		v := closedView(Closed{Status: "CANCELLED", Reason: &reason})
		if v.Message != msgFirmClosed || v.Recreate {
			t.Fatalf("%s: %+v", r, v)
		}
	}
}

func TestAC185MessagesMatchContractsFixture(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "bindings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Messages map[string]string `json:"messages"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if f.Messages["invalid"] != MsgBindingInvalid || f.Messages["forgotten"] != MsgForgotten || f.Messages["noSource"] != MsgNoSource {
		t.Fatalf("metinler fixture ile aynı olmalı: %v", f.Messages)
	}
}
