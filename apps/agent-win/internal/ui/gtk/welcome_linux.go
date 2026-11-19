//go:build linux

package gtk

import (
	"context"
	"fmt"
	"strings"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

// Welcome AC-98/125/128.
func (u *UI) Welcome(ctx context.Context, w flow.Welcome) (string, bool) {
	w.RecOffered = false
	name, _, ok := u.WelcomeRec(ctx, w)
	return name, ok
}

type welcomeResult struct {
	name       string
	record, ok bool
}

// WelcomeRec flow.RecUI: karşılama + KVKK + P28e kayıt rıza kutusu (varsayılan işaretsiz; korunan denetim — yalnız
// yerel tıklamayla çevrilir, durum Go değişkeninden okunur, §5.2a).
func (u *UI) WelcomeRec(ctx context.Context, w flow.Welcome) (string, bool, bool) {
	ch := make(chan welcomeResult, 1)
	u.do(func() { u.welcomeForm(w, ch) })
	r := await(ctx, ch, welcomeResult{})
	return r.name, r.record, r.ok
}

func (u *UI) welcomeForm(w flow.Welcome, ch chan<- welcomeResult) {
	f := u.newForm(uicore.AppTitle+" — Karşılama", 560)
	head := f.row()
	left := gtkBoxNew(orientV, 4)
	gtkBoxPackStart(head, left, true, true, 0)
	l := newLabel("Uzaktan destek bağlantısı", clsLabel)
	setBold(l)
	add(left, l)
	add(left, newLabel(w.Tenant+" teknisyeni sizinle uzaktan destek oturumu başlatmak istiyor.", clsLabel))
	for _, t := range []string{"Teknisyen: " + w.TechName, "Teknisyen doğrulama kodu: " + w.TechVerifyCode} {
		x := newLabel(t, clsLabel)
		setBold(x)
		add(left, x)
	}
	add(left, newLabel("Telefondaki teknisyen de bu kodu söylemeli.", clsLabel))
	logo := w.Logo
	if logo == nil {
		logo = uicore.SystemLogo()
	}
	// Logo zemini temadan bağımsız açık (logo-surface): siyah "nokta" yazısı koyu temada da okunur.
	picture(head, logo, 128, 68, uicore.ThemePalette(u.dark).LogoBg)
	f.label("Bağlanılan sunucu: " + w.Host)
	setBold(f.danger("Sizi biz aramadıysak devam etmeyin"))
	f.danger("Sizi kendiliğinden arayan biri bunu istediyse kapatın; banka veya şifre işlemi yapmayın. " +
		"Teknisyenimiz şifrenizi hiçbir zaman sormaz.")
	if addr := uicore.MailtoAddr(w.AbuseEmail); addr != "" {
		f.button(f.row(), "Kötüye kullanımı bildir", func() { openURI(f.win, "mailto:"+addr) })
	}
	if w.Notice != "" {
		f.danger(w.Notice)
	}
	f.heading(fmt.Sprintf("Aydınlatma metni (sürüm %d)", w.ConsentVersion))
	f.textView(120, w.ConsentBody)
	if w.RememberNote != "" {
		f.label(w.RememberNote)
	}
	f.label("Adınız ve soyadınız (teknisyeniniz sizi bu adla görür)")
	var connect, name, consent uintptr
	valid := func() bool { return consent != 0 && checked(consent) && strings.TrimSpace(entryText(name)) != "" }
	refresh := func() {
		if connect != 0 {
			enable(connect, valid())
		}
	}
	record := false
	done := func(r welcomeResult) {
		if f.closed {
			return
		}
		f.destroy()
		ch <- r
	}
	submit := func() {
		if valid() { // AC-98: onaysız bağlantı başlamaz
			done(welcomeResult{uicore.TrimRunes(strings.TrimSpace(entryText(name)), 100), record && w.RecOffered, true})
		}
	}
	name = f.field(f.row(), 100, submit, refresh)
	consent = f.check("Aydınlatma metnini okudum; ekran görüntümün bu oturum boyunca teknisyenle paylaşılmasını "+
		"kabul ediyorum. Uzaktan kontrol için ayrıca onay istenir.", refresh)
	if w.RecOffered {
		f.protectedCheck(flow.RecTexts.ConsentLine, func() bool { return record }, func(k clickKind) {
			if k == clickLocal {
				record = !record
			}
		})
	}
	b := f.row()
	connect = f.button(b, "Bağlan", submit)
	gtkWidgetSetCanDefault(connect, true)
	gtkWindowSetDefault(f.win, connect)
	f.button(b, "Vazgeç", func() { done(welcomeResult{}) })
	f.label(u.footer)
	enable(connect, false)
	f.onX = func() { done(welcomeResult{}) }
	f.show(name)
}
