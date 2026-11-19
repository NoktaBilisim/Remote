package uicore

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/transfer"
)

// macOS (ui/mac) ve Linux (ui/gtk) arayüzlerinin ortak, platformdan bağımsız karar ve metin mantığı (P28g K4'te
// ui/mac/logic.go'dan taşındı; davranış ve çıktı aynı). Satır sonu "\n".

// AppTitle pencere başlıklarının ortak kökü.
const AppTitle = flow.AppName

// --- gösterge sağlığı (S-P28f-2, S-P28g-8) ---------------------------------------------------------------------------

// HealthFailTicks ardışık başarısız tik sayısı (1 sn tik → ≈ 3 sn) sonunda kapı kapanır.
const HealthFailTicks = 3

// Health görünürlük sayacı. Observe her tikte çağrılır; Failed true olduğu ilk tikte trip true döner (kapı bir kez
// kapatılır). Yeniden görünür olunca sayaç sıfırlanır; Failed iken kontrol izni verilmez.
type Health struct {
	bad    int
	Failed bool
}

// Observe bir tikin sonucu.
func (h *Health) Observe(visible bool) (trip bool) {
	if visible {
		h.bad, h.Failed = 0, false
		return false
	}
	h.bad++
	if h.bad >= HealthFailTicks && !h.Failed {
		h.Failed = true
		return true
	}
	return false
}

// --- metinler ve küçük biçimlendiriciler ----------------------------------------------------------------------------

// WatchText AC-103 gösterge metni.
func WatchText(granted bool, tech string) string {
	if granted {
		return "Uzaktan kontrol aktif — " + tech
	}
	return "Ekranınız izleniyor — " + tech
}

// HotkeyText oturum penceresindeki kısayol satırı (Windows ile aynı metin).
func HotkeyText(label string) string {
	if label == "" {
		return "Kontrolü kapatma kısayolu kaydedilemedi. Güvenliğiniz için uzaktan kontrol izni verilemez."
	}
	return "Uzaktan kontrolü anında kapatmak için: " + label
}

// ControlBody AC-99 kontrol izni diyaloğu gövdesi.
func ControlBody(tech, hotkey string) string {
	body := tech + " bilgisayarınızın faresini ve klavyesini kullanmak istiyor. İzin verirseniz ekranınızda yaptığı " +
		"her şeyi görürsünüz; istediğiniz an \"Kontrolü kapat\" düğmesiyle"
	if hotkey != "" {
		body += " veya " + hotkey + " tuşlarıyla"
	}
	return body + " kapatabilirsiniz."
}

// ChatLimit oturum sohbet geçmişinin bellekte/ekranda tutulan en büyük boyutu (C dizgi sınırının altında).
const ChatLimit = 48 << 10

// AppendChat geçmişe "[ss:dd] kim: metin" satırı ekler; sınır aşılırsa en eski satırlar düşer. Metin yalnız düz
// metindir, biçim yorumlanmaz (S-P28f-12).
func AppendChat(hist string, at time.Time, who, text string) string {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	hist += fmt.Sprintf("[%s] %s: %s\n", at.Format("15:04"), who, text)
	for len(hist) > ChatLimit {
		i := strings.IndexByte(hist, '\n')
		if i < 0 || i == len(hist)-1 {
			return hist[len(hist)-ChatLimit:]
		}
		hist = hist[i+1:]
	}
	return hist
}

// ChatComposite P22-G (macOS/Linux): oturum sohbeti metni (flow.ChatView.Text) + yerel sistem satırları (dosya sonucu,
// ses notu, oturum sonu; AppendChat ile birikir) tek geçmiş kutusunda; sistem satırları sohbet bloğunun altında durur.
// Toplam ChatLimit'i aşarsa baştan satır sınırında kırpılır (en yeni korunur). Düz metindir.
func ChatComposite(chat, sys string) string {
	s := chat + sys
	for len(s) > ChatLimit {
		i := strings.IndexByte(s, '\n')
		if i < 0 || i == len(s)-1 {
			return s[len(s)-ChatLimit:]
		}
		s = s[i+1:]
	}
	return s
}

// ChatInputLimit sohbet giriş alanı (Windows EDIT sınırı 2000 karakter).
const ChatInputLimit = 2000

// TrimRunes s'yi en çok n rüne keser.
func TrimRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// UnreadTitle okunmamış mesaj sayılı oturum penceresi başlığı.
func UnreadTitle(n int) string {
	if n <= 0 {
		return AppTitle + " — Oturum"
	}
	return fmt.Sprintf("(%d yeni) %s — Oturum", n, AppTitle)
}

// FooterText AC-128 "Hakkında" satırı.
func FooterText(host, version, fp string) string {
	return fmt.Sprintf("Sunucu: %s  ·  Sürüm %s  ·  Parmak izi %s", host, version, fp)
}

// mailtoRe S-P28f-12: "Kötüye kullanımı bildir" adresi (flow api.ValidAbuseEmail'den geçmiş olsa da) yalnız güvenli
// karakterli tek adres.
var mailtoRe = regexp.MustCompile(`^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,253}\.[A-Za-z]{2,63}$`)

// MailtoAddr adres güvenliyse kendisi, değilse "" (düğme gizlenir).
func MailtoAddr(addr string) string {
	if !mailtoRe.MatchString(addr) {
		return ""
	}
	return addr
}

// BGRToRGBA FitBGR çıktısını (yukarıdan aşağı BGR, satır `(w*3+3)&^3` bayt) opak RGBA'ya çevirir (logo Go'da
// çözülür, S-P28f-12).
func BGRToRGBA(bgr []byte, w, h int) []byte {
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

// StripAccel ortak metin tablolarındaki Win32 erişim tuşu işaretini kaldırır ("Kaydı &durdur" → "Kaydı durdur";
// "&&" düz "&").
func StripAccel(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(s, "&&", "\x00"), "&", ""), "\x00", "&")
}

// FileResultText AC-54 sohbet "Sistem" satırı.
func FileResultText(r transfer.Result) string {
	switch r.Status {
	case "OK":
		msg := "Dosya kaydedildi: " + r.Path
		if r.MOTWFailed {
			msg += " (Uyarı: güvenlik işareti yazılamadı; dosyayı açmadan önce dikkatli olun.)"
		}
		if r.Executable { // P28g K5, S-P28g-6 m.3
			msg += flow.FileTexts.ExecContent
		}
		return msg
	case "CORRUPT":
		return "Dosya bozuk; silindi: " + r.Name
	case "CANCELLED":
		return "Dosya aktarımı iptal edildi: " + r.Name
	case "REJECTED":
		if r.MOTWFailed {
			return "Dosya kaydedilmedi: " + r.Name + " (Bu klasöre güvenlik işareti yazılamıyor; " +
				"program çalıştırabilen dosyalar işaretsiz bırakılmaz.)"
		}
	}
	return "Dosya reddedildi: " + r.Name
}
