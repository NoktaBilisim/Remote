package request

// Talep formu (AC-134..137): görünüm, hatırlama kararı, talep oluşturma ve oluşturma hatalarının forma yansıması.

import (
	"context"
	"errors"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/remember"
)

func firstError(errs map[string]string) string {
	for _, k := range FieldOrder {
		if errs[k] != "" {
			return k
		}
	}
	return ""
}

func (r *runner) formView(errs map[string]string) FormView {
	return FormView{Tenant: r.info.Tenant.Name, Logo: r.logo, ConsentVersion: r.info.ConsentText.Version,
		ConsentBody: r.info.ConsentText.Body, AbuseEmail: r.abuse, WaitMinutes: r.info.WaitMinutes, Values: r.vals,
		Errors: errs, Focus: firstError(errs), Notice: joinNotice(r.forgetWarn, r.notice), Remembered: r.remembered,
		RememberNote: r.rememberNote(), RecOffered: r.info.ConsentText.RecOffered(),
		ChatRetentionDays: r.info.ChatRetentionDays}
}

func joinNotice(a, b string) string {
	if a == "" || b == "" {
		return a + b
	}
	return a + " " + b
}

// forget AC-137: kişisel bilgileri siler (kayıt kalır, AC-186). Başarısızlık yutulmaz (QA-P8b2-2): forgetWarn
// başarılı bir silmeye kadar görünür.
func (r *runner) forget() bool {
	r.rem, r.remembered = remember.Personal{}, false
	ok := r.d.Remember == nil || r.d.Remember.ClearPersonal() == nil
	r.forgetWarn = ""
	if !ok {
		r.forgetWarn = noticeForgetFail
	}
	return ok
}

// rememberPlan S8b2-1 / AC-136..137: gönderimde hatırlama kararı (saf mantık).
//   - kutu işaretsiz → kayıt yok, dosya silinir;
//   - kutu hatırlanan veriyle işaretli açıldı ve ad VEYA telefon hatırlanandan farklı, ama müşteri kutuyu bu oturumda
//     kendisi işaretlemedi (RememberChosen=false) → kişi değişmiş sayılır: kayıt yok, eski dosya silinir, deviceKey yok;
//   - aksi halde kayıt; kişi değiştiyse veya anahtar yoksa yeni deviceKey (başka kişinin cihaz anahtarı taşınmaz).
func rememberPlan(f Form, v Valid, rem remember.Personal, remembered bool) (keep, newDeviceKey bool) {
	if !f.Remember {
		return false, false
	}
	changed := rem.Name != v.Name || rem.Phone != v.Phone
	if remembered && changed && !f.RememberChosen {
		return false, false
	}
	return true, rem.DeviceKey == "" || changed
}

// form AC-134..136: doğrulama, hatırlama, talep oluşturma. reload=true → firma bilgisi yeniden alınır.
func (r *runner) form(ctx context.Context) (*api.CreateRequestResult, bool, *Outcome) {
	errs := map[string]string{}
	for {
		act, f := r.d.UI.RequestForm(ctx, r.formView(errs))
		r.notice, errs = "", map[string]string{}
		if act != FormSubmit {
			if out := r.formAction(act); out != nil {
				return nil, false, out
			}
			continue
		}
		r.vals = f
		if r.info.ChatRetentionDays < 1 { // AC-292: saklama satırı gösterilemeyen (eski) sunucuya talep gönderilmez
			r.notice = flow.ChatTexts.ServerOutdated
			continue
		}
		v, verrs := Validate(f)
		if len(verrs) > 0 {
			errs, r.notice = verrs, noticeCheck
			continue
		}
		body, keep := r.createBody(f, v)
		r.d.UI.RequestFormBusy(noticeSending)
		res, err := r.create(ctx, body)
		if err == nil {
			r.savePersonal(keep, v)
			return res, false, nil
		}
		if done, reload, out := r.createFailed(ctx, err, errs); done {
			return nil, reload, out
		}
	}
}

// formAction gönderim dışı form kararı: "Bilgilerimi unut" formda kalır (nil), diğerleri formu kapatır.
func (r *runner) formAction(act FormAction) *Outcome {
	switch act {
	case FormForget:
		r.vals = Form{}
		if r.forget() {
			r.notice = noticeForgot
		}
		return nil
	case FormCodeMode:
		r.d.UI.RequestFormClose()
		return &Outcome{Kind: OutCodeMode}
	default:
		r.d.UI.RequestFormClose()
		return &Outcome{Kind: OutClose}
	}
}

// createBody hatırlama kararını uygular (rememberPlan) ve talep gövdesini kurar; keep=true → başarıda kaydedilir.
func (r *runner) createBody(f Form, v Valid) (api.CreateRequestBody, bool) {
	keep, fresh := rememberPlan(f, v, r.rem, r.remembered)
	if !keep {
		r.vals.Remember, r.vals.RememberChosen = false, false
		r.forget() // AC-137 / S8b2-1: kayıt yok, mevcut dosya silinir (başarısızlık forgetWarn ile görünür)
	} else if fresh {
		r.rem.DeviceKey = newKey()
	}
	body := api.CreateRequestBody{Ref: r.d.Ref, BindingKey: r.d.BindingKey, ClientInstanceID: r.instance,
		ClientVersion: r.d.Version, CustomerName: v.Name, Phone: v.Phone, Email: v.Email, Description: v.Description,
		ConsentTextID: r.info.ConsentText.ID, ConsentAccepted: true}
	if keep && r.d.BindingKey == "" { // G-E10-5: kayıtla açılan talepte deviceKey gönderilmez
		body.DeviceKey = r.rem.DeviceKey
	}
	return body, keep
}

// savePersonal talep oluştuktan sonra kişisel bilgileri hatırlar (AC-136).
func (r *runner) savePersonal(keep bool, v Valid) {
	if keep && r.d.Remember != nil {
		d := remember.Personal{Name: v.Name, Phone: v.Phone, Email: v.Email, DeviceKey: r.rem.DeviceKey}
		if r.d.Remember.SavePersonal(d) == nil {
			r.rem, r.remembered = d, true
		}
	}
}

// createFailed talep oluşturma hatası: done=true → form biter (reload ya da out); aksi halde form bildirimle yeniden
// gösterilir (VALIDATION alan hataları errs'e yazılır).
func (r *runner) createFailed(ctx context.Context, err error, errs map[string]string) (bool, bool, *Outcome) {
	if ctx.Err() != nil {
		return true, false, &Outcome{Kind: OutClose}
	}
	var ae *api.Error
	if !errors.As(err, &ae) {
		r.notice = noticeError
		return false, false, nil
	}
	switch {
	case ae.Status == 0: // ağ / TLS: yalnız bildirim (createNotice)
	case ae.Code == "VALIDATION" && ae.Fields["consentTextId"] != "":
		r.d.UI.RequestFormClose()
		r.notice = noticeConsent
		return true, true, nil
	case ae.Code == "VALIDATION":
		for _, k := range FieldOrder {
			if m := Display(ae.Fields[k], ""); m != "" {
				errs[k] = m
			}
		}
		r.notice = noticeCheck
		return false, false, nil
	case ae.Code == "BINDING_INVALID":
		r.d.UI.RequestFormClose()
		return true, false, r.bindingInvalid() // AC-185: ana ekrana (firma listesi), "Bağlantı kodum var" etkin
	case ae.Code == "REQUEST_REF_INVALID" || ae.Code == "CLIENT_OUTDATED":
		r.d.UI.RequestFormClose()
		p := Problem{Message: msgRefGone, CodeMode: true}
		if ae.Code == "CLIENT_OUTDATED" {
			p = r.outdatedProblem()
		}
		_, out := r.problem(ctx, p)
		return true, false, out
	}
	r.notice = createNotice(ae)
	return false, false, nil
}

// createNotice formda kalan hataların bildirim satırı.
func createNotice(ae *api.Error) string {
	switch {
	case ae.Status == 0 && ae.TLS:
		return msgTLS.Title + ". " + msgTLS.Body
	case ae.Status == 0:
		return msgNetwork.Title + ". " + msgNetwork.Body
	case ae.Code == "REQUEST_PENDING":
		return noticePending
	case ae.Code == "RATE_LIMITED" || ae.Code == "QUEUE_FULL":
		if n := Display(ae.Message, ""); n != "" {
			return n
		}
		return msgRate.Body
	case ae.Code == "NOT_READY":
		return noticeBusy
	}
	return noticeError
}

// create S8b-8 politikasıyla (policy.go) en çok 2 deneme.
func (r *runner) create(ctx context.Context, body api.CreateRequestBody) (*api.CreateRequestResult, error) {
	for attempt := 1; ; attempt++ {
		res, err := r.d.API.CreateRequest(ctx, body)
		if err == nil {
			return res, nil
		}
		delay, ok := createRetryDelay(err, attempt, r.d.Jitter)
		if !ok {
			return nil, err
		}
		r.d.UI.RequestFormBusy(noticeBusyRetry)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-r.d.After(delay):
		}
	}
}
