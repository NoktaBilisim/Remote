//go:build darwin

package files

import (
	"fmt"
	"time"

	"golang.org/x/sys/unix"
)

// QuarantineAttr macOS karantina özniteliğinin adı (Gatekeeper alınan dosyayı ilk açılışta denetler).
const QuarantineAttr = "com.apple.quarantine"

// quarantineAgent özniteliğe yazılan indirici adı (Finder "… tarafından indirildi" uyarısında görünür).
const quarantineAgent = "Nokta Destek"

// QuarantineValue `0083;<onaltılık unix zamanı>;Nokta Destek;` (mimari-p28f §2, T8). Bayraklar 0x0083 sabittir;
// 0x0040 (USER_APPROVED — kullanıcı onayladı, Gatekeeper sormaz) hiçbir zaman konmaz. Son alan (olay UUID'si) boştur
// (karantina olayları veritabanına bağ yok).
func QuarantineValue(t time.Time) string {
	return fmt.Sprintf("0083;%08x;%s;", t.Unix(), quarantineAgent)
}

// WriteQuarantine alınan dosyaya (transfer bunu `.part`'a yeniden adlandırmadan önce çağırır; öznitelik dosyayla taşınır)
// karantina özniteliğini yazar — Windows MOTW'nin karşılığı (AC-117, S-P28f-9). Sembolik bağ izlenmez (XATTR_NOFOLLOW).
// Hata döndüğünde transfer dosyayı teslim etmez (macOS'ta her türde, fail-closed; internal/transfer motw_darwin.go).
func WriteQuarantine(path string) error {
	return unix.Setxattr(path, QuarantineAttr, []byte(QuarantineValue(time.Now())), unix.XATTR_NOFOLLOW)
}
