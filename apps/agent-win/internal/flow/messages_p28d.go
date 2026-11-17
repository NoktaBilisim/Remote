package flow

// P28d sesli görüşme metinleri (mimari-p28d §8 "messages_p28d.go"; tek tablo). Web karşılıkları
// `apps/web/messages/tr.json` `vg.*`; müşteri iki istemcide aynı ifadeyi görür. Device ve tepsi metinleri Windows'a
// özgüdür (V-PD-1). Balloon sabittir: tepsi balonunda sunucudan gelen metin/ad gösterilmez (K-P20-9); yeni dinleyicinin
// adı oturum penceresindeki çubukta (Announce) görünür.

// VoiceTexts diyalog, görüşme çubuğu, gösterge şeridi ve tepsi metinleri.
var VoiceTexts = struct {
	RequestTitle     string // %s = isteyen teknisyenin adı (roster)
	RequestBody      string
	RequestListeners string // %s = virgülle ayrılmış adlar
	Headset          string
	DialogTitle      string // pencere başlığı
	Accept           string
	Reject           string
	BarTitle         string
	MicOn            string
	MicMuted         string
	Talkers          string // %s = adlar
	Listeners        string // %s = adlar
	Mute             string
	Unmute           string
	End              string
	NewListener      string // %s = ad (oturum penceresi çubuğu, sohbet "Sistem" satırı)
	Balloon          string // tepsi balonu (sabit, ad yok)
	Ended            string
	Unconfirmed      string // Kabul sonrası 5 sn active gelmedi (D-PD-K1-2)
	Device           string
	TrayMicOn        string
	TrayMicMuted     string
}{
	RequestTitle:     "%s sesli görüşme istiyor",
	RequestBody:      "Kabul ederseniz mikrofonunuz açılır ve teknisyen sizi duyar. Görüşmeyi istediğiniz an bitirebilirsiniz.",
	RequestListeners: "Görüşmeyi dinleyecekler: %s",
	Headset:          "Yankı olmaması için kulaklık kullanmanız önerilir.",
	DialogTitle:      "Sesli görüşme",
	Accept:           "&Kabul et",
	Reject:           "&Reddet",
	BarTitle:         "Sesli görüşme",
	MicOn:            "● Mikrofon açık",
	MicMuted:         "● Sessizde",
	Talkers:          "Konuşan: %s",
	Listeners:        "Dinleyen: %s",
	Mute:             "Sessize &al",
	Unmute:           "Mikrofonu &aç",
	End:              "Görüşmeyi &bitir",
	NewListener:      "%s görüşmeyi dinlemeye başladı",
	Balloon:          "Görüşmeye yeni bir dinleyici katıldı",
	Ended:            "Sesli görüşme sona erdi",
	Unconfirmed:      "Sesli görüşme başlatılamadı; mikrofonunuz kapatıldı. Teknisyen yeniden isteyebilir.",
	Device: "Mikrofonunuz açılamadı. Mikrofonun bağlı olduğunu ve Ayarlar > Gizlilik ve güvenlik > Mikrofon altında " +
		"\"Masaüstü uygulamalarının mikrofonunuza erişmesine izin verin\" seçeneğinin açık olduğunu kontrol edin; " +
		"teknisyen yeniden isteyebilir.",
	TrayMicOn:    "Mikrofon açık",
	TrayMicMuted: "Sessizde",
}
