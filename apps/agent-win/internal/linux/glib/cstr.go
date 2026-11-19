package glib

import (
	"errors"
	"strings"
	"unicode/utf8"
)

// MaxStringBytes C'ye giden ya da C'den okunan tek dizginin üst sınırı (FFI kuralı 6). Ağdan gelen metinlerin kendi
// (daha dar) sınırları ayrıca uygulanır; bu sınır son savunmadır. C'den dizgi okuma yardımcısı ilk kullanan pakette
// (K4) eklenir.
const MaxStringBytes = 64 << 10

// ErrBadString dizgi C'ye verilemez (uzun, geçersiz UTF-8 ya da gömülü NUL).
var ErrBadString = errors.New("glib: dizgi C'ye verilemez")

// CString NUL sonlu kopya (Go belleği; yalnız çağrı süresince yaşar, C'de saklatılmaz — FFI kuralı 2).
func CString(s string) (*byte, error) {
	if len(s) > MaxStringBytes || !utf8.ValidString(s) || strings.IndexByte(s, 0) >= 0 {
		return nil, ErrBadString
	}
	b := make([]byte, len(s)+1)
	copy(b, s)
	return &b[0], nil
}
