package flow

import (
	"errors"
	"runtime"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/capture"
)

// Message kullanıcıya gösterilen başlık + açıklama. Metinler web misafir sayfasıyla aynıdır
// (`apps/web/messages/tr.json` g.* / gj.*), müşteri iki istemcide aynı ifadeyi görür.
type Message struct {
	Title string
	Body  string
}

var (
	msgExpired   = Message{"Bu destek bağlantısının süresi doldu", "Bağlantılar güvenliğiniz için kısa süre geçerlidir ve yalnızca bir kez kullanılabilir. Teknisyeninizden yeni bir bağlantı isteyin."}
	msgCancelled = Message{"Oturum iptal edildi", "Teknisyen bu destek oturumunu iptal etti. Gerekirse teknisyeninizden yeni bir bağlantı isteyin."}
	msgConsumed  = Message{"Bu bağlantı zaten kullanıldı", "Destek bağlantıları yalnızca bir kez kullanılabilir. Teknisyeninizden yeni bir bağlantı isteyin."}
	msgNotFound  = Message{"Kod geçersiz", "Bu destek kodu bulunamadı. Kodu teknisyeninizden kontrol ederek yeniden girin."}
	msgRate      = Message{"Çok fazla deneme", "Kod girişi geçici olarak engellendi. Birkaç dakika sonra tekrar deneyin."}
	msgNetwork   = Message{"Sunucuya ulaşılamıyor", "İnternet bağlantınızı kontrol edip tekrar deneyin."}
	msgTLS       = Message{"Sunucu sertifikası doğrulanamadı", "Bu bilgisayar sunucunun güvenlik sertifikasına güvenmiyor. Teknisyeninize bildirin; kod girmeniz sorunu çözmez."}
	msgError     = Message{"Bağlantı bilgisi alınamadı", "Sunucuya şu anda ulaşılamıyor. Biraz sonra tekrar deneyin."}
	msgForbidden = Message{"Katılamazsınız", "Bu oturuma katılamazsınız. Teknisyeninizle iletişime geçin."}
	msgLobbyFull = Message{"Bekleme odası dolu", "Bekleme odası dolu. Birkaç dakika sonra tekrar deneyin."}
	msgEnded     = Message{"Destek oturumu sona erdi", "Bu oturum kapatıldı. Program birkaç saniye içinde kapanacak."}
	msgSelfEnd   = Message{"Oturumu sonlandırdınız", "Teknisyen artık ekranınızı göremez. Program birkaç saniye içinde kapanacak."}
	msgAdmin     = Message{"Oturum yönetici tarafından sonlandırıldı", "Program birkaç saniye içinde kapanacak."}
	msgMaxDur    = Message{"Oturum süresi doldu", "Oturum azami süreye ulaştı. Program birkaç saniye içinde kapanacak."}
	msgRejected  = Message{"Teknisyen bağlantıyı reddetti", "Teknisyeninizle telefonda görüşüyorsanız kodu doğru okuduğunuzdan emin olun ve onu arayın. Kimseyle görüşmüyorsanız bu pencereyi kapatın."}
	msgLobbyTO   = Message{"Bekleme süresi doldu", "5 dakika içinde kabul edilmediniz. Destek kodu hâlâ geçerliyse programı yeniden çalıştırabilirsiniz."}
	msgLeft      = Message{"Bekleme odasından çıktınız", "Ekranınız paylaşılmadı."}
	msgLost      = Message{"Bağlantı kesildi", "Sunucuyla bağlantı kurulamadı. İnternet bağlantınızı kontrol edin; kod geçerliyse programı yeniden çalıştırın."}
	msgOutdated  = Message{"Bu Hızlı Destek dosyası eski", "Güvenliğiniz için yeni sürüm gerekiyor. Teknisyeninizden yeni bağlantı isteyin."}
	msgProtocol  = Message{"Bağlantı güvenlik nedeniyle kapatıldı", "Sunucudan beklenmeyen bir yanıt alındı. Teknisyeninizle iletişime geçin."}
)

// Durum satırı metinleri.
const (
	statusReconnecting = "Bağlantı koptu, yeniden bağlanılıyor…"
	statusReconnected  = "Bağlantı yeniden kuruldu."
	statusTechLeft     = "Teknisyenin bağlantısı koptu; geri dönmesi bekleniyor."
	statusTechBack     = "Teknisyen yeniden bağlandı."
	statusWarn5min     = "Oturum 5 dakika içinde sona erecek."
	statusCaptureFail  = "Ekran görüntüsü alınamadı; teknisyen ekranınızı göremiyor." // neden kodu yoksa
	statusChatFail     = "Mesaj gönderilemedi."
	statusNonce        = "Sayfanın süresi doldu; bilgiler yenilendi. Lütfen yeniden onaylayın."
)

// captureHints neden kodu → müşteriye kısa yönlendirme (0.10.2). Kod, teknisyene telefonda okunabilsin diye
// metinde aynen gösterilir; ayrıntı yerel tanılama logundadır (internal/diag).
var captureHints = map[capture.Reason]string{
	capture.ReasonDXGIUnsupported:   "Ekran kartı ayarını kontrol edin.",
	capture.ReasonDXGIAccessDenied:  "Kilit ekranı veya onay penceresi açıksa kapatın.",
	capture.ReasonDXGINotAvailable:  "Tam ekran uygulamayı kapatıp tekrar deneyin.",
	capture.ReasonNoOutput:          "Ekran bağlantısını kontrol edin.",
	capture.ReasonD3DDevice:         "Ekran kartı sürücüsünü kontrol edin.",
	capture.ReasonFirstFrameTimeout: "Ekran yanıt vermedi; tekrar deneyin.",
	capture.ReasonGDI:               "Ekran okunamadı; teknisyeninize bu kodu bildirin.",
	capture.ReasonMFStartup:         "Windows Medya Özellik Paketi gerekli.",
	capture.ReasonNoH264Encoder:     "Windows Medya Özellik Paketi gerekli.",
	capture.ReasonEncoderConfig:     "Görüntü kodlayıcı başlatılamadı; teknisyeninize bu kodu bildirin.",
	capture.ReasonEncodeFailed:      "Görüntü kodlanamadı; teknisyeninize bu kodu bildirin.",
	capture.ReasonWGCUnsupported:    "Bu Windows sürümünde pencere paylaşımı yok; tüm ekranı paylaşın.",
	capture.ReasonWindowClosed:      "Paylaşılan pencere kapandı; oturumu bitirip yeniden başlatın.",
	capture.ReasonWindowUnavailable: "Bu pencere paylaşılamıyor; başka bir pencere ya da tüm ekranı seçin.",
}

const captureHintOther = "Teknisyeninize bu kodu bildirin."

// captureStatus yakalama hatasının durum satırı metni: "Ekran görüntüsü alınamadı (KOD). <yönlendirme>". Tipli hata
// değilse (ör. kaynak kapandı) eski genel metin.
func captureStatus(err error) string {
	e, ok := capture.AsError(err)
	if !ok {
		return statusCaptureFail
	}
	hint, ok := captureHints[e.Reason]
	if !ok {
		hint = captureHintOther
	}
	return "Ekran görüntüsü alınamadı (" + e.Code() + "). " + hint
}

// apiOutcome sunucu hatasının akıştaki karşılığı.
type apiOutcome int

const (
	outRetryCode  apiOutcome = iota // kod giriş alanına dön (AC-97)
	outFinal                        // son ekran
	outRetryNonce                   // nonce bitti: yeniden çöz ve karşılamayı tekrar göster
)

// classify AC-97: geçersiz kod → giriş alanı; süresi dolmuş/tüketilmiş → AC-5/AC-7 mesajı.
func classify(err error) (Message, apiOutcome) { return classifyFor(err, runtime.GOOS == "linux") }

// msgProxy P28g K10 (D-P28g-T2-1): Linux'ta vekil sunucu hatası. Sabit metin; vekil adresi asla yazılmaz.
var msgProxy = Message{LinuxTexts.ProxyFailed, LinuxTexts.ProxyFailedBody}

// classifyFor classify; linux true ise vekil hatası ayrı sınıftır (Windows/macOS metinleri değişmez: orada genel ağ
// hatası). GOOS parametre: test her platformda iki dalı da sınar.
func classifyFor(err error, linux bool) (Message, apiOutcome) {
	var ae *api.Error
	if !errors.As(err, &ae) {
		return msgError, outRetryCode
	}
	switch {
	case ae.Code == "SESSION_EXPIRED":
		return msgExpired, outFinal
	case ae.Code == "SESSION_CANCELLED":
		return msgCancelled, outFinal
	case ae.Code == "SESSION_CONSUMED":
		return msgConsumed, outFinal
	case ae.Code == "NONCE_INVALID":
		return Message{}, outRetryNonce
	case ae.Code == "CLIENT_OUTDATED" || ae.Status == 426: // G-E9-4 (kod modu: indirme yok, yeni bağlantı)
		return msgOutdated, outFinal
	case ae.Code == "LOBBY_FULL":
		return msgLobbyFull, outFinal
	case ae.Status == 0 && ae.TLS:
		return msgTLS, outFinal // kod girişi sorunu çözmez; "kod geçersiz" sanılmasın
	case ae.Status == 0 && ae.Proxy && linux:
		return msgProxy, outRetryCode
	case ae.Status == 0:
		return msgNetwork, outRetryCode
	case ae.Status == 403:
		return msgForbidden, outFinal
	case ae.Status == 404 || ae.Status == 400:
		return msgNotFound, outRetryCode
	case ae.Status == 410:
		return msgExpired, outFinal
	case ae.Status == 429:
		return msgRate, outFinal
	}
	return msgError, outRetryCode
}

// endedMessage session.ended.reason → son ekran.
func endedMessage(reason string) Message {
	switch reason {
	case "customer":
		return msgSelfEnd
	case "admin", "auth_revoked", "tenant_passive":
		return msgAdmin
	case "max_duration":
		return msgMaxDur
	case "cancelled":
		return msgCancelled
	case "timeout":
		return msgExpired
	case "rejected":
		return msgRejected
	case "lobby_timeout":
		return msgLobbyTO
	}
	return msgEnded
}

// ResolveMessage resolve hatasının kullanıcı metni (launch: süresi dolmuş/kullanılmış kodun ana ekran bilgisi, AC-183).
func ResolveMessage(err error) Message {
	m, _ := classify(err)
	return m
}
