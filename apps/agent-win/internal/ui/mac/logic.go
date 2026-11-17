// Package mac macOS istemcisinin AppKit arayüzüdür (mimari-p28f §2.1): flow.UI, ClipPrintUI, FileServerUI, RosterUI ve
// RecUI uygulamaları. Ses yoktur (ADR-0037 r3; VoiceUI uygulanmaz → `rs.cap.voice1` bildirilmez). AppKit'e dokunan
// kod `*_darwin.go` dosyalarındadır; bu dosya ve testleri platformdan bağımsız karar mantığıdır (Linux/Windows CI'da da
// koşar).
package mac

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"remote-support/agent-win/internal/dc"
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

// --- §5.2b gösterge sağlığı (S-P28f-2) ----------------------------------------------------------------------------

// healthFailTicks ardışık başarısız tik sayısı (1 sn tik → ≈ 3 sn) sonunda kapı kapanır.
const healthFailTicks = 3

// health göstergenin görünürlük sayacı. observe her tikte çağrılır; failed true olduğu ilk tikte trip true döner
// (kapı bir kez kapatılır). Gösterge yeniden görünür olunca sayaç sıfırlanır; failed iken kontrol izni verilmez.
type health struct {
	bad    int
	failed bool
}

func (h *health) observe(visible bool) (trip bool) {
	if visible {
		h.bad, h.failed = 0, false
		return false
	}
	h.bad++
	if h.bad >= healthFailTicks && !h.failed {
		h.failed = true
		return true
	}
	return false
}

// --- AC-390 TEST bandı (S-P28f-7) ---------------------------------------------------------------------------------

// signInfo çalışan kodun imza bilgisi (SecCodeCopySigningInformation).
type signInfo struct {
	TeamID string
	AdHoc  bool
	Err    error
}

// showTestBand bant her durumda gösterilir: Team ID boş, ad-hoc, imza okunamadı, TEST derlemesi, beklenen Team ID
// gömülmemiş ya da imzanın Team ID'si beklenenden farklı (D-P28f-K3: başka bir Developer ID ile yeniden imzalanmış
// paket). Yalnız beklenen Developer ID ekibiyle imzalı (ad-hoc değil) ve TEST olmayan derlemede gizlidir.
func showTestBand(si signInfo, testBuild bool, expectedTeam string) bool {
	return testBuild || si.Err != nil || si.TeamID == "" || si.AdHoc || expectedTeam == "" || si.TeamID != expectedTeam
}

// flipRect AppKit pencere çerçevesini (sol alt köken, y yukarı; birincil ekran yüksekliği primaryH) genel
// CoreGraphics nokta koordinatına (sol üst köken, y aşağı) çevirir; her yönde 1 nokta dışa yuvarlanır (Y-P28f-K1).
func flipRect(x, y, w, h, primaryH float64) input.FRect {
	return input.FRect{X: x - 1, Y: primaryH - (y + h) - 1, W: w + 2, H: h + 2}
}

// --- metinler ve küçük biçimlendiriciler ----------------------------------------------------------------------------

// watchText AC-103 gösterge metni.
func watchText(granted bool, tech string) string {
	if granted {
		return "Uzaktan kontrol aktif — " + tech
	}
	return "Ekranınız izleniyor — " + tech
}

// hotkeyText oturum penceresindeki kısayol satırı (Windows ile aynı metin).
func hotkeyText(label string) string {
	if label == "" {
		return "Kontrolü kapatma kısayolu kaydedilemedi. Güvenliğiniz için uzaktan kontrol izni verilemez."
	}
	return "Uzaktan kontrolü anında kapatmak için: " + label
}

// controlBody AC-99 kontrol izni diyaloğu gövdesi.
func controlBody(tech, hotkey string) string {
	body := tech + " bilgisayarınızın faresini ve klavyesini kullanmak istiyor. İzin verirseniz ekranınızda yaptığı " +
		"her şeyi görürsünüz; istediğiniz an \"Kontrolü kapat\" düğmesiyle"
	if hotkey != "" {
		body += " veya " + hotkey + " tuşlarıyla"
	}
	return body + " kapatabilirsiniz."
}

// chatLimit oturum sohbet geçmişinin bellekte/ekranda tutulan en büyük boyutu (NSString sınırının altında).
const chatLimit = 48 << 10

// appendChat geçmişe "[ss:dd] kim: metin" satırı ekler; sınır aşılırsa en eski satırlar düşer. Metin yalnız düz
// metindir (setString:), biçim yorumlanmaz (S-P28f-12).
func appendChat(hist string, at time.Time, who, text string) string {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	hist += fmt.Sprintf("[%s] %s: %s\n", at.Format("15:04"), who, text)
	for len(hist) > chatLimit {
		i := strings.IndexByte(hist, '\n')
		if i < 0 || i == len(hist)-1 {
			return hist[len(hist)-chatLimit:]
		}
		hist = hist[i+1:]
	}
	return hist
}

// chatInputLimit sohbet giriş alanı (Windows EDIT sınırı 2000 karakter).
const chatInputLimit = 2000

// trimRunes s'yi en çok n rüne keser.
func trimRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// unreadTitle okunmamış mesaj sayılı oturum penceresi başlığı.
func unreadTitle(n int) string {
	if n <= 0 {
		return appTitle + " — Oturum"
	}
	return fmt.Sprintf("(%d yeni) %s — Oturum", n, appTitle)
}

const appTitle = "Nokta Destek"

// footerText AC-128 "Hakkında" satırı.
func footerText(host, version, fp string) string {
	return fmt.Sprintf("Sunucu: %s  ·  Sürüm %s  ·  Parmak izi %s", host, version, fp)
}

// mailtoAddr S-P28f-12: "Kötüye kullanımı bildir" adresi (flow api.ValidAbuseEmail'den geçmiş olsa da) yalnız güvenli
// karakterli tek adres; aksi halde "" (düğme gizlenir).
var mailtoRe = regexp.MustCompile(`^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,253}\.[A-Za-z]{2,63}$`)

func mailtoAddr(addr string) string {
	if !mailtoRe.MatchString(addr) {
		return ""
	}
	return addr
}

// bgrToRGBA uicore.FitBGR çıktısını (yukarıdan aşağı BGR, satır `(w*3+3)&^3` bayt) opak RGBA'ya çevirir
// (NSBitmapImageRep, 4 örnek, 8 bit; logo Go'da çözülür, S-P28f-12).
func bgrToRGBA(bgr []byte, w, h int) []byte {
	stride := (w*3 + 3) &^ 3
	if w <= 0 || h <= 0 || len(bgr) < stride*h {
		return nil
	}
	out := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			s, d := y*stride+x*3, (y*w+x)*4
			out[d], out[d+1], out[d+2], out[d+3] = bgr[s+2], bgr[s+1], bgr[s], 0xff
		}
	}
	return out
}

// --- AC-37/56 işaretleme ----------------------------------------------------------------------------------------------

// annotStroke tek çizim (0..1 normalize noktalar).
type annotStroke struct {
	id, tool, color string
	pts             [][2]float64
}

// annotColor Windows katmanıyla aynı dört renk (sRGB 0..1); bilinmeyen renk kırmızı.
func annotColor(name string) [3]float64 {
	c := map[string][3]float64{"red": {239, 68, 68}, "yellow": {234, 179, 8}, "green": {34, 197, 94},
		"blue": {59, 130, 246}}[name]
	if c == ([3]float64{}) {
		c = [3]float64{239, 68, 68}
	}
	return [3]float64{c[0] / 255, c[1] / 255, c[2] / 255}
}

// maxStrokes bellekte tutulan en çok çizim (teknisyenden sınırsız ileti katmanı şişirmesin).
const maxStrokes = 500

// applyAnnot işaretleme iletisini uygular; laser true ise lazer noktası (yeniden) kondu.
func applyAnnot(strokes []annotStroke, laser *[2]float64, m dc.Ctl) ([]annotStroke, *[2]float64, bool) {
	switch m.T {
	case "annot.stroke":
		if len(m.Pts) > 0 {
			strokes = append(strokes, annotStroke{m.ID, m.Tool, m.Color, m.Pts})
			if len(strokes) > maxStrokes {
				strokes = strokes[len(strokes)-maxStrokes:]
			}
		}
	case "annot.laser":
		if m.X != nil && m.Y != nil {
			return strokes, &[2]float64{*m.X, *m.Y}, true
		}
	case "annot.undo":
		for i := len(strokes) - 1; i >= 0; i-- {
			if m.ID == "" || strokes[i].id == m.ID {
				strokes = append(strokes[:i:i], strokes[i+1:]...)
				break
			}
		}
	case "annot.clear":
		return nil, nil, false
	}
	return strokes, laser, false
}

// strokePolylines çizimin piksel uzayındaki (w×h, sol üst orijin) çoklu çizgileri: dikdörtgen kapalı çizgi, ok gövde +
// iki uç çizgisi (±30°, 16 pt), serbest çizgi noktaları.
func strokePolylines(s annotStroke, w, h float64) [][][2]float64 {
	if len(s.pts) == 0 {
		return nil
	}
	px := func(p [2]float64) [2]float64 { return [2]float64{p[0] * w, p[1] * h} }
	a, b := px(s.pts[0]), px(s.pts[len(s.pts)-1])
	switch s.tool {
	case "rect":
		return [][][2]float64{{a, {b[0], a[1]}, b, {a[0], b[1]}, a}}
	case "arrow":
		dx, dy := b[0]-a[0], b[1]-a[1]
		l := max(1, math.Hypot(dx, dy))
		ux, uy := dx/l, dy/l
		const c, sn, size = 0.866, 0.5, 16.0
		out := [][][2]float64{{a, b}}
		for _, sign := range []float64{1, -1} {
			hx, hy := ux*c-sign*uy*sn, uy*c+sign*ux*sn
			out = append(out, [][2]float64{b, {b[0] - hx*size, b[1] - hy*size}})
		}
		return out
	}
	line := make([][2]float64, len(s.pts))
	for i, p := range s.pts {
		line[i] = px(p)
	}
	return [][][2]float64{line}
}

// stripAccel ortak metin tablolarındaki Win32 erişim tuşu işaretini kaldırır ("Kaydı &durdur" → "Kaydı durdur";
// "&&" düz "&").
func stripAccel(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(s, "&&", "\x00"), "&", ""), "\x00", "&")
}
