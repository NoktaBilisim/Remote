// Package helperio gözetimsiz servis (`--service`, internal/servis) ile yardımcı süreç (`--helper`, K6) arasındaki
// sözleşmedir (mimari-p27 §5.2): servis yardımcıyı başlatırken girdiyi **devralınan anonim borunun** okuma ucundan
// (yardımcının stdin'i) tek JSON nesnesi olarak verir — komut satırında gizli değer yoktur. Yardımcının çıkış kodu
// bitiş nedenidir. Paket yalnız standart kütüphaneye bağlıdır (yardımcının derleme sınırı testi, K6).
package helperio

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"unicode"
	"unicode/utf8"
)

// MaxInput girdi borusundan okunacak en çok bayt (aşım reddedilir).
const MaxInput = 4096

// Version girdi biçimi sürümü.
const Version = 1

// Input yardımcının tek girdisi. Ticket yalnız bellekte tutulur; loga/olay günlüğüne yazılmaz.
type Input struct {
	V             int    `json:"v"`
	SessionID     string `json:"sessionId"`
	Ticket        string `json:"ticket"`
	TechName      string `json:"techName"`
	TenantName    string `json:"tenantName"`
	TechIP        string `json:"techIp"`
	IndicatorText string `json:"indicatorText"`
	ExpiresInSec  int    `json:"expiresInSec"`
	// P28u (§7.4, p28u.go): Consent "ask"|"none", Mode "asked"|"no_user"|"silent", IndicatorControl (yalnız silent).
	Consent          string `json:"consent,omitempty"`
	Mode             string `json:"mode,omitempty"`
	IndicatorControl string `json:"indicatorControl,omitempty"`
	// P28e (mimari-p28e §8; p28e.go): sunucu `connect.recording` gönderdi. asked'da diyalog satırı (ConsentSpec.RecordingLine),
	// her kipte gösterge eki. Yalnız P28u girdisinde (Consent dolu) geçerlidir.
	Recording bool `json:"recording,omitempty"`
}

var (
	ulidRe   = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
	ticketRe = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`) // contracts ws-device `connect.ticket`
)

// ErrInvalid girdi sözleşmeye uymuyor.
var ErrInvalid = errors.New("helperio: geçersiz girdi")

// Validate alanları denetler.
func (in Input) Validate() error {
	switch {
	case in.V != Version:
		return fmt.Errorf("%w: sürüm", ErrInvalid)
	case !ulidRe.MatchString(in.SessionID):
		return fmt.Errorf("%w: sessionId", ErrInvalid)
	case !ticketRe.MatchString(in.Ticket):
		return fmt.Errorf("%w: ticket", ErrInvalid)
	case !Text(in.TechName, 120) || !Text(in.TenantName, 120) || !Text(in.IndicatorText, 160):
		return fmt.Errorf("%w: metin", ErrInvalid)
	case len(in.TechIP) > 45:
		return fmt.Errorf("%w: techIp", ErrInvalid)
	case in.ExpiresInSec < 1 || in.ExpiresInSec > 300:
		return fmt.Errorf("%w: expiresInSec", ErrInvalid)
	}
	return in.validateP28u()
}

// Text boş olmayan, en çok n karakterlik, kontrol karakteri içermeyen geçerli UTF-8 metin mi.
func Text(s string, n int) bool {
	if s == "" || !utf8.ValidString(s) || utf8.RuneCountInString(s) > n {
		return false
	}
	for _, r := range s {
		if Unsafe(r) {
			return false
		}
	}
	return true
}

// Unsafe contracts `UNSAFE_NAME_CHARS` eşi: kontrol (Cc), biçim (Cf — ör. U+202E yön değiştirme), satır/paragraf
// ayırıcı ve görünmez birleştiriciler.
func Unsafe(r rune) bool {
	return unicode.Is(unicode.Cc, r) || unicode.Is(unicode.Cf, r) || unicode.Is(unicode.Zl, r) ||
		unicode.Is(unicode.Zp, r) || r == 0x034F || r == 0x180E
}

// Encode doğrulayıp JSON'a çevirir (servis tarafı). P28u: satır '\n' ile biter — boru açık kaldığı için yardımcı
// (ReadInput) ilk satırı yeni satırla ayırır; eski Read sondaki boşluğu kabul eder.
func Encode(in Input) ([]byte, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	b, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

// Read borudan tek girdiyi okur ve doğrular (yardımcı tarafı). Bilinmeyen alan ve MaxInput aşımı reddedilir.
func Read(r io.Reader) (Input, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxInput+1))
	if err != nil {
		return Input{}, err
	}
	if len(data) > MaxInput {
		return Input{}, fmt.Errorf("%w: boyut", ErrInvalid)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var in Input
	if err := dec.Decode(&in); err != nil {
		return Input{}, fmt.Errorf("%w: json", ErrInvalid)
	}
	if dec.More() {
		return Input{}, fmt.Errorf("%w: fazladan veri", ErrInvalid)
	}
	return in, in.Validate()
}

// Çıkış kodları (yardımcı → servis). Windows'un çökme kodları (0xC0000005 vb.) ve tanımsız değerler helper_failed sayılır.
const (
	ExitEnded           uint32 = 0  // oturum normal bitti (`session.ended`)
	ExitIndicatorFailed uint32 = 20 // gösterge çizilemedi/doğrulanamadı (AC-294, fail-closed)
	ExitHelperFailed    uint32 = 21 // açılış hatası (jeton ayrıcalık denetimi, girdi, ağ)
	ExitNoConsole       uint32 = 22 // konsol oturumu yok
	ExitSessionChanged  uint32 = 23 // konsol oturumu değişti (WTS_CONSOLE_CONNECT/DISCONNECT)
	ExitKilledByService uint32 = 30 // servis TerminateProcess ile kesti (neden serviste tutulur)
)

// Bitiş nedenleri (`connect.result.reason`, `session.closed.reason`; mimari-p27 §4.4).
const (
	ReasonEnded           = "ended"
	ReasonIndicatorFailed = "indicator_failed"
	ReasonHelperFailed    = "helper_failed"
	ReasonNoConsole       = "no_console"
	ReasonSessionChanged  = "session_changed"
)

// Reason çıkış kodunun bitiş nedeni.
func Reason(code uint32) string {
	switch code {
	case ExitEnded:
		return ReasonEnded
	case ExitIndicatorFailed:
		return ReasonIndicatorFailed
	case ExitNoConsole:
		return ReasonNoConsole
	case ExitSessionChanged:
		return ReasonSessionChanged
	case ExitConsentDenied:
		return ReasonConsentDenied
	case ExitConsentTimeout:
		return ReasonConsentTimeout
	}
	return ReasonHelperFailed
}

// PreJoin neden yardımcı `/ws/guest`'e katılmadan oluşabilen bir ret mi (servis `connect.result{ok:false}` gönderir).
func PreJoin(reason string) bool {
	return reason == ReasonIndicatorFailed || reason == ReasonHelperFailed || reason == ReasonNoConsole ||
		reason == ReasonConsentDenied || reason == ReasonConsentTimeout
}
