package ui

// P28c: oturum penceresi en kötü durumda (yükseltilmiş + sunucu üzerinden dosya + 3 teknisyen + kayıt satırı) ≈ 776 px
// (P28d: + ses satırı 812 px)
// istemci yüksekliğindedir; 768 px ekranın çalışma alanına sığmaz. Sığmadığında yalnız sohbet geçmişi (zaten kaydırma
// çubuklu) kısaltılır, altındaki denetimler yukarı kayar.

const (
	chatHistoryY = 102 // sohbet geçmişinin üst kenarı (mantıksal px)
	chatHistoryH = 196 // olağan yükseklik
	chatHistoryM = 64  // en kısa (sıkıştırma tavanı chatHistoryH-chatHistoryM)
	sessionPad   = 16  // pencerenin çalışma alanı alt kenarına uzaklığı (form.show)
	// voiceRowH P28d ses satırı (iki satırlık gösterge etiketi + "Sessize al" + "Görüşmeyi bitir"; teknisyen listesi ile
	// kayıt satırı arasında, görüşme yokken gizli). En kötü durumda (776 + 36) taşma 131 px ≤ sıkıştırma tavanı 132 px —
	// daha yüksek bir satır 768 px ekrana sığmaz (TestP28dSessionWindowWithVoiceRowFits768).
	voiceRowH = 36
)

// chatSqueeze pencerenin (winH, fiziksel px, çerçeve dahil) çalışma alanına (workH, fiziksel px) alt payla sığması için
// sohbet geçmişinden kesilecek mantıksal px; sığıyorsa 0. dpi pencerenin DPI'ı (96 = %100).
func chatSqueeze(winH, workH, dpi int32) int32 {
	if dpi <= 0 {
		dpi = 96
	}
	over := winH - (workH - sessionPad*dpi/96)
	if over <= 0 {
		return 0
	}
	return min((over*96+dpi-1)/dpi, chatHistoryH-chatHistoryM)
}
