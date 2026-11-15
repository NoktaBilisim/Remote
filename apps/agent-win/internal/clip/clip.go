// Package clip müşteri panosuyla yalnız metin alışverişidir (P28a, mimari-p28 §5.3 r2 D-P28a-2; AC-345, AC-346).
// Okuma yalnız CF_UNICODETEXT; parola yöneticilerinin "gizli" işaretlerinden biri varsa içerik okunmaz (SENSITIVE).
// Yazma metni Win+V geçmişine ve bulut panosuna düşürmeyen biçimlerle birlikte koyar. UTF-16 ↔ UTF-8 kayıpsız, satır
// sonu dönüştürülmez. Bu dosya platformdan bağımsız mantıktır; Win32 çağrıları clip_windows.go'dadır.
package clip

import (
	"errors"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

// MaxBytes pano metninin UTF-8 üst sınırı (contracts CLIP_MAX_BYTES, 64 KB).
const MaxBytes = 65536

// maxGlobalBytes okuma öncesi GlobalSize sınırı: 65 536 UTF-16 birimi + NUL (§5.3 r2: > 131 074 → TOO_LARGE).
const maxGlobalBytes = (MaxBytes + 1) * 2

// Timeout pano iş parçacığındaki tek işlemin üst süresi (D-P28a-2).
const Timeout = 2 * time.Second

var (
	ErrEmpty       = errors.New("clip: panoda metin yok")
	ErrTooLarge    = errors.New("clip: metin 64 KB'tan büyük")
	ErrSensitive   = errors.New("clip: pano içeriği gizli olarak işaretli")
	ErrInvalid     = errors.New("clip: metin geçersiz")
	ErrFailed      = errors.New("clip: pano işlemi başarısız")
	ErrUnsupported = errors.New("clip: bu platformda desteklenmiyor")
)

// Clipboard müşteri panosu (flow K3 bağlar). Yöntemler her goroutine'den çağrılabilir; işlemler tek pano iş
// parçacığında sırayla yürür, her biri en çok Timeout bekler (aşımda ErrFailed).
type Clipboard interface {
	// ReadText panodaki metin. ErrEmpty, ErrTooLarge, ErrSensitive, ErrInvalid, ErrFailed.
	ReadText() (string, error)
	// WriteText metni koyar (geçmiş/bulut dışı). ErrInvalid, ErrTooLarge, ErrFailed.
	WriteText(s string) error
	// Close pano iş parçacığını durdurur.
	Close()
}

// Gizli işaret biçimlerinin kayıtlı adları (D-P28a-2).
const (
	FormatExclude      = "ExcludeClipboardContentFromMonitorProcessing"
	FormatViewerIgnore = "Clipboard Viewer Ignore"
	FormatHistory      = "CanIncludeInClipboardHistory"
	FormatCloud        = "CanUploadToCloudClipboard"
)

// marks panodaki gizlilik işaretleri. history/cloud: biçim var ve değeri okundu; *Zero: değer 0 (veya okunamadı —
// güvenli taraf).
type marks struct {
	exclude, viewerIgnore bool
	historyZero           bool
	cloudZero             bool
}

// sensitive dört biçimden biri işaretliyse true (teknisyenin koyduğu metin de geri okunursa SENSITIVE — §5.3 r2).
func (m marks) sensitive() bool {
	return m.exclude || m.viewerIgnore || m.historyZero || m.cloudZero
}

// flagZero biçim verisinin DWORD değeri 0 mı; 4 bayttan kısa/okunamayan veri gizli sayılır.
func flagZero(data []byte, ok bool) bool {
	if !ok || len(data) < 4 {
		return true
	}
	return data[0]|data[1]|data[2]|data[3] == 0
}

// checkGlobalSize okuma öncesi bayt sınırı (içerik kopyalanmadan).
func checkGlobalSize(n uintptr) error {
	switch {
	case n < 2:
		return ErrEmpty
	case n > maxGlobalBytes:
		return ErrTooLarge
	}
	return nil
}

// decodeUTF16 ilk NUL'a kadar olan birimleri UTF-8'e çevirir. Eşsiz vekil (kayıpsız çevrilemez) ErrInvalid; sonuç
// boşsa ErrEmpty; UTF-8 > MaxBytes ErrTooLarge.
func decodeUTF16(units []uint16) (string, error) {
	for i, u := range units {
		if u == 0 {
			units = units[:i]
			break
		}
	}
	if len(units) == 0 {
		return "", ErrEmpty
	}
	n := 0
	for i := 0; i < len(units); i++ {
		u := units[i]
		switch {
		case u < 0x80:
			n++
		case u < 0x800:
			n += 2
		case utf16.IsSurrogate(rune(u)):
			if u >= 0xDC00 || i+1 >= len(units) || units[i+1] < 0xDC00 || units[i+1] > 0xDFFF {
				return "", ErrInvalid
			}
			i++
			n += 4
		default:
			n += 3
		}
		if n > MaxBytes {
			return "", ErrTooLarge
		}
	}
	return string(utf16.Decode(units)), nil
}

// encodeUTF16 yazılacak metni doğrular (boş değil, geçerli UTF-8, U+0000 yok, ≤ MaxBytes) ve NUL sonlu UTF-16 döner.
func encodeUTF16(s string) ([]uint16, error) {
	switch {
	case s == "":
		return nil, ErrInvalid
	case len(s) > MaxBytes:
		return nil, ErrTooLarge
	case !utf8.ValidString(s):
		return nil, ErrInvalid
	}
	for i := 0; i < len(s); i++ {
		if s[i] == 0 {
			return nil, ErrInvalid
		}
	}
	return append(utf16.Encode([]rune(s)), 0), nil
}
