package ui

import "remote-support/agent-win/internal/request"

// Ana ekran düğme kimlikleri (home_windows.go).
const (
	idHomeSupport = 70
	idHomeCode    = 71
	idHomeForget  = 72
	idHomeAbuse   = 73
)

// homeButton ana ekran düğmesi; dilim sırası oluşturma = Tab sırasıdır (AC-189).
type homeButton struct {
	text    string
	id      int
	enabled bool
	def     bool // varsayılan odak ve varsayılan düğme
}

// homeButtons AC-189 Tab sırası: Destek iste → Bağlantı kodum var → Bu bilgisayarı unut → Kötüye kullanımı bildir.
// "Destek iste" pasifse (AC-190) varsayılan odak "Bağlantı kodum var". "Bu bilgisayarı unut" her zaman etkin
// (idempotent). "Kötüye kullanımı bildir" yalnız adres varsa.
func homeButtons(v request.HomeView) []homeButton {
	b := []homeButton{
		{text: "Destek iste", id: idHomeSupport, enabled: v.Support, def: v.Support},
		{text: "Bağlantı kodum var", id: idHomeCode, enabled: true, def: !v.Support},
		{text: "Bu bilgisayarı unut", id: idHomeForget, enabled: true},
	}
	if v.AbuseEmail != "" {
		b = append(b, homeButton{text: "Kötüye kullanımı bildir", id: idHomeAbuse, enabled: true})
	}
	return b
}

// registeredText AC-182 kayıt satırı.
func registeredText(label string) string {
	if label == "" {
		return ""
	}
	return "Bu bilgisayar " + label + " için kayıtlı"
}
