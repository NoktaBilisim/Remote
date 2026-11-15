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
	// Ref ve BindingKey karşılıklı dışlayandır (P8c, mimari-e10 §8.1): Ref → firma/müşteri dosyası; BindingKey →
	// bilgisayar kaydı. Talep modu ana ekran göstermez (tek ana ekran launch'taki firma listesidir; P20 sadelik kararı).
	Ref        string
	BindingKey string
	Version    string
	// Registered seçili kaydın YEREL etiketi ("<firma>[ – <müşteri>]"); bekleme penceresi başlığı (G-P20-7). Ref
	// modunda boş.
	Registered string
	// Info / InfoErr launch'ın Ref için aldığı ilk yanıt (aynı isteği tekrarlamamak için); ilk turda bir kez kullanılır.
	Info    *api.TenantRequestInfo
	InfoErr error
	// BindingEnabled bilgisayar kaydı bu çalıştırmada alınabilir (depo var + kanonik köken; launch). Kapalıyken AC-188
	// satırı gösterilmez (kayıt yazılmayacak).
	BindingEnabled bool
	// OnBindingInvalid BINDING_INVALID (status/oluşturma): kayıt silinir, kişisel bilgiler kalır (AC-185).
	OnBindingInvalid func()
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
	msgRefGone  = Message{"Bu dosya artık geçerli değil", "Firmanızdan yenisini isteyin. Teknisyen size kod verdiyse \"Bağlantı kodum var\" ile devam edebilirsiniz."}
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
	info       *api.TenantRequestInfo // nil → "Destek iste" pasif (kaynaksız)
	preUsed    bool                   // Deps.Info/InfoErr tüketildi
	logo       image.Image
	abuse      string
	vals       Form
	rem        remember.Personal
	remembered bool
	registered string // bekleme penceresi başlığı (G-P20-7)
	notice     string
	// forgetWarn QA-P8b2-2: dosya silinemedi (diskte kişisel veri kaldı) uyarısı; başarılı bir silmeye kadar
	// formda ve bekleme ekranında görünür kalır.
	forgetWarn string
}

// Run talep modunu yürütür (firma dosyası; ADR-0006 r4).
func Run(ctx context.Context, d Deps) Outcome {
	r := &runner{d: withDefaults(d), instance: newKey(), registered: d.Registered}
	r.loadRemembered()
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

// withDefaults boş test kancalarını varsayılanlarla doldurur.
func withDefaults(d Deps) Deps {
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
	return d
}

// loadRemembered hatırlanan kişisel bilgilerle formu doldurur.
func (r *runner) loadRemembered() {
	if r.d.Remember != nil {
		if rem, ok := r.d.Remember.LoadPersonal(); ok {
			r.rem, r.remembered = rem, true
			r.vals = Form{Name: rem.Name, Phone: rem.Phone, Email: rem.Email, Remember: true}
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
			if u, ok := DownloadURL(r.d.ServerURL, r.d.Ref); ok && p.Download { // kayıt modunda Ref yok → düğme yok
				r.d.UI.OpenURL(u)
			}
			continue
		}
		return false, &Outcome{Kind: OutClose}
	}
}

// outdatedProblem G-E9-4; indirme yalnız Ref'li dosyada (kayıt modunda sabit indirme adresi yok).
func (r *runner) outdatedProblem() Problem {
	return Problem{Message: msgOutdated, Download: r.d.Ref != ""}
}

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
	if r.d.Ref == "" && r.d.BindingKey == "" { // kaynaksız talep yok (AC-190 ana ekranda): ana ekrana dön
		return &Outcome{Kind: OutBack}
	}
	for {
		info, customer, err := r.fetchInfo(ctx)
		if ctx.Err() != nil {
			return &Outcome{Kind: OutClose}
		}
		var ae *api.Error
		switch {
		case err == nil && Outdated(r.d.Version, info.MinAgentVersion): // G-E9-4: form gösterilmez
			_, out := r.problem(ctx, r.outdatedProblem())
			return out
		case err == nil:
			r.applyInfo(ctx, info, customer)
			return nil
		case r.d.BindingKey != "" && errors.As(err, &ae) && ae.Code == "BINDING_INVALID": // B-P8c2-1: kodsuz 404 kaydı silmez
			return r.bindingInvalid()
		case errors.As(err, &ae) && (ae.Code == "CLIENT_OUTDATED" || ae.Status == 426):
			_, out := r.problem(ctx, r.outdatedProblem())
			return out
		}
		retry, out := r.problem(ctx, infoProblem(err))
		if !retry {
			return out
		}
	}
}

// fetchInfo Ref → firma bilgisi (ilk turda launch'ın yanıtı), BindingKey → POST /public/bindings/status.
func (r *runner) fetchInfo(ctx context.Context) (*api.TenantRequestInfo, string, error) {
	if r.d.BindingKey != "" {
		b, err := r.d.API.BindingStatus(ctx, r.d.BindingKey)
		if err != nil {
			return nil, "", err
		}
		customer := ""
		if b.Customer != nil {
			customer = Display(b.Customer.Name, "")
		}
		return &b.TenantRequestInfo, customer, nil
	}
	if !r.preUsed && (r.d.Info != nil || r.d.InfoErr != nil) {
		r.preUsed = true
		return r.d.Info, "", r.d.InfoErr
	}
	r.preUsed = true
	info, err := r.d.API.TenantInfo(ctx, r.d.Ref)
	return info, "", err
}

func (r *runner) applyInfo(ctx context.Context, info *api.TenantRequestInfo, customer string) {
	info.Tenant.Name = Display(info.Tenant.Name, "") // S8b2-3
	r.info, r.abuse = info, ""
	if r.d.BindingKey != "" {
		r.registered = Label(info.Tenant.Name, customer)
	}
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
}
