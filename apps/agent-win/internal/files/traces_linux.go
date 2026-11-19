//go:build linux

package files

import (
	"os"
	"path/filepath"
)

// İz önlemleri (AC-401, mimari-p28g §5.3). Özel geçici dizin (cmd/noktadestek privateDir) kapanışta silinir; GStreamer
// kaydı, fontconfig ve mesa önbelleği XDG_CACHE_HOME ile oraya gider (K1 applyEnv). dconf'a yazılmaz (yalnız okunur;
// `$XDG_RUNTIME_DIR/dconf` oturum servisinindir, tmpfs). Burada yalnız libpulse'ın paylaşılan çerez dosyası ele alınır.

// pulseCookieFiles libpulse'ın varsayılan olarak okuduğu çerezler (PA_NATIVE_COOKIE_FILE, eski yedek ad).
var pulseCookieFiles = []string{filepath.Join(".config", "pulse", "cookie"), ".pulse-cookie"}

// PulseCookieEnv libpulse istemcisi çerez dosyası bulamazsa `~/.config/pulse/cookie`'yi OLUŞTURUR (bağlantıdan önce).
// Kullanıcının çerezi varsa dokunulmaz (yalnız okunur, iz değildir) ve "" döner. Yoksa çerez özel dizine yönlendirilir
// (PULSE_COOKIE=<priv>/pulse-cookie; kapanışta silinir). Aynı kullanıcının unix soketinde pulseaudio (22.04) kimliği
// SCM_CREDENTIALS ile doğrular, pipewire-pulse (24.04) çerez denetlemez; bu yüzden yeni çerez bağlantıyı bozmaz.
func PulseCookieEnv(home, priv string) string {
	if !filepath.IsAbs(home) || !filepath.IsAbs(priv) {
		return ""
	}
	for _, f := range pulseCookieFiles {
		if _, err := os.Lstat(filepath.Join(home, f)); err == nil {
			return ""
		}
	}
	return filepath.Join(priv, "pulse-cookie")
}
