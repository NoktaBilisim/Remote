package update

// Bilgi satırı metinleri (mimari-p29 §5.2; tek tablo — P22-G'nin flow/messages*.go dosyalarına eklenmez).

// MessageAvailable politika kapalı / konum yazılamıyor / elle güncelleme (AC-483, K-P29-10); ardından indirme bağlantısı.
const MessageAvailable = "Yeni sürüm var — indirme bağlantısından yeni sürümü alın"

// MessageReady kurulum sonrası bir kez gösterilen satır (AC-482); version manifestteki x.y.z.
func MessageReady(version string) string {
	return "Yeni sürüm (" + version + ") hazır — programı sonraki açışınızda kullanılacak"
}

// MessageAvailableLink MessageAvailable + indirme bağlantısı (AC-483; P29 K8). Bağlantı yoksa yalnız metin.
func MessageAvailableLink(link string) string {
	if link == "" {
		return MessageAvailable + "."
	}
	return MessageAvailable + ": " + link
}
