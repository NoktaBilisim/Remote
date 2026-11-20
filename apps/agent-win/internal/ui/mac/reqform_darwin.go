//go:build darwin

package mac

import (
	"context"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/ui/uicore"
)

// P31 AC-514 (mimari-p31 §3.2 reqform_darwin.go): talep formu ve engel ekranı (request.UI). Alanlar, sıra ve sınırlar
// uicore.FormFields'tan; doğrulama ve hata metinleri internal/request'tedir (tek kaynak). "Bilgilerimi hatırla",
// "Bilgilerimi unut" ve AC-188 kayıt satırı yoktur (macOS formu bu denetimleri hiç çizmez; Store=nil). Sunucu
// metinleri (firma adı, aydınlatma metni) yalnız setStringValue:/setString: ile düz metin (S-P28f-12).

type formResult struct {
	act  request.FormAction
	form request.Form
}

// reqForm firma penceresi + form denetimleri.
type reqForm struct {
	f       *form
	fields  map[string]objc.ID // tek satırlı alanlar (request.Field*)
	limits  map[string]int
	desc    objc.ID // çok satırlı sorun alanı (NSTextView)
	consent objc.ID
	// rec P28e kayıt rıza kutusu: yalnız form açılırken teklif varsa; korunan denetim (yalnız yerel tıklama çevirir,
	// durum record'dan okunur — karşılama ekranıyla aynı kural).
	rec          objc.ID
	record       bool
	errs         map[string]objc.ID
	notice       objc.ID
	submit, code objc.ID
	pending      chan formResult
	// ready P22 AC-292: saklama satırı çizildi ve gün geçerli (uicore.ConsentReady); değilse "Destek iste" hep pasif.
	ready bool
}

const (
	reqFormW   = 540
	recFormRow = 40 // P28e kutusunun kapladığı yükseklik
)

// RequestForm pencere yoksa açar, varsa günceller (girilen değerler korunur) ve bir karar bekler.
func (u *UI) RequestForm(ctx context.Context, v request.FormView) (request.FormAction, request.Form) {
	ch := make(chan formResult, 1)
	u.do(func() {
		if u.reqForm == nil {
			u.reqForm = u.newReqForm(v)
		}
		u.reqForm.update(v, ch)
		u.restoreQuit()
	})
	r := await(ctx, ch, formResult{act: request.FormClose})
	return r.act, r.form
}

// newReqForm başlık ve uyarı, alanlar, aydınlatma metni + onay, (teklif varsa) kayıt kutusu, saklama satırı, düğmeler.
// Tab sırası konumdan hesaplanır (yukarıdan aşağı): alanlar → onay → Destek iste → Bağlantı kodum var.
func (u *UI) newReqForm(v request.FormView) *reqForm {
	shift := 0.0
	if v.RecOffered {
		shift = recFormRow
	}
	f := u.newForm(uicore.AppTitle+" — "+v.Tenant, reqFormW, 648+shift+retentionRow)
	f.win.Send(objc.Sel("setAutorecalculatesKeyViewLoop:"), true)
	r := &reqForm{f: f, fields: map[string]objc.ID{}, limits: map[string]int{}, errs: map[string]objc.ID{}}
	logo := v.Logo
	if logo == nil {
		logo = uicore.SystemLogo()
	}
	f.picture(logo, 396, 8, 128, 56)
	f.label(v.Tenant, 16, 10, 370, 32, fontBig) // yalnız sunucudan gelen firma adı (G-E9-11)
	f.label(uicore.FormTitle(v.WaitMinutes), 16, 46, 370, 20, fontNormal)
	f.danger(uicore.RequestFraudText, 16, 70, 508, 36, fontNormal)
	if addr := uicore.MailtoAddr(v.AbuseEmail); addr != "" {
		f.button("Kötüye kullanımı bildir", 16, 108, 200, 30, func(objc.ID) { openMailto(addr) })
	}
	r.addFields()
	r.addConsent(v)
	r.notice = f.danger("", 16, 526+shift, 508, 36, fontNormal)
	// AC-292: gönder düğmesinin hemen üstünde saklama satırı (P22, K-P22-9).
	r.ready = f.retentionLine(v.ChatRetentionDays, 16, 566+shift, 508)
	y := 566 + shift + retentionRow
	r.submit = f.button(uicore.FormSubmitText, 16, y, 140, 32, func(objc.ID) {
		if r.ready { // AC-292: Return yolu da düğme durumundan bağımsız denetlenir
			r.reply(request.FormSubmit)
		}
	})
	setDefault(r.submit)
	r.code = f.button(uicore.FormCodeText, 164, y, 190, 32, func(objc.ID) { r.reply(request.FormCodeMode) })
	f.button("Kapat", 434, y, 90, 32, func(objc.ID) { r.reply(request.FormClose) })
	f.label(u.footer, 16, y+40, 508, 36, fontNormal) // sunucu + sürüm + SHA-256 ilk 8 (AC-133)
	f.onClose(func() { r.reply(request.FormClose) })
	f.show(r.fields[request.FieldName], false, 0)
	return r
}

// addFields uicore.FormFields: etiket + alan + altında hata satırı; VoiceOver etiketi alan etiketiyle aynı (AC-514).
func (r *reqForm) addFields() {
	f := r.f
	y := 146.0
	for _, fd := range uicore.FormFields() {
		r.limits[fd.Key] = fd.Limit
		f.label(fd.Label, 16, y+3, 130, 20, fontNormal)
		if fd.Kind == uicore.FieldMultiline {
			r.desc = f.editView(150, y, 374, 52)
			axLabel(r.desc, fd.Label)
			r.errs[fd.Key] = f.danger("", 150, y+54, 374, 18, fontNormal)
			y += 76
			continue
		}
		c := f.field(150, y, 374, 24, nil, nil)
		axLabel(c, fd.Label)
		r.fields[fd.Key] = c
		r.errs[fd.Key] = f.danger("", 150, y+26, 374, 18, fontNormal)
		y += 46
	}
}

// addConsent aydınlatma metni (kaydırılabilir, salt okunur), KVKK onayı ve (teklif varsa) P28e kayıt kutusu.
func (r *reqForm) addConsent(v request.FormView) {
	f := r.f
	f.label(uicore.ConsentHeading(v.ConsentVersion), 16, 360, 508, 20, fontBold)
	f.textView(16, 382, 508, 80, v.ConsentBody)
	r.consent = f.check(uicore.FormConsentText, 16, 468, 508, 36, func(objc.ID) {})
	r.errs[request.FieldConsent] = f.danger("", 16, 504, 508, 18, fontNormal)
	if v.RecOffered { // P28e AC-381: ayrı, varsayılan işaretsiz kutu; metin derlemedeki cümle
		r.rec = f.check(flow.RecTexts.ConsentLine, 16, 522, 508, 36, func(s objc.ID) {
			if clickOf(s) == clickLocal {
				r.record = !r.record
			}
			setChecked(r.rec, r.record)
		})
	}
}

// values alanların o anki değerleri (giriş sınırına kırpılmış; asıl doğrulama request.Validate).
func (r *reqForm) values() request.Form {
	get := func(k string) string { return uicore.TrimRunes(getText(r.fields[k]), r.limits[k]) }
	return request.Form{Name: get(request.FieldName), Phone: get(request.FieldPhone), Email: get(request.FieldEmail),
		Description: uicore.TrimRunes(goText(r.desc.Send(objc.Sel("string"))), r.limits[request.FieldDescription]),
		Consent:     checked(r.consent), Record: r.rec != 0 && r.record}
}

// reply bekleyen RequestForm çağrısına yanıt verir (gönderim sürüyorsa yok sayılır).
func (r *reqForm) reply(act request.FormAction) {
	if r.pending == nil {
		return
	}
	res := formResult{act: act, form: r.values()}
	ch := r.pending
	r.pending = nil
	r.busy(true)
	ch <- res
}

func (r *reqForm) busy(on bool) {
	enable(r.code, !on)
	enable(r.submit, !on && r.ready)
}

// update değerleri, hata satırlarını ve bildirimi yazar; odak ilk hatalı alana (AC-164/AC-514).
func (r *reqForm) update(v request.FormView, ch chan formResult) {
	for k, c := range r.fields {
		setText(c, map[string]string{request.FieldName: v.Values.Name, request.FieldPhone: v.Values.Phone,
			request.FieldEmail: v.Values.Email}[k])
	}
	r.desc.Send(objc.Sel("setString:"), nsstr(v.Values.Description))
	setChecked(r.consent, v.Values.Consent)
	if r.rec != 0 {
		r.record = v.Values.Record && v.RecOffered
		setChecked(r.rec, r.record)
	}
	for k, c := range r.errs {
		setText(c, v.Errors[k])
	}
	setText(r.notice, v.Notice)
	r.pending = ch
	r.busy(false)
	focus := r.fields[v.Focus]
	switch {
	case v.Focus == request.FieldDescription:
		focus = r.desc
	case v.Focus == request.FieldConsent:
		focus = r.consent
	case focus == 0:
		focus = r.fields[request.FieldName]
	}
	r.f.win.Send(objc.Sel("makeFirstResponder:"), focus)
}

// RequestFormBusy gönderim sürerken bilgi satırı (düğmeler devre dışı).
func (u *UI) RequestFormBusy(notice string) {
	u.do(func() {
		if r := u.reqForm; r != nil {
			setText(r.notice, notice)
			r.busy(true)
		}
	})
}

// RequestFormClose firma penceresini kapatır.
func (u *UI) RequestFormClose() {
	u.do(func() {
		if u.reqForm != nil {
			u.reqForm.f.destroy()
			u.reqForm = nil
			u.restoreQuit()
		}
	})
}

// RequestProblem AC-133: ağ/TLS hatası ("Tekrar dene"), geçersiz dosya, eski sürüm ("Yeni sürümü indir", AC-519).
func (u *UI) RequestProblem(ctx context.Context, p request.Problem) request.ProblemAction {
	ch := make(chan request.ProblemAction, 1)
	u.do(func() {
		f := u.newForm(uicore.AppTitle, 480, 220)
		f.label(p.Title, 16, 16, 448, 24, fontBold)
		f.label(p.Body, 16, 48, 448, 72, fontNormal)
		done := func(a request.ProblemAction) {
			f.destroy()
			u.reqQuit = nil
			u.restoreQuit()
			ch <- a
		}
		x, first := 16.0, objc.ID(0)
		add := func(text string, w float64, a request.ProblemAction) {
			c := f.button(text, x, 132, w, 32, func(objc.ID) { done(a) })
			if first == 0 {
				first = c
				setDefault(c)
			}
			x += w + 8
		}
		if p.Download {
			add("Yeni sürümü indir", 150, request.ProblemDownload)
		}
		if p.Retry {
			add("Tekrar dene", 110, request.ProblemRetry)
		}
		if p.CodeMode {
			add(uicore.FormCodeText, 180, request.ProblemCodeMode)
		}
		c := f.button("Kapat", 374, 132, 90, 32, func(objc.ID) { done(request.ProblemClose) })
		if first == 0 {
			first = c
			setDefault(c)
		}
		f.label(u.footer, 16, 176, 448, 36, fontNormal)
		u.reqQuit = func() { done(request.ProblemClose) }
		f.onClose(u.reqQuit)
		f.show(first, false, 0)
	})
	return await(ctx, ch, request.ProblemClose)
}

// editView düzenlenebilir, kaydırılabilir düz metin alanı (sorun açıklaması): zengin metin, grafik, bağlantı/veri
// algılama ve otomatik değiştirme kapalı (S-P28f-12); alan düzenleyici kipinde Tab sonraki denetime geçer (AC-514).
func (f *form) editView(x, y, w, h float64) objc.ID {
	tv := f.textView(x, y, w, h, "")
	tv.Send(selSetEditable, true)
	tv.Send(objc.Sel("setFieldEditor:"), true)
	sendIf(tv, "setAutomaticQuoteSubstitutionEnabled:", false)
	sendIf(tv, "setAutomaticDashSubstitutionEnabled:", false)
	sendIf(tv, "setAutomaticSpellingCorrectionEnabled:", false)
	return tv
}

// axLabel VoiceOver etiketi (NSAccessibility; seçici yoksa atlanır).
func axLabel(c objc.ID, text string) {
	if s := objc.Sel("setAccessibilityLabel:"); c != 0 && objc.Responds(c, s) {
		c.Send(s, nsstr(text))
	}
}
