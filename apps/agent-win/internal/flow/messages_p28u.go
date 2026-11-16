package flow

// P28u gözetimsiz onay diyaloğu metinleri (mimari-p28u §7.3 "İçerik"; tek tablo, P23). Diyaloğu yardımcı çizer
// (internal/unattended/helper/consent_windows.go). Teknisyen adı ve destek firması ayrı satırlardadır; firma
// sunucunun `connect.tenantName` değeridir (D-P28u-6) ve kalın satırda gösterilir.

// UnattendedConsentTexts onay diyaloğu metinleri.
var UnattendedConsentTexts = struct {
	Title     string // pencere başlığı ve diyalog başlığı
	Body      string // "%s" = teknisyen adı, "%s" = destek firması
	Company   string // kalın satır; "%s" = destek firması
	Remaining string // "%d" = kalan saniye
	Grant     string // erişim tuşu Alt+V (yalnız fiziksel tuş, 1,5 sn sonra)
	Deny      string // varsayılan, odakta
}{
	Title:     "Uzaktan bağlantı isteği",
	Body:      "%s (%s) bilgisayarınıza bağlanmak istiyor.",
	Company:   "Destek firması: %s",
	Remaining: "Kalan süre: %d sn",
	Grant:     "İzin &ver",
	Deny:      "Reddet",
}
