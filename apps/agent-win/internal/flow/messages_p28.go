package flow

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
