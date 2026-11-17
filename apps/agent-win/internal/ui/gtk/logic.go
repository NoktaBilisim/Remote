// Package gtk Linux istemcisinin GTK3 arayüzüdür (mimari-p28g §2.1; ADR-0038 m.2, m.4): flow.UI, ClipPrintUI,
// FileServerUI, RosterUI, VoiceUI ve RecUI uygulamaları. GTK'ya dokunan kod `*_linux.go` dosyalarındadır (purego,
// internal/linux/glib FFI kuralları); bu dosya ve testleri platformdan bağımsız karar mantığıdır (her CI'da koşar).
// Ortak metin/çizim mantığı ui/uicore'dadır (macOS ile aynı).
package gtk

import (
	"fmt"
	"net"
	"net/url"
	"strings"

	"remote-support/agent-win/internal/ui/uicore"
)

// --- §5.2a yerel tıklama ------------------------------------------------------------------------------------------

// ButtonEvent GdkEventButton'dan geri çağrı içinde kopyalanan alanlar (GdkEvent işaretçisi geri çağrıdan sonra
// geçersizdir). Sıfır değer = olay yok (ret).
type ButtonEvent struct {
	Present   bool
	Release   bool   // GDK_BUTTON_RELEASE (değilse GDK_BUTTON_PRESS)
	Button    uint32 // 1 = sol
	SendEvent bool   // GdkEventButton.send_event != 0
	DeviceID  int32  // gdk_x11_device_get_id(gdk_event_get_source_device); okunamazsa -1
	Time      uint32 // X sunucu zamanı (ms)
	Inside    bool   // bırakma denetimin ayrılmış alanı içinde (GTK kapması dışarıdaki bırakmayı da verir)
}

// ClickGuard §5.2a localClick'in tek tanımı K3'tedir (input/localclick_linux.go): XTEST alt aygıt kimlikleri (m.3),
// enjektörün duraklatılmış olması ve son enjeksiyondan bu yana ≥ 1,5 sn (m.4), erişilebilirlik tıklama ayarının oturumda
// açılmamış olması (m.5). cmd/noktadestek bu arabirimi K3'ün kararına bağlar. nil → her korunan eylem reddedilir
// (fail-closed).
type ClickGuard interface {
	LocalClick(press, release ButtonEvent) bool
	// A11yChanged m.5: bekleme tıklaması / Fare Tuşları oturum sırasında kapalıdan açığa geçti (ret metni için).
	A11yChanged() bool
}

// clickKind korunan denetime ulaşan etkileşimin sınıfı.
type clickKind int

const (
	clickLocal    clickKind = iota // basış + bırakma, iki olay da kurallardan geçti
	clickA11y                      // m.5: erişilebilirlik ayarı oturumda açıldı (uyarı metniyle ret)
	clickInjected                  // diğer her şey (sentetik, XTEST, eşsiz bırakma, bayat): uyarılı ret
)

// classifyClick §5.2a m.1–m.2 arayüz tarafı (aynı denetimde sol basış + sol bırakma, ikisi de send_event 0, bırakma
// denetim içinde) ve m.3–m.5 için K3 kararı. Klavye, AT-SPI ve mnemonic bu yola hiç girmez (clicked/activate/toggled
// korunan denetimde bağlı değildir).
func classifyClick(g ClickGuard, press, release ButtonEvent, havePress bool) clickKind {
	if g == nil || !havePress || !press.Present || !release.Present || press.Release || !release.Release ||
		press.Button != 1 || release.Button != 1 || press.SendEvent || release.SendEvent || !release.Inside {
		return clickInjected
	}
	if g.A11yChanged() {
		return clickA11y
	}
	if !g.LocalClick(press, release) {
		return clickInjected
	}
	return clickLocal
}

// textMax C'ye verilen tek ekran metninin üst sınırı (sohbet geçmişi uicore.ChatLimit ile zaten sınırlı).
const textMax = 64 << 10

// clean ağdan gelen metni C'ye verilebilir yapar: geçersiz UTF-8 "\uFFFD", NUL kaldırılır, rün sınırında kesilir.
func clean(s string) string {
	s = strings.ReplaceAll(strings.ToValidUTF8(s, "\uFFFD"), "\x00", "")
	for len(s) > textMax {
		r := []rune(s)
		s = string(r[:len(r)*9/10])
	}
	return s
}

// --- tema (O-P28g-T2-1) -----------------------------------------------------------------------------------------------

// themeName sabit tema: GTK'nın gömülü kaynağı (dosya sisteminden yüklenmez).
const themeName = "Adwaita"

// darkFrom XSETTINGS'ten okunan değerlerden yalnız bir bool türetir. GNOME 42/46 gsd-xsettings koyu tercihi GTK3'e
// `Gtk/ApplicationPreferDarkTheme` olarak değil, yalnız `Net/ThemeName` ("Yaru-dark", "Adwaita-dark") olarak verir
// (imajda doğrulandı); bu yüzden ad yalnız "-dark" son ekiyle bool'a çevrilir, tema içeriği asla yüklenmez.
func darkFrom(name string, preferDark bool) bool {
	return preferDark || strings.HasSuffix(strings.ToLower(strings.TrimSpace(name)), "-dark")
}

// Korunan bileşen CSS sınıfları (§2.1 r3).
const (
	clsWindow    = "noktadestek-window"
	clsLabel     = "noktadestek-label"
	clsDanger    = "noktadestek-danger"
	clsButton    = "noktadestek-button"
	clsField     = "noktadestek-field"
	clsIndicator = "noktadestek-indicator"
	clsBold      = "noktadestek-bold"
	clsCode      = "noktadestek-code"
)

func hex(c uicore.RGB) string { return fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B) }

// themeCSS ekran düzeyinde PRIORITY_USER+1 ile eklenen sağlayıcının metni: korunan bileşenlerde opaklık, zemin resmi,
// renk/zemin token'ları ve boyut alt sınırı sabittir (kullanıcı gtk.css'i bunları ezemez). -gtk-icon-* kullanılmaz.
// Renkler tek tanımdan (uicore/theme.go).
func themeCSS(dark bool) string {
	p := uicore.ThemePalette(dark)
	fix := "opacity: 1; background-image: none; text-shadow: none; box-shadow: none; "
	var b strings.Builder
	fmt.Fprintf(&b, "window.%s { %sbackground-color: %s; color: %s; }\n", clsWindow, fix, hex(p.Window), hex(p.Text))
	fmt.Fprintf(&b, ".%s, .%s label, .%s check, .%s radio { %scolor: %s; font-size: 11pt; min-height: 16px; }\n",
		clsLabel, clsLabel, clsLabel, clsLabel, fix, hex(p.Text))
	fmt.Fprintf(&b, ".%s { font-weight: bold; }\n", clsBold)
	fmt.Fprintf(&b, ".%s { font-size: 28pt; font-weight: bold; }\n", clsCode)
	fmt.Fprintf(&b, ".%s { %scolor: %s; font-size: 11pt; min-height: 16px; }\n", clsDanger, fix, hex(p.Danger))
	fmt.Fprintf(&b, "button.%s { %sbackground-color: %s; color: %s; border: 1px solid %s; font-size: 11pt; "+
		"min-height: 28px; min-width: 64px; }\n", clsButton, fix, hex(p.Field), hex(p.FieldText), hex(p.Text))
	fmt.Fprintf(&b, "button.%s label { %scolor: %s; font-size: 11pt; }\n", clsButton, fix, hex(p.FieldText))
	fmt.Fprintf(&b, "button.%s:disabled, button.%s:disabled label { opacity: 1; color: %s; }\n", clsButton, clsButton,
		hex(mix(p.FieldText, p.Field)))
	fmt.Fprintf(&b, ".%s, .%s text { %sbackground-color: %s; color: %s; font-size: 11pt; }\n", clsField, clsField, fix,
		hex(p.Field), hex(p.FieldText))
	return b.String()
}

// mix iki rengin ortası (devre dışı düğme metni; okunur kalır).
func mix(a, b uicore.RGB) uicore.RGB {
	return uicore.RGB{R: uint8((int(a.R) + int(b.R)) / 2), G: uint8((int(a.G) + int(b.G)) / 2), B: uint8((int(a.B) + int(b.B)) / 2)}
}

// --- TEST metni (S-P28g-9) ----------------------------------------------------------------------------------------

// testBuild gömülü adres prod değilse "TEST" (çalışma anında türetilir; ldflags'e güvenilmez). Prod adresi derlemede
// yalnız etiket iş akışında gömülür ve repoda yoktur; bu yüzden karar ters yönden verilir: TEST derlemesi, staging
// ana makinesi (`stg.` ile başlayan), `.invalid`/`localhost`, IP adresi ya da çözülemeyen adres → TEST.
func testBuild(serverURL string, testFlag bool) bool {
	if testFlag {
		return true
	}
	u, err := url.Parse(serverURL)
	if err != nil || u.Hostname() == "" {
		return true
	}
	h := strings.ToLower(u.Hostname())
	return strings.HasPrefix(h, "stg.") || strings.Contains(h, ".stg.") || strings.HasSuffix(h, ".invalid") ||
		h == "localhost" || net.ParseIP(h) != nil
}

// title pencere başlığı (TEST derlemesinde sonda " — TEST").
func title(t string, test bool, testText string) string {
	if test {
		return t + " — " + testText
	}
	return t
}

// --- diyalog konumu (G-03, S-P28g-3 m.3) -----------------------------------------------------------------------------

// rect mantıksal piksel dikdörtgeni (GDK kök koordinatı).
type rect struct{ X, Y, W, H int }

func (r rect) contains(x, y int) bool { return x >= r.X && x < r.X+r.W && y >= r.Y && y < r.Y+r.H }

// placeDialog onay diyaloğunun sol üst köşesi. Wayland: oturum penceresinin monitörünün (work) ortası (imleç
// konumu güvenilir değil). X11: imlecin bulunduğu monitörün ortası; diyalog (32 px payla) imleci kapsıyorsa imlecin
// altında açılmaz — imlecin daha çok yer olan tarafına (önce dikey, sonra yatay) kaydırılır.
func placeDialog(work rect, w, h, px, py int, wayland bool) (int, int) {
	x, y := work.X+(work.W-w)/2, work.Y+(work.H-h)/2
	if wayland {
		return x, y
	}
	const pad = 32
	if !(rect{x - pad, y - pad, w + 2*pad, h + 2*pad}).contains(px, py) {
		return x, y
	}
	if py-work.Y >= work.Y+work.H-py { // imlecin üstünde daha çok yer
		y = py - pad - h
	} else {
		y = py + pad
	}
	if y < work.Y || y+h > work.Y+work.H {
		y = work.Y + (work.H-h)/2
		if px-work.X >= work.X+work.W-px {
			x = px - pad - w
		} else {
			x = px + pad
		}
	}
	return x, y
}

// --- kapatma kısayolu satırı --------------------------------------------------------------------------------------

// hotkeyLine oturum penceresindeki kısayol satırı: Wayland'de global kısayol yok (§2.1) → "Durdur" yolu.
func hotkeyLine(label string, wayland bool, waylandText string) string {
	if wayland {
		return waylandText
	}
	return uicore.HotkeyText(label)
}

// monitorLabel AC-106 seçim satırı.
func monitorLabel(name string, w, h int, primary bool) string {
	l := fmt.Sprintf("%s — %d×%d", name, w, h)
	if primary {
		l += " (birincil)"
	}
	return l
}
