package signal

import (
	"regexp"
	"slices"
)

// P28a pano + uzaktan yazdırma WS sözleşmesi (mimari-p28 §4.2–4.3, r2 §14; `packages/contracts/src/ws-clip-print.ts`).
// İçerik (pano metni, PDF baytları, dosya adı, hash) WS'den GEÇMEZ; yalnız kimlik + bayt sayısı + sonuç. Uyum
// `packages/contracts/fixtures/clip-print.json` ile test edilir.

// Özellik belirteçleri (`WS_GUEST_CAP_CLIP` / `WS_GUEST_CAP_PRINT`): Dial'ın features parametresi.
const (
	FeatureClip  = "rs.cap.clip1"
	FeaturePrint = "rs.cap.print1"
)

// Sınırlar (contracts sabitleri; fikstür `constants` ile test edilir).
const (
	ClipMaxBytes             = 65_536
	ClipGuestDeadlineMs      = 8_000
	PrintMaxBytes            = 20 * 1024 * 1024
	PrintMinBytes            = 5
	PrintConsentTimeoutMs    = 60_000
	PrintGuestTransferMs     = 480_000
	PrintMaxPages            = 100_000
	IDReuseWindow            = 64
	guestFeaturesMax         = 3 // P28b: + fsrv (`PEER_FEATURES`)
	clipPrintIDPatternString = `^[A-Za-z0-9_-]{8,26}$`
)

// cpIDRe `CLIP_PRINT_ID_PATTERN` (cid/pid).
var cpIDRe = regexp.MustCompile(clipPrintIDPatternString)

// ValidClipPrintID cid/pid biçimi (internal/flow kimlik doğrulaması da bunu kullanır).
func ValidClipPrintID(s string) bool { return cpIDRe.MatchString(s) }

// Sonuç kümeleri (`CLIP_GUEST_RESULTS`, `PRINT_GUEST_RESULTS`, `PRINT_DECISIONS`): misafirin raporlayabildikleri.
// DISCONNECTED/ABANDONED yalnız sunucu üretir (misafirden → 1008).
var (
	clipDirections     = []string{"TO_CUSTOMER", "TO_TECH"}
	clipGuestResults   = []string{"OK", "EMPTY", "TOO_LARGE", "SENSITIVE", "INVALID", "DENIED", "ERROR", "TIMEOUT"}
	printGuestResults  = []string{"PRINTED", "NO_PRINTER", "REJECTED", "TIMEOUT", "INVALID_PDF", "TOO_LARGE", "BUSY", "CANCELLED", "ERROR"}
	printDecisions     = []string{"APPROVED", "REJECTED", "TIMEOUT", "NONE"}
	guestFeatureValues = []string{"clipboard", "print", "fsrv"} // P28b: + fsrv
)

// --- Sunucu → misafir ---

// ClipConsent S→guest: sunucu anahtarı kapattı (`on:false`; istemci anahtarı kapatır, YANIT GÖNDERMEZ). Şema `on:true`'yu
// da kabul eder (teknisyen yönü); misafir onu yok sayar.
type ClipConsent struct {
	T  string `json:"t"`
	On bool   `json:"on"`
}

// ClipPush teknisyen müşterinin panosuna `bytes` bayt metin koymak istiyor (veri DC `clip.data` ile gelir).
type ClipPush struct {
	T     string `json:"t"`
	CID   string `json:"cid"`
	Bytes int    `json:"bytes"`
}

// ClipPull teknisyen müşterinin panosunu istiyor.
type ClipPull struct {
	T   string `json:"t"`
	CID string `json:"cid"`
}

// PrintRequest teknisyen `sizeBytes` baytlık PDF yazdırmak istiyor (ad/hash DC `print.offer`'da).
type PrintRequest struct {
	T         string `json:"t"`
	PID       string `json:"pid"`
	SizeBytes int64  `json:"sizeBytes"`
}

// PrintCancel teknisyen vazgeçti / sunucu iptal etti (kontrol kapandı, teknisyen koptu).
type PrintCancel struct {
	T   string `json:"t"`
	PID string `json:"pid"`
}

func (m ClipConsent) Type() string  { return m.T }
func (m ClipPush) Type() string     { return m.T }
func (m ClipPull) Type() string     { return m.T }
func (m PrintRequest) Type() string { return m.T }
func (m PrintCancel) Type() string  { return m.T }

func validClipPush(m *ClipPush) bool {
	return cpIDRe.MatchString(m.CID) && m.Bytes >= 1 && m.Bytes <= ClipMaxBytes
}

func validPrintRequest(m *PrintRequest) bool {
	return cpIDRe.MatchString(m.PID) && m.SizeBytes >= PrintMinBytes && m.SizeBytes <= PrintMaxBytes
}

// validGuestFeatures hello/peer.joined `guestFeatures?`: en çok 3, bilinen ve benzersiz.
func validGuestFeatures(list []string) bool {
	if len(list) > guestFeaturesMax {
		return false
	}
	for i, f := range list {
		if !slices.Contains(guestFeatureValues, f) || slices.Contains(list[:i], f) {
			return false
		}
	}
	return true
}

// --- Misafir → sunucu (yalnız ilgili özelliği bildiren sokette şemadadır; çağıran bildirmediyse göndermez) ---

// ClipConsentSet müşterinin kendi tıklamasıyla anahtar değişimi (kapı kapanışlarında GÖNDERİLMEZ, §5.3).
type ClipConsentSet struct {
	T  string `json:"t"`
	ID string `json:"id,omitempty"`
	On bool   `json:"on"`
}

// ClipReport pano işinin sonucu (içerik yok).
type ClipReport struct {
	T      string `json:"t"`
	ID     string `json:"id,omitempty"`
	CID    string `json:"cid"`
	Dir    string `json:"dir"`
	Bytes  int    `json:"bytes"`
	Result string `json:"result"`
}

// PrintReport yazdırma işinin sonucu (AC-351: dosya adı ve hash yok).
type PrintReport struct {
	T         string `json:"t"`
	ID        string `json:"id,omitempty"`
	PID       string `json:"pid"`
	Decision  string `json:"decision"`
	Result    string `json:"result"`
	Pages     *int   `json:"pages,omitempty"`
	SizeBytes int64  `json:"sizeBytes"`
}

func (m ClipConsentSet) validate() error {
	if m.T != "clip.consent" {
		return fail(m.T, "tip")
	}
	return checkID(m.T, m.ID)
}

func (m ClipReport) validate() error {
	if m.T != "clip.report" {
		return fail(m.T, "tip")
	}
	if !cpIDRe.MatchString(m.CID) || !slices.Contains(clipDirections, m.Dir) || m.Bytes < 0 || m.Bytes > ClipMaxBytes ||
		!slices.Contains(clipGuestResults, m.Result) {
		return fail(m.T, "alan")
	}
	return checkID(m.T, m.ID)
}

func (m PrintReport) validate() error {
	if m.T != "print.report" {
		return fail(m.T, "tip")
	}
	if !cpIDRe.MatchString(m.PID) || !slices.Contains(printDecisions, m.Decision) ||
		!slices.Contains(printGuestResults, m.Result) || m.SizeBytes < 0 || m.SizeBytes > PrintMaxBytes ||
		(m.Pages != nil && (*m.Pages < 1 || *m.Pages > PrintMaxPages)) {
		return fail(m.T, "alan")
	}
	return checkID(m.T, m.ID)
}
