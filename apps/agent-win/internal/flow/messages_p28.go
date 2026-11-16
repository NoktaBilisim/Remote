package flow

import (
	"strconv"

	"remote-support/agent-win/internal/signal"
)

// P28a pano + uzaktan yazdırma metinleri (mimari-p28 §5.3 "Metinler": tek tablo). Web misafir sayfası bu özellikleri
// göstermediği için `tr.json` eşi yoktur. K5 (internal/ui) anahtar etiketini ve onay diyaloğunu buradan basar.

// ClipPrintTexts müşteri arayüzü metinleri.
var ClipPrintTexts = struct {
	ClipSwitch      string // oturum penceresi onay kutusu
	PromptTitle     string // onay diyaloğu başlığı
	PromptBody      string // "%s" = teknisyen adı
	PromptFile      string // "Dosya: " + ad
	PromptPages     string // "Sayfa: " + n
	PromptPrinter   string // "Yazıcı: " + ad
	PromptSize      string // "Boyut: " + insan okur boyut
	PromptRemaining string // "%d" = kalan saniye
	PromptPrint     string // onay düğmesi (1,5 sn kilitli)
	PromptReject    string // varsayılan, odakta
}{
	ClipSwitch:      "Pano paylaşımına izin ver",
	PromptTitle:     "Uzaktan yazdırma",
	PromptBody:      "%s bir belgeyi yazıcınıza göndermek istiyor",
	PromptFile:      "Dosya: ",
	PromptPages:     "Sayfa: ",
	PromptPrinter:   "Yazıcı: ",
	PromptSize:      "Boyut: ",
	PromptRemaining: "Kalan süre: %d sn",
	PromptPrint:     "Yazdır",
	PromptReject:    "Reddet",
}

// Bildirim satırı (3 sn, AC-103 göstergesinin altında; odak çalmaz) ve durum satırı metinleri.
const (
	noticeClipPut       = "Teknisyen panonuza metin koydu"
	noticeClipRead      = "Teknisyen panonuzu okudu"
	noticePrinted       = "Belge yazıcıya gönderildi"
	statusPrintCanceled = "Uzaktan kontrol kapandı; yazdırma iptal edildi."
)

// P28b sunucu üzerinden dosya metinleri (mimari-p28b §7.2, §8, §9; AC-358, 359, 363). Web `tr.json` ile aynı cümleler.
// Misafir istemci yükleme başlatmadığından gönderen tarafı metinleri (SESSION_LIMIT, "Alıcı reddetti") burada yoktur.
const (
	// TextFileServerMode AC-363: SERVER modunda dosya alanı bilgi satırı (internal/ui).
	TextFileServerMode   = "Dosyalar sunucuda virüs taramasından geçer; bu modda uçtan uca şifreli değildir"
	textFsrvUploading    = "Yükleniyor %"
	textFsrvScanning     = "Virüs taraması yapılıyor"
	textFsrvInfected     = "Dosya virüslü bulundu ("
	textFsrvNotDelivered = "), teslim edilmedi"
	textFsrvUnknownSig   = "bilinmeyen imza"
	textFsrvScanFailed   = "Dosya taranamadı, teslim edilmedi: "
	textFsrvScannerBusy  = "Virüs tarama servisi yoğun, dosya teslim edilmedi"
)

// fsrvScanReasonTexts `SCAN_FAILED` nedenleri (§7.2 tablo).
var fsrvScanReasonTexts = map[string]string{
	"UNAVAILABLE": "tarama servisine ulaşılamadı",
	"TIMEOUT":     "tarama zaman aşımı",
	"ENCRYPTED":   "şifreli arşiv",
	"LIMIT":       "tarama boyut sınırı",
	"ERROR":       "tarama hatası",
}

// fsrvStatusText dosya alanı metni; final = sonuç (sohbet geçmişine de düşer). Diğer durumlar boş (gösterilmez).
func fsrvStatusText(m signal.FsrvStatus) (string, bool) {
	switch m.State {
	case "UPLOADING":
		if m.Progress != nil {
			return textFsrvUploading + strconv.Itoa(*m.Progress), false
		}
	case "SCANNING":
		return textFsrvScanning, false
	case "INFECTED":
		sig := m.Signature
		if sig == "" {
			sig = textFsrvUnknownSig
		}
		return textFsrvInfected + sig + textFsrvNotDelivered, true
	case "SCAN_FAILED":
		if m.Reason == "BUSY" {
			return textFsrvScannerBusy, true
		}
		return textFsrvScanFailed + fsrvScanReasonTexts[m.Reason], true
	}
	return "", false
}
