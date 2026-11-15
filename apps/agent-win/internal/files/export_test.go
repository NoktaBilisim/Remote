package files

import "unicode/utf8"

// IsSanitized: ad temizlenmiş ve 1..255 karakter (sunucu DB CHECK ile aynı koşul). Yalnız testte kullanılır (PT-K7).
func IsSanitized(name string) bool {
	return name != "" && utf8.ValidString(name) && SanitizeFileName(name) == name
}
