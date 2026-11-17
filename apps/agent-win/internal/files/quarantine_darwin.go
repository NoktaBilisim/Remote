//go:build darwin

package files

import "errors"

// P28f K1 iskeleti (mimari-p28f §2, T8): `com.apple.quarantine` yazımı K5'te. O zamana kadar her çağrı hata döner;
// transfer bunu fail-closed işler (uyarılı ad reddedilir, AC-117 karşılığı).
var errQuarantine = errors.New("files: quarantine bu sürümde yazılamıyor")

// WriteQuarantine alınan dosyaya karantina özniteliği yazar (K5: `0083;<zaman>;Nokta Destek;`, unix.Setxattr).
func WriteQuarantine(string) error { return errQuarantine }
