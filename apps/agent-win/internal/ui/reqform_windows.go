//go:build windows

package ui

import (
	"context"
	"fmt"

	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/win"
)

type formResult struct {
	act  request.FormAction
	form request.Form
}

type reqForm struct {
	f                            *form
	name, phone, email, desc     *ctrl
	consent, remember            *ctrl
	errs                         map[string]*ctrl
	hint, notice                 *ctrl
	submit, code, forget, closeB *ctrl
	pending                      chan formResult
	// chosen müşteri "hatırla" kutusuna bu oturumda kendisi dokundu (S8b2-1); filling programatik SetText sürüyor
	// (EN_CHANGE müşteri düzenlemesi sayılmaz).
	chosen, filling bool
	// abuseEmail "Kötüye kullanımı bildir" adresi (FormView.AbuseEmail; boşsa düğme yok).
	abuseEmail string
}

// RequestForm AC-133..137, 164: firma penceresi + form. Tab sırası oluşturma sırasıdır ((varsa) kötüye kullanımı
// bildir → ad → telefon → e-posta → açıklama → aydınlatma metni → onay → hatırla → unut → Destek iste → Bağlantı kodum
// var → kapat);
// pencere ad alanında odakla açılır. Enter "Destek iste"yi tetikler (açıklama alanı ES_WANTRETURN'süz çok satırlı:
// Enter varsayılan düğmeye gider). S8b2-1: müşteri kutuya dokunmadıysa ad/telefon değişince (EN_CHANGE) "hatırla"
// işaretsize çekilir; hatırlanan başka kişinin kutusu yeni kişinin verisini onaysız diske yazdırmaz.
func (u *UI) RequestForm(ctx context.Context, v request.FormView) (request.FormAction, request.Form) {
	ch := make(chan formResult, 1)
	u.t.Do(func() {
		if u.reqForm == nil {
			u.reqForm = u.newReqForm(v)
		}
		u.reqForm.update(v, ch)
	})
	r := await(ctx, ch, formResult{act: request.FormClose})
	return r.act, r.form
}

// newReqForm firma penceresi: başlık ve uyarı, alanlar (addFields), onay ve hatırlama (addConsent), düğmeler.
func (u *UI) newReqForm(v request.FormView) *reqForm {
	f := u.t.newForm(appTitle+" — "+v.Tenant, 540, 730, false)
	r := &reqForm{f: f, errs: map[string]*ctrl{}, abuseEmail: v.AbuseEmail}
	f.picture(orSystemLogo(v.Logo), 396, 8, 128, 56)
	f.label(v.Tenant, 16, 10, 370, 32, fontBig) // yalnız sunucudan gelen firma adı (G-E9-11)
	f.label(fmt.Sprintf("Uzaktan destek talebi · yanıt bekleme süresi en çok %d dk", v.WaitMinutes), 16, 46, 370, 20, fontNormal)
	f.danger(fraudText, 16, 70, 508, 36, fontNormal)
	if v.AbuseEmail != "" { // Tab sırasında uyarının hemen ardından (QA önerisi)
		f.button("Kötüye kullanımı bildir", idAbuse, 16, 110, 200, false)
	}
	r.addFields()
	r.addConsent(v)
	r.notice = f.danger("", 16, 614, 508, 36, fontNormal)
	r.submit = f.button("Destek iste", idOK, 16, 656, 140, true)
	r.code = f.button("Bağlantı kodum var", idReqCode, 164, 656, 190, false)
	r.closeB = f.button("Kapat", idCancel, 434, 656, 90, false)
	f.label(u.footer, 16, 700, 508, 20, fontNormal) // sunucu + sürüm + SHA-256 ilk 8 (AC-133)
	f.command = r.command
	f.close = func() { r.reply(request.FormClose) }
	f.show(win.WorkAreaAt(win.CursorPos()), true, r.name)
	return r
}

// field etiket + tek satır alan + altında hata satırı (errs[key]).
func (r *reqForm) field(label string, id int, y int32, key string, limit int) *ctrl {
	f := r.f
	f.label(label, 16, y+3, 130, 20, fontNormal)
	e := f.edit(id, 150, y, 374, 24, win.ES_AUTOHSCROLL, limit)
	r.errs[key] = f.danger("", 150, y+26, 374, 18, fontNormal)
	return e
}

// addFields ad, telefon, e-posta ve sorun açıklaması (hata satırlarıyla).
func (r *reqForm) addFields() {
	f := r.f
	r.name = r.field("Ad soyad", idReqName, 146, request.FieldName, 100)
	r.phone = r.field("Telefon", idReqPhone, 192, request.FieldPhone, 40)
	r.email = r.field("E-posta (isteğe bağlı)", idReqEmail, 238, request.FieldEmail, 254)
	f.label("Sorununuz", 16, 287, 130, 20, fontNormal)
	r.desc = f.edit(idReqDesc, 150, 284, 374, 52, win.ES_MULTILINE|win.ES_AUTOVSCROLL|win.WS_VSCROLL, 600)
	r.errs[request.FieldDescription] = f.danger("", 150, 338, 374, 18, fontNormal)
}

// addConsent aydınlatma metni, kayıt notu (AC-188), KVKK onayı, "hatırla", "Bilgilerimi unut" ve ipucu.
func (r *reqForm) addConsent(v request.FormView) {
	f := r.f
	f.label(fmt.Sprintf("Aydınlatma metni (sürüm %d)", v.ConsentVersion), 16, 360, 508, 20, fontBold)
	text := f.edit(0, 16, 382, 508, 80, win.ES_MULTILINE|win.ES_READONLY|win.ES_AUTOVSCROLL|win.WS_VSCROLL, 0)
	win.SetText(text.h, crlf(v.ConsentBody))
	f.label(v.RememberNote, 16, 466, 508, 36, fontNormal) // AC-188: KVKK onayının üstünde
	r.consent = f.add("BUTTON", "Aydınlatma metnini okudum; bilgilerimin destek talebi için işlenmesini kabul ediyorum. "+
		"Ekran paylaşımı için teknisyen bağlanırken ayrıca onay istenir.",
		win.WS_TABSTOP|win.BS_AUTOCHECKBOX|win.BS_MULTILINE, 0, idReqConsent, 16, 506, 508, 36, fontNormal)
	r.errs[request.FieldConsent] = f.danger("", 16, 542, 508, 18, fontNormal)
	r.remember = f.add("BUTTON", "Bilgilerimi bu bilgisayarda hatırla", win.WS_TABSTOP|win.BS_AUTOCHECKBOX, 0,
		idReqRemember, 16, 566, 300, 22, fontNormal)
	r.forget = f.button("Bilgilerimi unut", idReqForget, 374, 563, 150, false)
	r.hint = f.label("Bu bilgiler size ait değilse: Bilgilerimi unut", 16, 592, 508, 18, fontNormal)
}

// reply bekleyen RequestForm çağrısına alanların o anki değerleriyle yanıt verir (gönderim sürüyorsa yok sayılır).
func (r *reqForm) reply(act request.FormAction) {
	if r.pending == nil {
		return // gönderim sürüyor
	}
	res := formResult{act: act, form: request.Form{Name: win.GetText(r.name.h), Phone: win.GetText(r.phone.h),
		Email: win.GetText(r.email.h), Description: win.GetText(r.desc.h), Consent: checked(r.consent),
		Remember: checked(r.remember), RememberChosen: r.chosen}}
	ch := r.pending
	r.pending = nil
	r.busy(true)
	ch <- res
}

func (r *reqForm) command(id, code int) {
	switch id {
	case idReqName, idReqPhone:
		if code == win.EN_CHANGE && !r.filling && !r.chosen {
			setChecked(r.remember, false)
		}
	case idReqRemember:
		if code == win.BN_CLICKED {
			r.chosen = true
		}
	case idOK:
		r.reply(request.FormSubmit)
	case idReqForget:
		r.reply(request.FormForget)
	case idReqCode:
		r.reply(request.FormCodeMode)
	case idCancel:
		r.reply(request.FormClose)
	case idAbuse:
		win.OpenMailto(r.abuseEmail)
	}
}

func (r *reqForm) busy(on bool) {
	for _, c := range []*ctrl{r.submit, r.code, r.forget} {
		win.EnableWindow(c.h, !on)
	}
}

func (r *reqForm) update(v request.FormView, ch chan formResult) {
	r.filling = true // WM_COMMAND EN_CHANGE SetText içinde eşzamanlı gelir
	win.SetText(r.name.h, v.Values.Name)
	win.SetText(r.phone.h, v.Values.Phone)
	win.SetText(r.email.h, v.Values.Email)
	win.SetText(r.desc.h, v.Values.Description)
	r.filling = false
	setChecked(r.consent, v.Values.Consent)
	setChecked(r.remember, v.Values.Remember)
	r.chosen = v.Values.RememberChosen
	for k, c := range r.errs {
		win.SetText(c.h, v.Errors[k])
	}
	win.SetText(r.notice.h, v.Notice)
	hint := win.SW_HIDE
	if v.Remembered {
		hint = win.SW_SHOWNORMAL
	}
	win.ShowWindow(r.hint.h, hint)
	r.pending = ch
	r.busy(false)
	focus := map[string]*ctrl{request.FieldName: r.name, request.FieldPhone: r.phone, request.FieldEmail: r.email,
		request.FieldDescription: r.desc, request.FieldConsent: r.consent}[v.Focus]
	if focus == nil {
		focus = r.name
	}
	win.SetFocus(focus.h) // AC-164: hata alanına odak
}

// RequestFormBusy gönderim sürerken bilgi satırı (düğmeler devre dışı).
func (u *UI) RequestFormBusy(notice string) {
	u.t.Do(func() {
		if r := u.reqForm; r != nil {
			win.SetText(r.notice.h, notice)
			r.busy(true)
		}
	})
}

// RequestFormClose firma penceresini kapatır.
func (u *UI) RequestFormClose() {
	u.t.Do(func() {
		if u.reqForm != nil {
			u.reqForm.f.destroy()
			u.reqForm = nil
		}
	})
}
