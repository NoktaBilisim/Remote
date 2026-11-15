package ui

import (
	"strings"

	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/request"
)

// Ana ekran (FirmHome) düğme kimlikleri (home_windows.go).
const (
	idHomeSupport = 70
	idHomeCode    = 71
	idHomeForget  = 72
)

// homeButton ana ekran düğmesi; dilim sırası oluşturma = Tab sırasıdır (AC-189).
type homeButton struct {
	text    string
	id      int
	enabled bool
	def     bool // varsayılan odak ve varsayılan düğme
}

// Firma listeli tek ana ekran (P20 K3, mimari-e11 §8d.3; tek ekran kararı 2026-11-15) kimlikleri ve metinleri
// (home_windows.go FirmHome).
const (
	idFirmList      = 74
	idFirmForgetOne = 75
	idFirmTray      = 76
	idFirmAutostart = 77

	firmPick          = "Destek istemek istediğiniz firmayı seçin:"
	singlePrefix      = "Kayıtlı firma: "
	autostartInfo     = "Windows açıldığında program tepside, pencere açmadan ve sunucuya bağlanmadan başlar."
	confirmForgetOne  = "%s bu bilgisayardan unutulsun mu? Bu firmadan destek istemek için yeniden dosya veya kod gerekir."
	confirmForgetAll  = "Bu bilgisayardaki tüm firma kayıtları ve kayıtlı bilgileriniz silinsin mi? Başka sunucunun kayıtları yalnız bu bilgisayardan silinir; o sunucuda iptal edilemez."
	firmListMaxRows   = 5
	firmRowHeight     = 20
	otherHeaderPrefix = "Başka sunucu ("
)

// firmButtons firma ekranı Tab sırası: Destek iste → Bağlantı kodum var → Bu firmayı unut → Bu bilgisayarı unut (tüm
// firmalar). Liste her zaman ilk satır seçili açılır: "Destek iste" satır varken etkindir (yoksa AC-190: pasif, varsayılan
// "Bağlantı kodum var"); "Bu firmayı unut" seçili satır kayıtlı bir firmaysa etkindir (dosyanın firması unutulamaz).
func firmButtons(v launch.FirmView) []homeButton {
	has := len(v.Firms) > 0
	return []homeButton{
		{text: "Destek iste", id: idHomeSupport, enabled: has, def: has},
		{text: "Bağlantı kodum var", id: idHomeCode, enabled: true, def: !has},
		{text: "Bu firmayı unut", id: idFirmForgetOne, enabled: forgettable(v, 0)},
		{text: "Bu bilgisayarı unut (tüm firmalar)", id: idHomeForget, enabled: true},
	}
}

// forgettable i. satır "Bu firmayı unut" ile silinebilir mi (yalnız kayıtlı firma; dosyanın firması kayıt değildir).
func forgettable(v launch.FirmView, i int) bool {
	return i >= 0 && i < len(v.Firms) && !v.Firms[i].File
}

// singleText tek satırlık ana ekranın satırı: kayıtlı firma "Kayıtlı firma: …", dosyanın firması kendi metniyle; satır
// yoksa AC-190 açıklaması (firma dosyası veya kod).
func singleText(v launch.FirmView) string {
	switch {
	case len(v.Firms) == 0:
		return request.MsgNoSource
	case v.Firms[0].File:
		return v.Firms[0].Text
	}
	return singlePrefix + v.Firms[0].Text
}

// listed firmalar liste kutusunda mı (birden çok satır ya da başka köken bloğu); değilse tek satır etiketi.
func listed(v launch.FirmView) bool {
	return !v.Single && len(v.Firms) > 0
}

// othersText başka kökenli kayıtlar: başlık + girintili satırlar (seçilemez, yalnız bilgi; K-P20-12).
func othersText(v launch.FirmView) string {
	var b strings.Builder
	for _, o := range v.Others {
		if b.Len() > 0 {
			b.WriteString("\r\n")
		}
		b.WriteString(otherHeaderPrefix + o.Host + ") — talep için seçilemez")
		for _, r := range o.Rows {
			b.WriteString("\r\n    " + r)
		}
	}
	return b.String()
}

// othersLines othersText'in satır sayısı (pencere yüksekliği).
func othersLines(v launch.FirmView) int {
	n := 0
	for _, o := range v.Others {
		n += 1 + len(o.Rows)
	}
	return n
}

// firmListRows liste kutusunun görünen satır sayısı (1..5).
func firmListRows(v launch.FirmView) int {
	return max(1, min(len(v.Firms), firmListMaxRows))
}

// firmHomeHeight FirmHome istemci alanı yüksekliği (home_windows.go yerleşimiyle aynı adımlar).
func firmHomeHeight(v launch.FirmView) int32 {
	y := int32(46)
	if !listed(v) {
		y += 40
	} else {
		y += 24 + int32(firmListRows(v)*firmRowHeight+8) + 8
	}
	if n := othersLines(v); n > 0 {
		y += int32(n*18) + 8
	}
	y += 40 // dolandırıcılık uyarısı
	if v.Notice != "" {
		y += 76
	}
	y += 38 + 42 + 28 + 40 // iki düğme satırı, tepsi kutusu, açıklama
	if !v.Toggles.AutostartHidden {
		y += 28 + 40
	}
	return y + 28 // altbilgi
}
