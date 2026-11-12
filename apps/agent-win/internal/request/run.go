package request

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"image"
	"net/url"
	"regexp"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/remember"
)

var tenantRefRe = regexp.MustCompile(`^[a-z2-7]{16}$`)

// Deps talep akışının bağımlılıkları.
type Deps struct {
	API       API
	Dial      func(ctx context.Context, secret string) (Conn, error)
	UI        UI
	Events    <-chan UserAction
	Remember  Remember
	ServerURL *url.URL
	Ref       string
	Version   string
	// Logo `tenant.logoUrl`'i indirir (api.Client.Logo); nil olabilir.
	Logo func(ctx context.Context, logoURL string) (image.Image, error)
	// Test kancaları (varsayılan: time.Now, time.After, crypto/rand jitter, 120 sn / 2 sn).
	Now             func() time.Time
	After           func(d time.Duration) <-chan time.Time
	Jitter          func(max time.Duration) time.Duration
	ReconnectWindow time.Duration
	ReconnectEvery  time.Duration
	TickEvery       time.Duration
	CancelWait      time.Duration
}

// Kullanıcı metinleri.
var (
	msgNetwork  = Message{"Sunucuya ulaşılamıyor", "İnternet bağlantınızı kontrol edip tekrar deneyin."}
	msgTLS      = Message{"Sunucu sertifikası doğrulanamadı", "Bu bilgisayar sunucunun güvenlik sertifikasına güvenmiyor. Ağınızda araya giren bir cihaz olabilir; firmanızı telefonla arayın."}
	msgRate     = Message{"Çok fazla deneme", "Birkaç dakika sonra tekrar deneyin."}
	msgRefGone  = Message{"Bu dosya artık geçerli değil", "Firmanızdan yenisini isteyin. Teknisyen size kod verdiyse \"Teknisyenden kod aldım\" ile devam edebilirsiniz."}
	msgOutdated = Message{"Bu Hızlı Destek dosyası eski", "Güvenliğiniz için yeni sürümü indirin. Yeni sürüm aynı firma bağlantısından iner; indirdikten sonra bu pencereyi kapatıp yeni dosyayı açın."}
	msgLost     = Message{"Sunucuyla bağlantı kesildi", "İnternet bağlantınızı kontrol edin. Bilgileriniz formda duruyor; yeniden talep oluşturabilirsiniz."}
	msgProtocol = Message{"Bağlantı güvenlik nedeniyle kapatıldı", "Sunucudan beklenmeyen bir yanıt alındı. Firmanızı telefonla arayın."}
	msgReplaced = Message{"Talep başka bir pencerede açıldı", "Bu talep artık başka bir pencereden izleniyor. Bu pencereyi kapatabilirsiniz."}
	msgGone     = Message{"Talebiniz artık geçerli değil", "Talebiniz kapanmış. İsterseniz yeniden talep oluşturabilirsiniz."}
	msgDeclined = Message{"Ekranınız paylaşılmadı", "Bağlantıyı kabul etmediniz; talebiniz iptal edildi. İsterseniz yeniden talep oluşturabilirsiniz."}
	msgTicketTO = Message{"Bağlantı süresi doldu", "Onay süresi içinde yanıt verilmedi; ekranınız paylaşılmadı. İsterseniz yeniden talep oluşturabilirsiniz."}
)

const (
	noticeForgot     = "Bilgileriniz silindi."
	noticeForgetFail = "Bilgileriniz silinemedi. Pencereyi kapatıp yeniden deneyin."
	noticeCancelled  = "Talebiniz iptal edildi."
	noticeSending    = "Talebiniz gönderiliyor…"
	noticeBusyRetry  = "Sunucu şu an yoğun, birkaç saniye içinde yeniden deneniyor…"
	noticeBusy       = "Sunucu şu an yoğun. Lütfen biraz sonra tekrar deneyin."
	noticeConsent    = "Aydınlatma metni güncellendi; lütfen yeniden okuyup onaylayın."
	noticePending    = "Bu pencereden gönderilmiş bekleyen bir talebiniz var. Programı kapatıp yeniden açın."
	noticeCheck      = "Lütfen işaretli alanları düzeltin."
	noticeReconnect  = "Bağlantı koptu, yeniden bağlanılıyor…"
	noticeError      = "Talep gönderilemedi. Lütfen tekrar deneyin."
	logoTimeout      = 3 * time.Second
)

type runner struct {
	d          Deps
	instance   string
	info       *api.TenantRequestInfo
	logo       image.Image
	abuse      string
	vals       Form
	rem        remember.Data
	remembered bool
	notice     string
	// forgetWarn QA-P8b2-2: dosya silinemedi (diskte kişisel veri kaldı) uyarısı; başarılı bir silmeye kadar
	// formda ve bekleme ekranında görünür kalır.
	forgetWarn string
}

// Run talep modunu yürütür (firma dosyası; ADR-0006 r4).
func Run(ctx context.Context, d Deps) Outcome {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.After == nil {
		d.After = time.After
	}
	if d.Jitter == nil {
		d.Jitter = randJitter
	}
	if d.ReconnectWindow == 0 {
		d.ReconnectWindow = 110 * time.Second // sunucunun 120 sn kopma süresinin altında
	}
	if d.ReconnectEvery == 0 {
		d.ReconnectEvery = 2 * time.Second
	}
	if d.TickEvery == 0 {
		d.TickEvery = time.Second
	}
	if d.CancelWait == 0 {
		d.CancelWait = 4 * time.Second // AC-141: 5 sn içinde İPTAL
	}
	r := &runner{d: d, instance: newKey()}
	if d.Remember != nil {
		if rem, ok := d.Remember.Load(); ok {
			r.rem, r.remembered = rem, true
			r.vals = Form{Name: rem.Name, Phone: rem.Phone, Email: rem.Email, Remember: true}
		}
	}
	for {
		if out := r.loadInfo(ctx); out != nil {
			return *out
		}
		created, reload, out := r.form(ctx)
		if out != nil {
			return *out
		}
		if reload {
			continue
		}
		back, out := r.wait(ctx, created)
		if out != nil {
			return *out
		}
		if !back {
			return Outcome{Kind: OutClose}
		}
	}
}

// newKey istemcinin rastgele kimliklerinin TEK üretim yolu (QA-P8b2-1): `clientInstanceId` ve `deviceKey`, 128 bit
// crypto/rand, base64url 22 karakter. crypto/rand.Read Go 1.24+ hata dönmez (başarısızlıkta süreç durur).
func newKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func randJitter(max time.Duration) time.Duration {
	b := make([]byte, 2)
	if _, err := rand.Read(b); err != nil || max <= 0 {
		return 0
	}
	return time.Duration(int64(b[0])<<8|int64(b[1])) * max / 65536
}

// problem engel ekranı döngüsü: retry=true → çağıran yeniden dener.
func (r *runner) problem(ctx context.Context, p Problem) (bool, *Outcome) {
	for {
		switch r.d.UI.RequestProblem(ctx, p) {
		case ProblemRetry:
			if p.Retry {
				return true, nil
			}
		case ProblemCodeMode:
			if p.CodeMode {
				return false, &Outcome{Kind: OutCodeMode}
			}
		case ProblemDownload:
			if u, ok := DownloadURL(r.d.ServerURL, r.d.Ref); ok && p.Download {
				r.d.UI.OpenURL(u)
			}
			continue
		}
		return false, &Outcome{Kind: OutClose}
	}
}

func outdatedProblem() Problem { return Problem{Message: msgOutdated, Download: true} }

// infoProblem AC-133: ağ hatası ile TLS hatası ayrı mesaj + "Tekrar dene"; geçersiz dosya yalnız kod yolu.
func infoProblem(err error) Problem {
	var ae *api.Error
	switch {
	case errors.As(err, &ae) && (ae.Code == "REQUEST_REF_INVALID" || ae.Status == 404):
		return Problem{Message: msgRefGone, CodeMode: true}
	case errors.As(err, &ae) && ae.Status == 0 && ae.TLS:
		return Problem{Message: msgTLS, Retry: true, CodeMode: true}
	case errors.As(err, &ae) && ae.Status == 429:
		return Problem{Message: msgRate, Retry: true, CodeMode: true}
	}
	return Problem{Message: msgNetwork, Retry: true, CodeMode: true}
}

func (r *runner) loadInfo(ctx context.Context) *Outcome {
	for {
		info, err := r.d.API.TenantInfo(ctx, r.d.Ref)
		if ctx.Err() != nil {
			return &Outcome{Kind: OutClose}
		}
		if err == nil {
			if Outdated(r.d.Version, info.MinAgentVersion) { // G-E9-4: form gösterilmez
				_, out := r.problem(ctx, outdatedProblem())
				return out
			}
			info.Tenant.Name = Display(info.Tenant.Name, "") // S8b2-3
			r.info, r.abuse = info, ""
			if info.AbuseEmail != nil && api.ValidAbuseEmail(*info.AbuseEmail) {
				r.abuse = *info.AbuseEmail
			}
			r.logo = nil
			if info.Tenant.LogoURL != nil && *info.Tenant.LogoURL != "" && r.d.Logo != nil {
				lctx, cancel := context.WithTimeout(ctx, logoTimeout)
				if img, err := r.d.Logo(lctx, *info.Tenant.LogoURL); err == nil {
					r.logo = img
				}
				cancel()
			}
			return nil
		}
		retry, out := r.problem(ctx, infoProblem(err))
		if !retry {
			return out
		}
	}
}

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
		Errors: errs, Focus: firstError(errs), Notice: joinNotice(r.forgetWarn, r.notice), Remembered: r.remembered}
}

func joinNotice(a, b string) string {
	if a == "" || b == "" {
		return a + b
	}
	return a + " " + b
}

// forget AC-137: dosyayı siler. Başarısızlık yutulmaz (QA-P8b2-2): forgetWarn başarılı bir silmeye kadar görünür.
func (r *runner) forget() bool {
	r.rem, r.remembered = remember.Data{}, false
	ok := r.d.Remember == nil || r.d.Remember.Forget() == nil
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
func rememberPlan(f Form, v Valid, rem remember.Data, remembered bool) (keep, newDeviceKey bool) {
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
		switch act {
		case FormSubmit:
		case FormForget:
			r.vals = Form{}
			if r.forget() {
				r.notice = noticeForgot
			}
			continue
		case FormCodeMode:
			r.d.UI.RequestFormClose()
			return nil, false, &Outcome{Kind: OutCodeMode}
		default:
			r.d.UI.RequestFormClose()
			return nil, false, &Outcome{Kind: OutClose}
		}
		r.vals = f
		v, verrs := Validate(f)
		if len(verrs) > 0 {
			errs, r.notice = verrs, noticeCheck
			continue
		}
		keep, fresh := rememberPlan(f, v, r.rem, r.remembered)
		if !keep {
			r.vals.Remember, r.vals.RememberChosen = false, false
			r.forget() // AC-137 / S8b2-1: kayıt yok, mevcut dosya silinir (başarısızlık forgetWarn ile görünür)
		} else if fresh {
			r.rem.DeviceKey = newKey()
		}
		body := api.CreateRequestBody{Ref: r.d.Ref, ClientInstanceID: r.instance, ClientVersion: r.d.Version,
			CustomerName: v.Name, Phone: v.Phone, Email: v.Email, Description: v.Description,
			ConsentTextID: r.info.ConsentText.ID, ConsentAccepted: true}
		if keep {
			body.DeviceKey = r.rem.DeviceKey
		}
		r.d.UI.RequestFormBusy(noticeSending)
		res, err := r.create(ctx, body)
		if err == nil {
			if keep && r.d.Remember != nil {
				d := remember.Data{Name: v.Name, Phone: v.Phone, Email: v.Email, DeviceKey: r.rem.DeviceKey}
				if r.d.Remember.Save(d) == nil {
					r.rem, r.remembered = d, true
				}
			}
			return res, false, nil
		}
		if ctx.Err() != nil {
			return nil, false, &Outcome{Kind: OutClose}
		}
		var ae *api.Error
		if !errors.As(err, &ae) {
			r.notice = noticeError
			continue
		}
		switch {
		case ae.Status == 0 && ae.TLS:
			r.notice = msgTLS.Title + ". " + msgTLS.Body
		case ae.Status == 0:
			r.notice = msgNetwork.Title + ". " + msgNetwork.Body
		case ae.Code == "VALIDATION" && ae.Fields["consentTextId"] != "":
			r.d.UI.RequestFormClose()
			r.notice = noticeConsent
			return nil, true, nil
		case ae.Code == "VALIDATION":
			for _, k := range FieldOrder {
				if m := Display(ae.Fields[k], ""); m != "" {
					errs[k] = m
				}
			}
			r.notice = noticeCheck
		case ae.Code == "REQUEST_REF_INVALID" || ae.Code == "CLIENT_OUTDATED":
			r.d.UI.RequestFormClose()
			p := Problem{Message: msgRefGone, CodeMode: true}
			if ae.Code == "CLIENT_OUTDATED" {
				p = outdatedProblem()
			}
			_, out := r.problem(ctx, p)
			return nil, false, out
		case ae.Code == "REQUEST_PENDING":
			r.notice = noticePending
		case ae.Code == "RATE_LIMITED" || ae.Code == "QUEUE_FULL":
			r.notice = Display(ae.Message, "")
			if r.notice == "" {
				r.notice = msgRate.Body
			}
		case ae.Code == "NOT_READY":
			r.notice = noticeBusy
		default:
			r.notice = noticeError
		}
	}
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
