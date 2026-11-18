package uicore

import "testing"

// Sürüm gösterimi (2026-11-18): etiket biçimi ve pencere başlığına yerleşimi.
func TestVersionLabel(t *testing.T) {
	cases := []struct{ in, want string }{
		{"0.20.0", "Nokta Destek 0.20.0"},
		{" 0.20.0\n", "Nokta Destek 0.20.0"},
		{"", "Nokta Destek"},
		{"   ", "Nokta Destek"},
	}
	for _, c := range cases {
		if got := VersionLabel(c.in); got != c.want {
			t.Errorf("VersionLabel(%q) = %q, beklenen %q", c.in, got, c.want)
		}
	}
}

func TestVersionedTitle(t *testing.T) {
	const v = "0.20.0"
	cases := []struct{ title, version, want string }{
		{AppTitle, v, "Nokta Destek 0.20.0"},
		{AppTitle + " — Oturum", v, "Nokta Destek 0.20.0 — Oturum"},
		{UnreadTitle(3), v, "(3 yeni) Nokta Destek 0.20.0 — Oturum"},
		{AppTitle + " Hakkında", v, "Nokta Destek 0.20.0 Hakkında"},
		{"Nokta Destek — Gözetimsiz Erişim", v, "Nokta Destek 0.20.0 — Gözetimsiz Erişim"},
		{"Gözetimsiz erişim: Açık", v, "Gözetimsiz erişim: Açık — Nokta Destek 0.20.0"},
		{"", v, "Nokta Destek 0.20.0"},
		// sürüm yok: başlık değişmez
		{AppTitle + " — Oturum", "", "Nokta Destek — Oturum"},
		{"Gözetimsiz erişim: Açık", "", "Gözetimsiz erişim: Açık"},
		// idempotent: iki kez uygulanınca etiket çiftlenmez
		{"Nokta Destek 0.20.0 — Oturum", v, "Nokta Destek 0.20.0 — Oturum"},
	}
	for _, c := range cases {
		if got := VersionedTitle(c.title, c.version); got != c.want {
			t.Errorf("VersionedTitle(%q, %q) = %q, beklenen %q", c.title, c.version, got, c.want)
		}
	}
}
