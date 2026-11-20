package uicore

import (
	"fmt"
	"time"

	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/request"
)

// P31 K-P31-7 (mimari-p31 §3.2): ana ekran ve talep ekranlarının platformdan bağımsız görünüm modeli. Win32
// (internal/ui) ve AppKit (internal/ui/mac) aynı tablolardan çizer; denetim kimlikleri ve yerleşim platformdadır.
// Yön (§14 D-4): uicore launch/request'i içe aktarır, tersi yoktur.

// Platform platformun ana ekran yetenekleri. "Bilgilerimi hatırla" satırı burada tutulmaz: macOS formu onu hiç çizmez
// (reqform_darwin.go; K-P31-6), Win32 formu her zaman çizer.
type Platform struct {
	// Bindings bilgisayar kaydı: "Bu firmayı unut" / "Bu bilgisayarı unut (tüm firmalar)" (P20; macOS'ta yok).
	Bindings bool
}

var (
	// PlatformWindows Win32 istemcisi: hatırla ve kayıt var.
	PlatformWindows = Platform{Bindings: true}
	// PlatformMac AppKit istemcisi (P31, AC-513): kayıt yok.
	PlatformMac = Platform{}
)

// HomeButtonKind ana ekran düğmesinin anlamı (platform kimliğe eşler).
type HomeButtonKind int

const (
	HomeSupport   HomeButtonKind = iota // "Destek iste"
	HomeCode                            // "Bağlantı kodum var"
	HomeForgetOne                       // "Bu firmayı unut"
	HomeForgetAll                       // "Bu bilgisayarı unut (tüm firmalar)"
)

// HomeButton ana ekran düğmesi; dilim sırası Tab sırasıdır (AC-189).
type HomeButton struct {
	Kind    HomeButtonKind
	Text    string
	Enabled bool
	Default bool // varsayılan odak ve varsayılan düğme
}

// HomeSinglePrefix tek kayıtlı firmanın satır öneki.
const HomeSinglePrefix = "Kayıtlı firma: "

// HomeButtons firma ekranı Tab sırası: Destek iste → Bağlantı kodum var → (kayıt varsa) Bu firmayı unut → Bu bilgisayarı
// unut (tüm firmalar). Liste her zaman ilk satır seçili açılır: "Destek iste" satır varken etkindir (yoksa AC-190: pasif,
// varsayılan "Bağlantı kodum var"); "Bu firmayı unut" seçili satır kayıtlı bir firmaysa etkindir (dosyanın firması
// unutulamaz). macOS'ta (Bindings=false) unut düğmeleri yoktur (AC-513).
func HomeButtons(v launch.FirmView, p Platform) []HomeButton {
	has := len(v.Firms) > 0
	b := []HomeButton{
		{Kind: HomeSupport, Text: "Destek iste", Enabled: has, Default: has},
		{Kind: HomeCode, Text: "Bağlantı kodum var", Enabled: true, Default: !has},
	}
	if p.Bindings {
		b = append(b,
			HomeButton{Kind: HomeForgetOne, Text: "Bu firmayı unut", Enabled: Forgettable(v, 0)},
			HomeButton{Kind: HomeForgetAll, Text: "Bu bilgisayarı unut (tüm firmalar)", Enabled: true})
	}
	return b
}

// Forgettable i. satır "Bu firmayı unut" ile silinebilir mi (yalnız kayıtlı firma; dosyanın firması kayıt değildir).
func Forgettable(v launch.FirmView, i int) bool {
	return i >= 0 && i < len(v.Firms) && !v.Firms[i].File
}

// HomeSingleText tek satırlık ana ekranın satırı: kayıtlı firma "Kayıtlı firma: …", dosyanın firması kendi metniyle;
// satır yoksa AC-190 açıklaması (firma dosyası veya kod).
func HomeSingleText(v launch.FirmView) string {
	switch {
	case len(v.Firms) == 0:
		return request.MsgNoSource
	case v.Firms[0].File:
		return v.Firms[0].Text
	}
	return HomeSinglePrefix + v.Firms[0].Text
}

// HomeListed firmalar liste kutusunda mı (birden çok satır ya da başka köken bloğu); değilse tek satır etiketi.
func HomeListed(v launch.FirmView) bool {
	return !v.Single && len(v.Firms) > 0
}

// FieldKind talep formu alanının türü.
type FieldKind int

const (
	FieldText      FieldKind = iota // tek satır metin
	FieldMultiline                  // çok satırlı metin (sorun açıklaması)
)

// FormField talep formunun giriş alanı: Key request.Field* (hata eşlemesi ve odak), Limit giriş üst sınırı (asıl
// doğrulama request.Validate'tedir).
type FormField struct {
	Key   string
	Label string
	Limit int
	Kind  FieldKind
}

// Talep formu metinleri (AC-133..137; Windows ile aynı).
const (
	RequestFraudText = "Bu pencereyi yalnız firmanızdan destek istemek için kullanın. Sizi kendiliğinden arayan biri bunu " +
		"istediyse kapatın; teknisyenimiz şifrenizi hiçbir zaman sormaz."
	FormConsentText = "Aydınlatma metnini okudum; bilgilerimin destek talebi için işlenmesini kabul ediyorum. " +
		"Ekran paylaşımı için teknisyen bağlanırken ayrıca onay istenir."
	FormRememberText = "Bilgilerimi bu bilgisayarda hatırla"
	FormForgetText   = "Bilgilerimi unut"
	FormForgetHint   = "Bu bilgiler size ait değilse: Bilgilerimi unut"
	FormSubmitText   = "Destek iste"
	FormCodeText     = "Bağlantı kodum var"
)

// FormFields talep formu giriş alanları, Tab sırasıyla (AC-514: ad → telefon → e-posta → sorun). Alanlar iki platformda
// aynıdır (Platform'a bağlı değil).
func FormFields() []FormField {
	return []FormField{
		{Key: request.FieldName, Label: "Ad soyad", Limit: 100},
		{Key: request.FieldPhone, Label: "Telefon", Limit: 40},
		{Key: request.FieldEmail, Label: "E-posta (isteğe bağlı)", Limit: 254},
		{Key: request.FieldDescription, Label: "Sorununuz", Limit: 600, Kind: FieldMultiline},
	}
}

// FormTitle talep formu/pencere başlığı yanındaki alt satır.
func FormTitle(waitMinutes int) string {
	return fmt.Sprintf("Uzaktan destek talebi · yanıt bekleme süresi en çok %d dk", waitMinutes)
}

// ConsentHeading aydınlatma metni başlığı.
func ConsentHeading(version int) string {
	return fmt.Sprintf("Aydınlatma metni (sürüm %d)", version)
}

// RequestCodeText 6 haneli talep kodu "123 456" (AC-139); başka uzunluk olduğu gibi.
func RequestCodeText(c string) string {
	if len(c) == 6 {
		return c[:3] + " " + c[3:]
	}
	return c
}

// MMSS süre "dd:ss" (bekleme süresi, kabul kalan süresi).
func MMSS(d time.Duration) string {
	s := int(d.Round(time.Second) / time.Second)
	return fmt.Sprintf("%02d:%02d", s/60, s%60)
}

// WaitPositionText sıra satırı (0 = henüz bilinmiyor).
func WaitPositionText(pos int) string {
	if pos > 0 {
		return fmt.Sprintf("Sırada %d. talepsiniz", pos)
	}
	return "Sıra bilgisi alınıyor…"
}

// WaitElapsedText geçen süre satırı.
func WaitElapsedText(d time.Duration) string { return "Bekleme süresi: " + MMSS(d) }

// AcceptRemainingPrefix kabul diyaloğu gövdesinin son satır öneki (tikte yalnız bu satır değişir).
const AcceptRemainingPrefix = "Kalan süre: "

// AcceptHeading kabul diyaloğu başlığı (AC-154/AC-516).
func AcceptHeading(techName string) string { return techName + " bağlanmak istiyor" }

// AcceptBody kabul diyaloğu gövdesi (AC-154/AC-516); nl satır sonu (Win32 "\r\n", AppKit "\n").
func AcceptBody(v request.AcceptView, nl string) string {
	return "Teknisyen doğrulama kodu: " + v.TechVerifyCode + " (telefondaki teknisyen de bu kodu söylemeli)" + nl +
		"Talep kodunuz: " + RequestCodeText(v.RequestCode) + AdmitLine(v.AdmitCode) + nl +
		"\"Ekranımı paylaş\" derseniz teknisyen ekranınızı görür; uzaktan kontrol için ayrıca izin istenir." + nl +
		AcceptRemainingPrefix + MMSS(v.Remaining)
}
