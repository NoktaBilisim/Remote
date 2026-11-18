package flow

import "strings"

// AppName istemcinin görünen adı (uicore.AppTitle bu sabittir). Sürüm etiketi (2026-11-18, "her istemci arayüzünde
// sürüm görünür") burada tanımlanır: ui/uicore'u içe aktaramayan gözetimsiz yardımcı (AC-341 sınırı) da aynı biçimi
// kullanır. Arayüzler uicore.VersionLabel / uicore.VersionedTitle üzerinden çağırır.
const AppName = "Nokta Destek"

// VersionLabel "Nokta Destek 0.20.0" (config.Version); sürüm boşsa yalnız ad.
func VersionLabel(version string) string {
	v := strings.TrimSpace(version)
	if v == "" {
		return AppName
	}
	return AppName + " " + v
}
