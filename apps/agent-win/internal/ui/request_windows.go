//go:build windows

package ui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/win"
)

// P8b-2 talep modu ekranları (request.UI). Sunucudan gelen tüm metinler (firma adı, teknisyen adı, ret mesajı) statik
// metin denetimiyle `SS_NOPREFIX` gösterilir (f.label); bağlantıya çevrilmez (G-E9-12, T38). Bu metinler request
// paketinde request.Display ile Cc/Cf/bidi karakterlerinden süzülmüş gelir (S8b2-3).

const (
	idReqName     = 60
	idReqPhone    = 61
	idReqEmail    = 62
	idReqDesc     = 63
	idReqConsent  = 64
	idReqRemember = 65
	idReqForget   = 66
	idReqCode     = 67
	idReqDownload = 68
)

const fraudText = "Bu pencereyi yalnız firmanızdan destek istemek için kullanın. Sizi kendiliğinden arayan biri bunu " +
	"istediyse kapatın; teknisyenimiz şifrenizi hiçbir zaman sormaz."

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
}

type reqWait struct {
	f                       *form
	code, pos, elapsed, msg *ctrl
	chat                    *chatPane // P20 K6 talep sohbeti (chat_windows.go)
}

// RequestEvents bekleme/onay ekranı eylemleri (request.Deps.Events).
func (u *UI) RequestEvents() <-chan request.UserAction { return u.reqEvents }

func (u *UI) reqEmit(a request.UserAction) {
	select {
	case u.reqEvents <- a:
	default:
	}
}

// OpenURL yalnız request.DownloadURL'in ürettiği https adresi (win.OpenURL ayrıca denetler).
func (u *UI) OpenURL(s string) { win.OpenURL(s) }

func checked(c *ctrl) bool { return win.SendMessage(c.h, win.BM_GETCHECK, 0, 0) == 1 }

func setChecked(c *ctrl, on bool) {
	v := uintptr(0)
	if on {
		v = 1
	}
	win.SendMessage(c.h, win.BM_SETCHECK, v, 0)
}

func codeText(c string) string {
	if len(c) == 6 {
		return c[:3] + " " + c[3:]
	}
	return c
}

func mmss(d time.Duration) string {
	s := int(d.Round(time.Second) / time.Second)
	return fmt.Sprintf("%02d:%02d", s/60, s%60)
}

// RequestProblem AC-133: ağ/TLS hatası (ayrı metin + "Tekrar dene"), geçersiz dosya, eski sürüm.
func (u *UI) RequestProblem(ctx context.Context, p request.Problem) request.ProblemAction {
	ch := make(chan request.ProblemAction, 1)
	u.t.Do(func() {
		f := u.t.newForm(appTitle, 480, 220, false)
		f.label(p.Title, 16, 16, 448, 24, fontBold)
		f.label(p.Body, 16, 48, 448, 72, fontNormal)
		x := int32(16)
		var focus *ctrl
		add := func(text string, id int, w int32) {
			c := f.button(text, id, x, 132, w, focus == nil)
			if focus == nil {
				focus = c
			}
			x += w + 8
		}
		if p.Download {
			add("Yeni sürümü indir", idReqDownload, 150)
		}
		if p.Retry {
			add("Tekrar dene", idOK, 110)
		}
		if p.CodeMode {
			add("Bağlantı kodum var", idReqCode, 180)
		}
		f.button("Kapat", idCancel, 374, 132, 90, focus == nil)
		f.label(u.footer, 16, 184, 448, 20, fontNormal)
		done := func(a request.ProblemAction) { f.destroy(); ch <- a }
		f.command = func(id, _ int) {
			switch id {
			case idReqDownload:
				done(request.ProblemDownload)
			case idOK:
				done(request.ProblemRetry)
			case idReqCode:
				done(request.ProblemCodeMode)
			case idCancel:
				done(request.ProblemClose)
			}
		}
		f.close = func() { done(request.ProblemClose) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
	})
	select {
	case a := <-ch:
		return a
	case <-ctx.Done():
		return request.ProblemClose
	}
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
	select {
	case r := <-ch:
		return r.act, r.form
	case <-ctx.Done():
		return request.FormClose, request.Form{}
	}
}

func (u *UI) newReqForm(v request.FormView) *reqForm {
	f := u.t.newForm(appTitle+" — "+v.Tenant, 540, 730, false)
	r := &reqForm{f: f, errs: map[string]*ctrl{}}
	logo := v.Logo
	if logo == nil {
		logo = systemLogo()
	}
	f.picture(logo, 396, 8, 128, 56)
	f.label(v.Tenant, 16, 10, 370, 32, fontBig) // yalnız sunucudan gelen firma adı (G-E9-11)
	f.label(fmt.Sprintf("Uzaktan destek talebi · yanıt bekleme süresi en çok %d dk", v.WaitMinutes), 16, 46, 370, 20, fontNormal)
	f.danger(fraudText, 16, 70, 508, 36, fontNormal)
	if v.AbuseEmail != "" { // Tab sırasında uyarının hemen ardından (QA önerisi)
		f.button("Kötüye kullanımı bildir", idAbuse, 16, 110, 200, false)
	}
	field := func(label string, id int, y int32, key string, limit int) *ctrl {
		f.label(label, 16, y+3, 130, 20, fontNormal)
		e := f.edit(id, 150, y, 374, 24, win.ES_AUTOHSCROLL, limit)
		r.errs[key] = f.danger("", 150, y+26, 374, 18, fontNormal)
		return e
	}
	r.name = field("Ad soyad", idReqName, 146, request.FieldName, 100)
	r.phone = field("Telefon", idReqPhone, 192, request.FieldPhone, 40)
	r.email = field("E-posta (isteğe bağlı)", idReqEmail, 238, request.FieldEmail, 254)
	f.label("Sorununuz", 16, 287, 130, 20, fontNormal)
	r.desc = f.edit(idReqDesc, 150, 284, 374, 52, win.ES_MULTILINE|win.ES_AUTOVSCROLL|win.WS_VSCROLL, 600)
	r.errs[request.FieldDescription] = f.danger("", 150, 338, 374, 18, fontNormal)
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
	r.notice = f.danger("", 16, 614, 508, 36, fontNormal)
	r.submit = f.button("Destek iste", idOK, 16, 656, 140, true)
	r.code = f.button("Bağlantı kodum var", idReqCode, 164, 656, 190, false)
	r.closeB = f.button("Kapat", idCancel, 434, 656, 90, false)
	f.label(u.footer, 16, 700, 508, 20, fontNormal) // sunucu + sürüm + SHA-256 ilk 8 (AC-133)
	reply := func(act request.FormAction) {
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
	f.command = func(id, code int) {
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
			reply(request.FormSubmit)
		case idReqForget:
			reply(request.FormForget)
		case idReqCode:
			reply(request.FormCodeMode)
		case idCancel:
			reply(request.FormClose)
		case idAbuse:
			win.OpenMailto(v.AbuseEmail)
		}
	}
	f.close = func() { reply(request.FormClose) }
	f.show(win.WorkAreaAt(win.CursorPos()), true, r.name)
	return r
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

// RequestWaiting AC-139: talep kodu büyük puntoyla, sıra, geçen süre; "Talebi iptal et" (AC-141).
func (u *UI) RequestWaiting(v request.WaitView) {
	u.t.Do(func() {
		w := u.reqWait
		if w == nil {
			title := appTitle + " — Talebiniz iletildi"
			if l := request.Display(v.Label, ""); l != "" { // G-P20-7: seçili firmanın yerel etiketi
				title = appTitle + " — " + l
			}
			f := u.t.newForm(title, 440, 576, false)
			w = &reqWait{f: f}
			logo := v.Logo
			if logo == nil {
				logo = systemLogo()
			}
			f.picture(logo, 296, 8, 128, 48)
			f.label(v.Tenant, 16, 12, 270, 22, fontBold)
			f.label("Talebiniz iletildi", 16, 38, 270, 20, fontNormal)
			f.label("Talep kodunuz", 16, 70, 408, 20, fontNormal)
			w.code = f.add("STATIC", "", win.SS_CENTER|win.SS_NOPREFIX, 0, 0, 16, 92, 408, 44, fontBig)
			f.label("Teknisyen sizi aradığında bu kodu söyleyin.", 16, 140, 408, 20, fontNormal)
			w.pos = f.label("", 16, 172, 408, 20, fontBold)
			w.elapsed = f.label("", 16, 196, 408, 20, fontNormal)
			w.msg = f.danger("", 16, 222, 408, 36, fontNormal)
			var y int32
			w.chat, y = newChatPane(f, 266)
			f.button("Talebi iptal et", idCancel, 16, y+8, 150, false)
			f.command = func(id, _ int) {
				switch id {
				case idCancel:
					u.reqEmit(request.UserCancel)
				case idReqChatSend:
					u.chatSubmit(w.chat)
				}
			}
			f.close = func() { u.reqEmit(request.UserClose) } // AC-163: kapatma iptal eder, süreç biter
			f.show(win.WorkAreaAt(win.CursorPos()), true, w.chat.input)
			u.reqWait = w
		}
		win.SetText(w.code.h, codeText(v.Code))
		pos := "Sıra bilgisi alınıyor…"
		if v.Position > 0 {
			pos = fmt.Sprintf("Sırada %d. talepsiniz", v.Position)
		}
		win.SetText(w.pos.h, pos)
		win.SetText(w.elapsed.h, "Bekleme süresi: "+mmss(v.Elapsed))
		msg := v.Notice
		if v.Warning != "" { // QA-P8b2-2: hatırlama dosyası silinemedi
			msg = strings.TrimSpace(v.Warning + " " + msg)
		}
		win.SetText(w.msg.h, msg)
	})
}

func acceptBody(v request.AcceptView) string {
	return "Teknisyen doğrulama kodu: " + v.TechVerifyCode + " (telefondaki teknisyen de bu kodu söylemeli)\r\n" +
		"Talep kodunuz: " + codeText(v.RequestCode) + admitLine(v.AdmitCode) + "\r\n" +
		"\"Ekranımı paylaş\" derseniz teknisyen ekranınızı görür; uzaktan kontrol için ayrıca izin istenir.\r\n" +
		"Kalan süre: " + mmss(v.Remaining)
}

// RequestAccepted AC-154 / §13.3: P7 izin diyaloğu kuralları (odak "Vazgeç", 1,5 sn kilit, Enter/Space paylaşmaz,
// enjekte tıklama uyarısı, imleç dışında açılır); öne getirilir ve görev çubuğu yanıp söner. Otomatik onay yok.
func (u *UI) RequestAccepted(v request.AcceptView) {
	u.t.Do(func() {
		d := u.reqAccept
		key := acceptKey{tech: v.TechName, verify: v.TechVerifyCode}
		switch acceptDecision(d != nil && !d.decided, u.reqAcceptKey, key) {
		case acceptUpdate: // yeniden bağlanmada yeni ticket, aynı teknisyen ve kod: diyalog aynı kalır
			win.SetText(d.body.h, acceptBody(v))
			return
		case acceptReopen:
			// S8b2-3/S8b2-4: teknisyen adı veya doğrulama kodu değişti → diyalog kapatılıp yeniden açılır (1,5 sn kilit
			// yeniden başlar); müşteri eski diyalogdaki onayını aynı adlı başka teknisyene veremez.
			closeDlg(d)
		}
		u.reqAcceptKey = key
		logo := v.Logo
		if logo == nil {
			logo = systemLogo()
		}
		u.reqAccept = u.newConsent(consentSpec{title: "Bağlantı isteği", heading: v.TechName + " bağlanmak istiyor",
			body: acceptBody(v), grantText: "&Ekranımı paylaş", denyText: "Vazgeç", logo: logo, hotkeyOK: true,
			slot:    &u.reqAccept,
			onGrant: func() { u.reqEmit(request.UserShare) },
			onDeny:  func() { u.reqEmit(request.UserDecline) }})
		win.FlashWindow(u.reqAccept.f.h)
	})
}

// RequestAcceptedTick kalan süre (60 sn bağlanma penceresi, AC-155).
func (u *UI) RequestAcceptedTick(remaining time.Duration) {
	u.t.Do(func() {
		d := u.reqAccept
		if d == nil || d.decided {
			return
		}
		text := win.GetText(d.body.h)
		if i := strings.LastIndex(text, "Kalan süre: "); i >= 0 {
			win.SetText(d.body.h, text[:i]+"Kalan süre: "+mmss(remaining))
		}
	})
}

// RequestWaitClose bekleme penceresi ve onay diyaloğu kapanır (karar verilmeden kapanışta geri çağrı yok).
func (u *UI) RequestWaitClose() {
	u.t.Do(func() {
		closeDlg(u.reqAccept)
		if u.reqWait != nil {
			u.reqWait.f.destroy()
			u.reqWait = nil
		}
	})
}

// RequestClosed süre dolumu (AC-142 "Yeniden talep oluştur"), ret (AC-157 "Firmanızın mesajı:" düz metin), iptal.
func (u *UI) RequestClosed(ctx context.Context, v request.ClosedView) request.ClosedAction {
	ch := make(chan request.ClosedAction, 1)
	u.t.Do(func() {
		h := int32(170)
		if v.FirmMessage != "" {
			h += 84
		}
		f := u.t.newForm(appTitle, 460, h, false)
		f.label(v.Title, 16, 16, 428, 24, fontBold)
		f.label(v.Body, 16, 46, 428, 56, fontNormal)
		y := int32(110)
		if v.FirmMessage != "" {
			f.label("Firmanızın mesajı:", 16, y, 428, 20, fontBold)
			f.label(v.FirmMessage, 16, y+22, 428, 56, fontNormal) // SS_NOPREFIX statik metin, bağlantı değil
			y += 84
		}
		var focus *ctrl
		if v.Recreate {
			focus = f.button("Yeniden talep oluştur", idOK, 16, y+10, 180, true)
		}
		c := f.button("Kapat", idCancel, 354, y+10, 90, focus == nil)
		if focus == nil {
			focus = c
		}
		done := func(a request.ClosedAction) { f.destroy(); ch <- a }
		f.command = func(id, _ int) {
			switch {
			case id == idOK && v.Recreate:
				done(request.ClosedRecreate)
			case id == idCancel:
				done(request.ClosedClose)
			}
		}
		f.close = func() { done(request.ClosedClose) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
		win.FlashWindow(f.h)
	})
	select {
	case a := <-ch:
		return a
	case <-ctx.Done():
		return request.ClosedClose
	}
}
