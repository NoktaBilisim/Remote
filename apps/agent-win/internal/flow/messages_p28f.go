package flow

// P28f macOS istemci metinleri (mimari-p28f §2.1, §5.3, §5.4; AC-390, AC-391; AC-404 tek tablo). AppKit ekranları
// (internal/ui/mac, K4) yalnız buradan okur; satır sonu "\n" (AppKit). Teknisyen konsolundaki karşılığı ("Müşteri
// erişilebilirlik izni vermedi…") web `tr.json`'dadır. macOS'ta ses yoktur (ADR-0037 r3) — mikrofon metni yok.

// MacTexts macOS'a özgü ekran metinleri.
var MacTexts = struct {
	TestBand string // AC-390 / AC-504: bant (TEST derlemesi ya da beklenen Developer ID'ye uymayan imza)

	AboutSigAdhoc   string // AC-504: Hakkında imza satırı, ad-hoc imza
	AboutSigDevID   string // AC-504: Developer ID imzası; tek %s = Team ID (tablodaki tek biçim dizesi)
	AboutSigUnknown string // AC-504: imza okunamadı

	ScreenTitle    string // AC-391: Ekran Kaydı rehberi başlığı (resolve'dan önce)
	ScreenSteps    string // dört adım (4.: eski TCC kaydı, AC-506)
	OpenSettings   string // Sistem Ayarları'nı açan düğme
	RestartGranted string // izin sonrası yeniden başlatma (kod korunur, §5.3)
	Cancel         string

	AccessTitle string // AC-391: kontrol isteğinde Erişilebilirlik izni yok (control.state OS_PERMISSION)
	AccessBody  string
	ControlLost string // S-P28f-10: olay musluğu sistemce kapatıldı / izin geri alındı → kapı kapandı (durum satırı)

	PrintPagesUnknown string // r4 (ADR-0037 m.8a): yazdırma onayında sayfa sayısı istemcide hesaplanmaz
	PrintDefault      string // yazıcı adı okunmaz (S-P28f-16)

	IndicatorFail string // §5.2b: gösterge 3 sn görünür kılınamadı, kontrol kapısı kapandı (oturum penceresi durum satırı)

	ClipConcealed string // S-P28f-12: panoda gizli/geçici içerik işareti var, okunmadı
	RemovePerms   string // oturum sonu: kılavuzdaki "İzinleri kaldırma" bölümüne bağlantı (AC-394)
}{
	TestBand: "TEST SÜRÜMÜ — imzasız",

	AboutSigAdhoc:   "İmza: ad-hoc (Apple Developer ID yok)",
	AboutSigDevID:   "İmza: Apple Developer ID (Ekip %s)",
	AboutSigUnknown: "İmza: doğrulanamadı",

	ScreenTitle: "Ekran Kaydı izni gerekli",
	ScreenSteps: "1. \"Sistem Ayarları'nı aç\" düğmesine tıklayın.\n" +
		"2. Açılan listede \"Nokta Destek\" anahtarını açın.\n" +
		"3. \"İzni verdim, yeniden başlat\" düğmesine tıklayın. Destek kodunuz korunur.\n" +
		"4. Listede \"Nokta Destek\" zaten açık görünüyorsa (önceki sürümden kalmış olabilir): seçin, \"−\" ile kaldırın, " +
		"bu pencereyi kapatıp uygulamayı yeniden açın ve izni yeniden verin.",
	OpenSettings:   "Sistem Ayarları'nı aç",
	RestartGranted: "İzni verdim, yeniden başlat",
	Cancel:         "Vazgeç",

	AccessTitle: "Kontrol için Erişilebilirlik izni gerekli",
	AccessBody: "Teknisyen bilgisayarınızı kontrol etmek istiyor; bunun için Erişilebilirlik izni gerekir.\n" +
		"Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik bölümünde \"Nokta Destek\"i açın, sonra teknisyenden " +
		"yeniden istemesini isteyin. Ekran paylaşımı, sohbet ve dosya bu sırada çalışmaya devam eder.\n" +
		// AC-506 / S-r4-9: "+" ile ekleme yolu yok (Finder'dan yanlış/eski kopya seçilebilir).
		"Listede \"Nokta Destek\" açık göründüğü hâlde çalışmıyorsa (önceki sürümden kalmış olabilir): seçip \"−\" ile " +
		"kaldırın, uygulamayı yeniden açın; teknisyen yeniden istediğinde bu penceredeki \"Sistem Ayarları'nı aç\" " +
		"düğmesine basın, \"Nokta Destek\" listede yeniden görünür, açın.",

	ControlLost: "Uzaktan kontrol kapatıldı: macOS girdi iznini ya da izlemesini durdurdu.",

	PrintPagesUnknown: "Sayfa sayısı: yazıcıda belirlenir",
	PrintDefault:      "Varsayılan yazıcı",

	IndicatorFail: "Oturum göstergesi ekranda gösterilemediği için uzaktan kontrol kapatıldı.",

	ClipConcealed: "Pano gizli içerik taşıyor, gönderilmedi",
	RemovePerms:   "İzinleri kaldırma",
}
