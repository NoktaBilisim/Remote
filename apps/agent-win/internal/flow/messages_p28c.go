package flow

// P28c çoklu teknisyen metinleri (mimari-p28c §1.1 rol etiketleri, §5.3 "Çıkar", §6 gösterge). Tek tablo: Windows
// oturum penceresi (internal/ui) ve gözetimsiz yardımcı göstergesi (internal/unattended/helper) buradan okur. Web eşi
// `apps/web/messages/tr.json` (aynı cümleler).

// MultiTexts müşteri arayüzü metinleri.
var MultiTexts = struct {
	ListTitle     string // oturum penceresi bölüm başlığı
	RoleControl   string // roster "controller"
	RoleMember    string // roster "participant"
	RoleObserver  string // roster "observer"
	OwnerBadge    string // oturum sahibi rozeti (rol etiketine eklenir)
	Disconnected  string // connected:false satır eki
	Remove        string // satır düğmesi
	RemoveTitle   string // onay diyaloğu başlığı
	RemoveBody    string // "%s" = teknisyen adı
	IndicatorList string // gözetimsiz gösterge eki: " · Bağlı: " + adlar
	NameSep       string
}{
	ListTitle:     "Bağlı teknisyenler",
	RoleControl:   "Kontrol sahibi",
	RoleMember:    "Katılımcı",
	RoleObserver:  "İzleyici",
	OwnerBadge:    "Oturum sahibi",
	Disconnected:  "bağlantı koptu",
	Remove:        "Çıkar",
	RemoveTitle:   "Teknisyeni çıkar",
	RemoveBody:    "%s bu oturumdan çıkarılsın mı? Bu oturuma yeniden katılamaz.",
	IndicatorList: " · Bağlı: ",
	NameSep:       ", ",
}

// roleLabel roster rolünün müşteriye gösterilen etiketi.
func roleLabel(role string) string {
	switch role {
	case "controller":
		return MultiTexts.RoleControl
	case "observer":
		return MultiTexts.RoleObserver
	}
	return MultiTexts.RoleMember
}
