//go:build windows

package ui

import (
	"context"
	"fmt"
	"strings"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// AskCode AC-97: dosya adından kod okunamazsa elle giriş.
func (u *UI) AskCode(ctx context.Context, notice string) (string, bool) {
	ch := make(chan textResult, 1)
	u.t.Do(func() {
		f := u.t.newForm(appTitle, 460, 232, false)
		f.label("Uzaktan destek", 16, 16, 428, 24, fontBold)
		f.label("Teknisyeninizin verdiği 8 haneli destek kodunu girin.", 16, 46, 428, 20, fontNormal)
		e := f.edit(0, 16, 72, 200, 28, win.ES_AUTOHSCROLL, 16)
		f.danger(notice, 16, 108, 428, 40, fontNormal)
		f.button("Devam", idOK, 260, 154, 90, true)
		f.button("Kapat", idCancel, 356, 154, 88, false)
		f.label(u.footer, 16, 200, 428, 20, fontNormal)
		done := func(r textResult) { f.destroy(); ch <- r }
		f.command = func(id, _ int) {
			switch id {
			case idOK:
				done(textResult{win.GetText(e.h), true})
			case idCancel:
				done(textResult{})
			}
		}
		f.close = func() { done(textResult{}) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, e)
	})
	r := await(ctx, ch, textResult{})
	return r.text, r.ok
}

// Welcome AC-98/125/128: teknisyen, doğrulama kodu, sunucu, dolandırıcılık uyarısı, KVKK onayı.
func (u *UI) Welcome(ctx context.Context, w flow.Welcome) (string, bool) {
	w.RecOffered = false
	name, _, ok := u.WelcomeRec(ctx, w)
	return name, ok
}

// welcomeResult karşılama kararı; record P28e kayıt kutusu (yalnız w.RecOffered iken çizilir).
type welcomeResult struct {
	name       string
	record, ok bool
}

// WelcomeRec flow.RecUI: Welcome + P28e kayıt rıza kutusu (AC-381; varsayılan işaretsiz, seçim yalnız bellekte).
func (u *UI) WelcomeRec(ctx context.Context, w flow.Welcome) (string, bool, bool) {
	ch := make(chan welcomeResult, 1)
	u.t.Do(func() { u.welcomeForm(w, ch) })
	r := await(ctx, ch, welcomeResult{})
	return r.name, r.record, r.ok
}

// welcomeForm karşılama penceresi: tanıtım ve aydınlatma metni (welcomeIntro), ad, onay kutusu, (teklif varsa) kayıt
// kutusu, Bağlan/Vazgeç.
func (u *UI) welcomeForm(w flow.Welcome, ch chan<- welcomeResult) {
	shift := int32(0)
	if w.RecOffered {
		shift = 44
	}
	f := u.t.newForm(appTitle+" — Karşılama", 520, 652+shift+retentionRow, false)
	welcomeIntro(f, w)
	f.label("Adınız ve soyadınız (teknisyeniniz sizi bu adla görür)", 16, 462, 488, 20, fontNormal)
	name := f.edit(idName, 16, 484, 300, 28, win.ES_AUTOHSCROLL, 100)
	chk := f.add("BUTTON", "Aydınlatma metnini okudum; ekran görüntümün bu oturum boyunca teknisyenle "+
		"paylaşılmasını kabul ediyorum. Uzaktan kontrol için ayrıca onay istenir.",
		win.WS_TABSTOP|win.BS_AUTOCHECKBOX|win.BS_MULTILINE, 0, idConsent, 16, 520, 488, 52, fontNormal)
	var rec *ctrl
	if w.RecOffered { // P28e: ayrı, işaretsiz kutu; metin derlemedeki cümle (SHA sunucununkiyle eşleşti)
		rec = f.add("BUTTON", flow.RecTexts.ConsentLine, win.WS_TABSTOP|win.BS_AUTOCHECKBOX|win.BS_MULTILINE, 0,
			idRecConsent, 16, 578, 488, 36, fontNormal)
	}
	// AC-292: saklama satırı onay düğmesinin HEMEN üstünde (kayıt kutusunun altında); düğme yalnız satır çizildiyse.
	ready := retentionLine(f, w.ChatRetentionDays, 16, 584+shift, 488)
	shift += retentionRow
	connect := f.button("Bağlan", idOK, 318, 584+shift, 90, true)
	f.button("Vazgeç", idCancel, 414, 584+shift, 90, false)
	f.label(u.footer, 16, 626+shift, 488, 20, fontNormal)
	win.EnableWindow(connect.h, false)
	valid := func() bool {
		return ready && win.SendMessage(chk.h, win.BM_GETCHECK, 0, 0) == 1 && strings.TrimSpace(win.GetText(name.h)) != ""
	}
	done := func(r welcomeResult) { f.destroy(); ch <- r }
	f.command = func(id, code int) {
		switch {
		case id == idConsent || (id == idName && code == win.EN_CHANGE):
			win.EnableWindow(connect.h, valid())
		case id == idAbuse:
			win.OpenMailto(w.AbuseEmail)
		case id == idOK && valid(): // AC-98: onaysız bağlantı başlamaz
			done(welcomeResult{strings.TrimSpace(win.GetText(name.h)), rec != nil && checked(rec), true})
		case id == idCancel:
			done(welcomeResult{})
		}
	}
	f.close = func() { done(welcomeResult{}) }
	f.show(win.WorkAreaAt(win.CursorPos()), true, name)
}

// welcomeIntro karşılamanın üst bölümü: başlık, teknisyen ve doğrulama kodu, logo, sunucu, dolandırıcılık uyarısı,
// kötüye kullanım düğmesi, aydınlatma metni ve kayıt notu.
func welcomeIntro(f *form, w flow.Welcome) {
	f.label("Uzaktan destek bağlantısı", 16, 14, 488, 30, fontBig)
	f.label(w.Tenant+" teknisyeni sizinle uzaktan destek oturumu başlatmak istiyor.", 16, 50, 488, 20, fontNormal)
	f.label("Teknisyen: "+w.TechName, 16, 74, 352, 20, fontBold)
	f.label("Teknisyen doğrulama kodu: "+w.TechVerifyCode, 16, 98, 352, 20, fontBold)
	f.label("Telefondaki teknisyen de bu kodu söylemeli.", 16, 120, 352, 20, fontNormal)
	// AC-98: firma logosu (flow yalnız gömülü sunucu kökeninden indirir); yoksa sistem logosu (Nokta).
	f.picture(orSystemLogo(w.Logo), 376, 72, 128, 68)
	f.label("Bağlanılan sunucu: "+w.Host, 16, 144, 488, 20, fontNormal)
	f.danger("Sizi biz aramadıysak devam etmeyin", 16, 172, 488, 20, fontBold)
	f.danger("Sizi kendiliğinden arayan biri bunu istediyse kapatın; banka veya şifre işlemi yapmayın. "+
		"Teknisyenimiz şifrenizi hiçbir zaman sormaz.", 16, 194, 488, 38, fontNormal)
	if w.AbuseEmail != "" {
		f.button("Kötüye kullanımı bildir", idAbuse, 16, 236, 200, false)
	}
	f.danger(w.Notice, 224, 236, 280, 30, fontNormal)
	f.label(fmt.Sprintf("Aydınlatma metni (sürüm %d)", w.ConsentVersion), 16, 272, 488, 20, fontBold)
	consent := f.edit(0, 16, 294, 488, 120, win.ES_MULTILINE|win.ES_READONLY|win.ES_AUTOVSCROLL|win.WS_VSCROLL, 0)
	win.SetText(consent.h, crlf(w.ConsentBody))
	f.label(w.RememberNote, 16, 420, 488, 36, fontNormal) // AC-188 (kayıt kapalıysa boş)
}

// retentionRow AC-292 saklama satırının kapladığı yükseklik (karşılama ve talep formu).
const retentionRow = 26

// retentionLine AC-292 (mimari-p22 §9): uicore.RetentionText satırını çizer ve geri okur; dönen değer
// uicore.ConsentReady (gün ≥ 1 ve satır gerçekten çizildi). Alan yok/0 → "Sunucu güncel değil" (danger) ve false.
func retentionLine(f *form, days int, x, y, w int32) bool {
	text := uicore.RetentionText(days)
	var l *ctrl
	if days < 1 {
		l = f.danger(text, x, y, w, 20, fontNormal)
	} else {
		l = f.label(text, x, y, w, 20, fontNormal)
	}
	return uicore.ConsentReady(days, l != nil && l.h != 0 && uicore.RetentionDrawn(days, win.GetText(l.h)))
}
