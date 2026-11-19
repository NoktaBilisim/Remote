package uicore

import (
	"strings"

	"remote-support/agent-win/internal/flow"
)

// Sürüm gösterimi (2026-11-18): Windows, macOS ve Linux istemcisinin her penceresinin başlığında uygulama adının
// yanında config.Version görünür ("Nokta Destek 0.20.0 — Oturum"). Biçimin tek tanımı flow.VersionLabel'dır.

// VersionLabel "Nokta Destek 0.20.0"; sürüm boşsa yalnız AppTitle.
func VersionLabel(version string) string { return flow.VersionLabel(version) }

// VersionedTitle başlıktaki ilk AppTitle'ı VersionLabel ile değiştirir ("Nokta Destek — Oturum" → "Nokta Destek
// 0.20.0 — Oturum", "(2 yeni) Nokta Destek — Oturum" → "(2 yeni) Nokta Destek 0.20.0 — Oturum"). Başlıkta uygulama
// adı yoksa sona " — <etiket>" eklenir. Sürüm boşsa ya da etiket zaten başlıktaysa başlık aynen döner. TEST derlemesinin
// başlık eki (GTK " — TEST") bu çıktının sonuna eklenir; macOS bandı pencere içindedir, çakışma yoktur.
func VersionedTitle(title, version string) string {
	label := VersionLabel(version)
	if label == AppTitle || strings.Contains(title, label) {
		return title
	}
	if strings.Contains(title, AppTitle) {
		return strings.Replace(title, AppTitle, label, 1)
	}
	if title == "" {
		return label
	}
	return title + " — " + label
}
