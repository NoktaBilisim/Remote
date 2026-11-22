// Package mac macOS istemcisinin AppKit arayüzüdür (mimari-p28f §2.1): flow.UI, ClipPrintUI, FileServerUI, RosterUI ve
// RecUI uygulamaları; P33'ten beri VoiceUI de (ADR-0043; `rs.cap.voice1` bildirilir). AppKit'e dokunan
// kod `*_darwin.go` dosyalarındadır; bu dosya ve testleri platformdan bağımsız karar mantığıdır (Linux/Windows CI'da da
// koşar).
package mac

import (
	"fmt"
	"net/url"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/input"
)

// --- §5.2a yerel tıklama (S-P28f-1) -------------------------------------------------------------------------------

// clickKind korunan denetime ulaşan etkileşimin sınıfı.
type clickKind int

const (
	clickLocal    clickKind = iota // input.LocalClick: basış + bırakma yerel fare tıklaması
	clickKeyboard                  // klavye etkinleştirmesi (Space/Enter/Tam Klavye Erişimi): uyarısız ret
	clickInjected                  // diğer her şey (sentetik, AX, performClick:, bayat): uyarılı ret
)

// NSEvent klavye türleri (NSEventTypeKeyDown/KeyUp).
const (
	nsKeyDown = 10
	nsKeyUp   = 11
)

// classifyClick eylem anındaki olay ve K3 input.LocalClick kararından sınıf (karar beyaz listesi input paketindedir).
func classifyClick(cur input.ClickEvent, local bool) clickKind {
	switch {
	case local:
		return clickLocal
	case cur.Present && (cur.Type == nsKeyDown || cur.Type == nsKeyUp):
		return clickKeyboard
	}
	return clickInjected
}

// --- AC-390 TEST bandı (S-P28f-7) ---------------------------------------------------------------------------------

// signInfo çalışan kodun imza bilgisi (SecCodeCopySigningInformation).
type signInfo struct {
	TeamID string
	AdHoc  bool
	Err    error
}

// showTestBand AC-504 / K-P28f-r4-5: bant TEST derlemesinde ya da beklenen Team ID gömülüyken imza ona uymuyorsa
// (okunamadı, Team ID boş, ad-hoc ya da başka ekip — D-P28f-K3: başka bir Developer ID ile yeniden imzalanmış paket)
// gösterilir. Prod ad-hoc derlemede (testBuild=false, beklenen Team ID boş) bant yoktur; imza Hakkında'da yazılır.
func showTestBand(si signInfo, testBuild bool, expectedTeam string) bool {
	return testBuild || (expectedTeam != "" && (si.Err != nil || si.TeamID == "" || si.AdHoc || si.TeamID != expectedTeam))
}

// aboutSigLine AC-504: Hakkında penceresindeki tek imza satırı. Okunamayan ya da Team ID'siz ve ad-hoc olmayan imza
// "doğrulanamadı" sayılır.
func aboutSigLine(si signInfo) string {
	t := flow.MacTexts
	switch {
	case si.Err != nil:
		return t.AboutSigUnknown
	case si.AdHoc:
		return t.AboutSigAdhoc
	case si.TeamID != "":
		return fmt.Sprintf(t.AboutSigDevID, si.TeamID)
	}
	return t.AboutSigUnknown
}

// flipRect AppKit pencere çerçevesini (sol alt köken, y yukarı; birincil ekran yüksekliği primaryH) genel
// CoreGraphics nokta koordinatına (sol üst köken, y aşağı) çevirir; her yönde 1 nokta dışa yuvarlanır (Y-P28f-K1).
func flipRect(x, y, w, h, primaryH float64) input.FRect {
	return input.FRect{X: x - 1, Y: primaryH - (y + h) - 1, W: w + 2, H: h + 2}
}

// --- P31 talep ekranları (mimari-p31 §6 T-P31-8) -----------------------------------------------------------------

// downloadPath request.DownloadURL'in sabit yolu.
const downloadPath = "/api/v1/public/agent/request-download"

// downloadURLAllowed OpenURL'in açabileceği TEK adres biçimi: https, kullanıcı bilgisiz, sabit yol, yalnız `ref` ve
// (isteğe bağlı) `os=macos` sorgusu, parçasız (request.DownloadURL çıktısı; köken orada gömülü sunucudan gelir).
// mailto ayrı yoldan (openMailto + uicore.MailtoAddr) açılır.
func downloadURLAllowed(s string) bool {
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" || u.Path != downloadPath ||
		u.Fragment != "" || u.Opaque != "" {
		return false
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(q["ref"]) != 1 {
		return false
	}
	for k, v := range q {
		if k != "ref" && (k != "os" || len(v) != 1 || v[0] != "macos") {
			return false
		}
	}
	return true
}
