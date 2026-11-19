// Package tray bildirim alanı (tepsi) simgesidir (P20, AC-253; mimari-e11 §8d.3): simge + ipucu "Nokta Destek", menü
// "Destek iste / Aç / Çık" (P28d: + mikrofon açıkken "Görüşmeyi bitir", "Lisanslar"), gövdesiz balonlar ve kullanıcı başına tek örnek (Local\ mutex, sahip denetimi —
// G-P20-16). Simge ağ kullanmaz; komutları Commands kanalına verir, yerleşik döngü kararları resident.go'dadır.
// tray.go ve resident.go platformsuzdur (Linux'ta test edilir); Win32 uygulaması tray_windows.go.
package tray

import (
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
	"strings"
)

// Command kullanıcının tepsi simgesindeki eylemi.
type Command int

const (
	// CmdOpen "Aç", "Destek iste", simgeye tıklama/Enter veya ikinci örneğin "göster" iletisi: pencere açılır ya da
	// açıksa öne gelir. "Destek iste" bugün ana ekranı açar (§8d.13: firma alt menüsü sonra).
	CmdOpen Command = iota + 1
	// CmdExit "Çık": pencere/oturum açıksa onaydan sonra süreç biter.
	CmdExit
	// CmdVoiceEnd P28d (O-PD-3): "Görüşmeyi bitir" — menüde yalnız mikrofon açıkken bulunur; kapsam dışında yok sayılır.
	CmdVoiceEnd
	// CmdLicenses P28d (ADR-0036 m.1 c): "Lisanslar" — üçüncü taraf bildirimleri; pencere kapsamı açmaz, ağ yok.
	CmdLicenses
)

// Kullanıcıya görünen sabit metinler. Balonlar hiçbir zaman sunucu metni (firma/teknisyen adı, mesaj gövdesi) taşımaz.
const (
	Tip          = "Nokta Destek"
	TipSession   = "Nokta Destek — oturum sürüyor"
	BalloonTitle = "Nokta Destek"
	// BalloonResident pencere kapatılıp tepsiye inildiğinde (süreç başına bir kez).
	BalloonResident = "Program tepside çalışmaya devam ediyor"
	// BalloonAutorunOff G-P20-15: `--tray` açılışında veya tepsiden açılışta Run değeri zayıf izin nedeniyle silindi.
	BalloonAutorunOff = "Windows açılışında başlatma kapatıldı (klasör izinleri)"
	// BalloonAutorunMissing S-P20-K1: Run değeri bulunamayan exe'yi gösterdiği için silindi.
	BalloonAutorunMissing = "Windows açılışında başlatma kapatıldı (program bulunamadı)"
	// ExitConfirm "Çık" sırasında pencere/oturum açıkken onay metni.
	ExitConfirm = "Nokta Destek penceresi açık. Çıkarsanız süren oturum veya destek talebi sonlanır. Çıkılsın mı?"

	MenuSupport = "&Destek iste"
	MenuOpen    = "&Aç"
	MenuExit    = "Çı&k"
	// P28d: menüde "Görüşmeyi bitir" (yalnız mikrofon açıkken) ve "Lisanslar".
	MenuVoiceEnd = "&Görüşmeyi bitir"
	MenuLicenses = "&Lisanslar"
	// TipMicOn / TipMicMuted P28d O-PD-3: mikrofon aygıtı açıkken ipucu (oturum ipucunun yerine; sabit metin).
	TipMicOn    = "Nokta Destek — Mikrofon açık"
	TipMicMuted = "Nokta Destek — Sessizde"
)

// VoiceTip etkin ipucu: mikrofon açıkken ses ipucu, değilse kapsamın ipucu (base: Tip / TipSession). Tek kaynak —
// SetTip, SetVoice ve Explorer yeniden başlayınca simgenin yeniden eklenmesi aynı kuralı kullanır (O-PD-3: oturum
// ipucu değişse de "Mikrofon açık" kaybolmaz).
func VoiceTip(base string, on, muted bool) string {
	switch {
	case !on:
		return base
	case muted:
		return TipMicMuted
	}
	return TipMicOn
}

// ShownTip simgede görünen ipucu (2026-11-18): VoiceTip'in başındaki uygulama adı (Tip) sürüm etiketiyle değiştirilir
// ("Nokta Destek 0.20.0 — oturum sürüyor"). label uicore.VersionLabel çıktısıdır (uicore bu paketi içe aktardığından
// biçim çağırandan gelir); boşsa ipucu aynen.
func ShownTip(base string, on, muted bool, label string) string {
	tip := VoiceTip(base, on, muted)
	if label == "" || !strings.HasPrefix(tip, Tip) {
		return tip
	}
	return label + strings.TrimPrefix(tip, Tip)
}

// MenuItem tepsi menüsünün bir öğesi.
type MenuItem struct {
	Cmd  Command
	Text string
}

// MenuItems menü öğeleri sırasıyla: Destek iste / Aç / [Görüşmeyi bitir] / Lisanslar / Çık. "Görüşmeyi bitir" yalnız
// mikrofon açıkken (voice) bulunur.
func MenuItems(voice bool) []MenuItem {
	items := []MenuItem{{CmdOpen, MenuSupport}, {CmdOpen, MenuOpen}}
	if voice {
		items = append(items, MenuItem{CmdVoiceEnd, MenuVoiceEnd})
	}
	return append(items, MenuItem{CmdLicenses, MenuLicenses}, MenuItem{CmdExit, MenuExit})
}

// Win32 adları. ShowMessage ikinci örneğin ilkine gönderdiği "göster" iletisinin adıdır (RegisterWindowMessage);
// veri taşımaz. UIPI filtresi gevşetilmez (G-P20-13).
const (
	ShowMessage  = "NoktaDestek.Show"
	WindowClass  = "NoktaDestekTray"
	mutexPrefix  = `Local\NoktaDestek.Tray.`
	mutexHashLen = 16
)

// MutexName kullanıcı başına tek örnek mutex'inin adı: `Local\NoktaDestek.Tray.<SID SHA-256 ilk 16 hane>`.
func MutexName(sid string) string {
	sum := sha256.Sum256([]byte(sid))
	return mutexPrefix + hex.EncodeToString(sum[:])[:mutexHashLen]
}

// IconPixels resmi size×size kareye en-boy oranını koruyarak sığdırır (ortada; kenarlar saydam), alan ortalamasıyla
// küçültür. Çıktı yukarıdan aşağı 32 bit BGRA (ön çarpımsız alfa; Win32 simge düzeni), satır başına size*4 bayt.
func IconPixels(img image.Image, size int) []byte {
	if size <= 0 {
		return nil
	}
	out := make([]byte, size*size*4)
	if img == nil {
		return out
	}
	b := img.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw <= 0 || sh <= 0 {
		return out
	}
	dw, dh := size, size
	if sw > sh {
		dh = max(1, sh*size/sw)
	} else if sh > sw {
		dw = max(1, sw*size/sh)
	}
	ox, oy := (size-dw)/2, (size-dh)/2
	for y := 0; y < dh; y++ {
		for x := 0; x < dw; x++ {
			r, g, bl, a, n := AreaSum(img, x, y, dw, dh)
			if a == 0 {
				continue
			}
			o := ((oy+y)*size + ox + x) * 4
			out[o] = uint8(bl / a >> 8)
			out[o+1] = uint8(g / a >> 8)
			out[o+2] = uint8(r / a >> 8)
			out[o+3] = uint8(a / n >> 8)
		}
	}
	return out
}

// AreaSum alan ortalamasıyla küçültmenin tek hücresi: img dw×dh ızgaraya bölündüğünde (x, y) hücresine düşen kaynak
// piksellerin alfa ağırlıklı renk toplamları (r, g, b; 16 bit kanal × 16 bit alfa), alfa toplamı a ve piksel sayısı n.
// Hücre en az bir kaynak pikseli kapsar. IconPixels (tepsi simgesi) ve ui logo sığdırması (fitBGR) ortak kullanır.
func AreaSum(img image.Image, x, y, dw, dh int) (r, g, b, a, n uint64) {
	bd := img.Bounds()
	sw, sh := bd.Dx(), bd.Dy()
	y0, y1 := bd.Min.Y+y*sh/dh, bd.Min.Y+max((y+1)*sh/dh, y*sh/dh+1)
	x0, x1 := bd.Min.X+x*sw/dw, bd.Min.X+max((x+1)*sw/dw, x*sw/dw+1)
	for sy := y0; sy < y1; sy++ {
		for sx := x0; sx < x1; sx++ {
			c := color.NRGBA64Model.Convert(img.At(sx, sy)).(color.NRGBA64)
			r += uint64(c.R) * uint64(c.A)
			g += uint64(c.G) * uint64(c.A)
			b += uint64(c.B) * uint64(c.A)
			a += uint64(c.A)
			n++
		}
	}
	return r, g, b, a, n
}

// truncate Win32 sabit uzunluklu dizi alanları için (sonlandırıcı dahil n UTF-16 birimi): fazlası kesilir.
func truncate(s string, n int) []uint16 {
	u := make([]uint16, 0, n)
	for _, r := range s {
		var units []uint16
		if r >= 0x10000 {
			r -= 0x10000
			units = []uint16{uint16(0xD800 + (r>>10)&0x3FF), uint16(0xDC00 + r&0x3FF)}
		} else {
			units = []uint16{uint16(r)}
		}
		if len(u)+len(units) > n-1 {
			break
		}
		u = append(u, units...)
	}
	return u
}
