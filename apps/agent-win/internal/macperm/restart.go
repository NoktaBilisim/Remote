// Package macperm macOS izinleri (TCC) ve izin sonrası yeniden başlatmada destek kodunun korunmasıdır (mimari-p28f
// §5.3, §5.1 T6, AC-391, S-P28f-13). Ekran Kaydı yoklaması resolve'dan önce yapılır; izin yoksa rehber gösterilir ve
// "İzni verdim, yeniden başlat" ile `/usr/bin/open -n <bundle> --args --restart <belirteç>` çalıştırılır. Kod argümanla
// taşınmaz: kullanıcıya özel geçici dizinde belirteçle adlandırılmış 0600 dosyaya yazılır; yeni süreç yalnız eşleşen
// dosyayı okur ve siler.
package macperm

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
)

// RestartFlag tek kabul edilen komut satırı argümanı (T4; diğer argümanlar yok sayılır).
const RestartFlag = "--restart"

var tokenRe = regexp.MustCompile(`^[0-9a-f]{32}$`)

// RestartToken argümanlarda `--restart <32 küçük onaltılık>` varsa belirteç; yoksa ok=false.
func RestartToken(args []string) (string, bool) {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == RestartFlag && tokenRe.MatchString(args[i+1]) {
			return args[i+1], true
		}
	}
	return "", false
}

// NewToken rastgele 128 bit belirteç (gizli değil, yalnız eşleme).
func NewToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
