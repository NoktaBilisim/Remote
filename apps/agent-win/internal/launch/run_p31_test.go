package launch

import (
	"context"
	"strings"
	"testing"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/flow"
)

const macRef = "abcdefghijk23456"

// macSetup macOS açılışı (mimari-p31 K-P31-5): Exe yok, kaynak Deps.Source'tan, Store=nil, SourceHint dolu.
func macSetup(t *testing.T, src Source) *env {
	e := setup(t, "", nil)
	e.d.Store = nil
	e.d.Source = &src
	e.d.SourceHint = NoticeMacFolder
	return e
}

// TestAC513MacSourceDecisions P31 AC-513: macOS aynı karar tablosunu kayıtsız uygular: geçerli firma klasörü → dosyanın
// firması satırı (tek satır, seçili), geçersiz ref → NoticeRefGone, geçerli kod → kod akışı (ana ekran yok), süresi
// dolmuş kod → ana ekran + bugünkü mesaj; kaynaksız → AC-190 + Mac bilgi satırı. Mac satırı yalnız kaynaksızken.
func TestAC513MacSourceDecisions(t *testing.T) {
	e := macSetup(t, Source{Ref: macRef})
	Run(context.Background(), e.d)
	if v := e.u.views[0]; len(v.Firms) != 1 || !v.Firms[0].File || !v.Single || v.Firms[0].Text != "Bu dosyanın firması: Ref Firma" ||
		v.Notice != "" || !v.Toggles.AutostartHidden || v.Toggles.TrayEnabled || len(v.Others) != 0 {
		t.Fatalf("firma klasörü: %+v", v)
	}
	e = macSetup(t, Source{Ref: macRef})
	e.a.infoErr = &api.Error{Status: 404, Code: "REQUEST_REF_INVALID"}
	Run(context.Background(), e.d)
	if v := e.u.views[0]; v.Notice != NoticeRefGone || len(v.Firms) != 0 {
		t.Fatalf("geçersiz ref: %+v", v)
	}
	e = macSetup(t, Source{Code: "12345678"})
	Run(context.Background(), e.d)
	if e.a.resolves != 1 || len(e.fu.welcomes) != 1 || len(e.u.views) != 0 {
		t.Fatalf("kod: resolve=%d welcome=%d home=%d", e.a.resolves, len(e.fu.welcomes), len(e.u.views))
	}
	e = macSetup(t, Source{Code: "12345678"})
	e.a.resolveErr = &api.Error{Status: 410, Code: "SESSION_EXPIRED"}
	Run(context.Background(), e.d)
	m := flow.ResolveMessage(e.a.resolveErr)
	if v := e.u.views[0]; v.Notice != m.Title+". "+m.Body || len(v.Firms) != 0 || strings.Contains(v.Notice, NoticeMacFolder) {
		t.Fatalf("süresi dolmuş kod: %+v", v)
	}
	e = macSetup(t, Source{})
	e.u.acts = []FirmAction{{Kind: FirmCode}}
	Run(context.Background(), e.d)
	if v := e.u.views[0]; v.Notice != NoticeMacFolder || len(v.Firms) != 0 || e.a.infos != 0 || e.a.resolves != 0 || e.fu.asked != 1 {
		t.Fatalf("kaynaksız: %+v asked=%d", v, e.fu.asked)
	}
}

// TestAC513SourceOverridesExeName Deps.Source verildiyse Exe adı okunmaz (Windows'ta nil: bugünkü yol); Windows
// kaynaksız açılışında SourceHint boş olduğundan bilgi satırı değişmez.
func TestAC513SourceOverridesExeName(t *testing.T) {
	e := setup(t, refFile, nil)
	e.d.Source = &Source{}
	Run(context.Background(), e.d)
	if v := e.u.views[0]; len(v.Firms) != 0 || e.a.infos != 0 {
		t.Fatalf("Source boşken dosya adı okunmamalı: %+v", v)
	}
	e = setup(t, bareFile, nil)
	Run(context.Background(), e.d)
	if v := e.u.views[0]; v.Notice != "" {
		t.Fatalf("Windows kaynaksız bilgi satırı değişmemeli: %q", v.Notice)
	}
}

// TestAC513MacAbuseEmailOnHome P31 AC-513: ana ekranda "Kötüye kullanımı bildir" yalnız dosyanın firmasının adresi
// tanımlıysa (FirmView.AbuseEmail); kaynaksızken boş.
func TestAC513MacAbuseEmailOnHome(t *testing.T) {
	e := macSetup(t, Source{Ref: macRef})
	e.d.API = abuseAPI{e.a}
	Run(context.Background(), e.d)
	if v := e.u.views[0]; v.AbuseEmail != "abuse@firma.example" {
		t.Fatalf("adres: %q", v.AbuseEmail)
	}
	e = macSetup(t, Source{})
	Run(context.Background(), e.d)
	if e.u.views[0].AbuseEmail != "" {
		t.Fatal("kaynaksızken adres olmamalı")
	}
}

type abuseAPI struct{ *fakeAPI }

func (a abuseAPI) TenantInfo(ctx context.Context, ref string) (*api.TenantRequestInfo, error) {
	i, err := a.fakeAPI.TenantInfo(ctx, ref)
	if i != nil {
		s := "abuse@firma.example"
		i.AbuseEmail = &s
	}
	return i, err
}

// TestAC517MacNoStoreNoBindingNoRemember P31 AC-517 (Go birim): Store=nil iken kayıt alınmaz (flow.Deps.Binding nil →
// karşılamada AC-188 satırı yok) ve talep formunda hatırla/kayıt satırı yok (Remember nil → diske yazma yok).
func TestAC517MacNoStoreNoBindingNoRemember(t *testing.T) {
	e := macSetup(t, Source{Code: "12345678"})
	Run(context.Background(), e.d)
	if e.fu.welcomes[0].RememberNote != "" {
		t.Fatalf("kod akışında kayıt satırı: %q", e.fu.welcomes[0].RememberNote)
	}
	e = macSetup(t, Source{Ref: macRef})
	e.u.acts = []FirmAction{{Kind: FirmSupport, Index: 0}}
	Run(context.Background(), e.d)
	if len(e.ru.fviews) != 1 || e.ru.fviews[0].RememberNote != "" || e.ru.fviews[0].Remembered {
		t.Fatalf("form: %+v", e.ru.fviews)
	}
	rd := e.d.baseRequest()
	if rd.Remember != nil || rd.BindingEnabled {
		t.Fatalf("talep deposu: remember=%v binding=%v", rd.Remember, rd.BindingEnabled)
	}
}
