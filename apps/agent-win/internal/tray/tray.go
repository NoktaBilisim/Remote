// Package tray bildirim alanı (tepsi) simgesidir (P20, AC-253; mimari-e11 §8d.3): simge + ipucu "Nokta Destek", menü
// yalnız "Destek iste / Aç / Çık", gövdesiz balonlar ve kullanıcı başına tek örnek (Local\ mutex, sahip denetimi —
// G-P20-16). Simge ağ kullanmaz; komutları Commands kanalına verir, yerleşik döngü kararları resident.go'dadır.
// tray.go ve resident.go platformsuzdur (Linux'ta test edilir); Win32 uygulaması tray_windows.go.
package tray

import (
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
)

// Command kullanıcının tepsi simgesindeki eylemi.
type Command int

const (
	// CmdOpen "Aç", "Destek iste", simgeye tıklama/Enter veya ikinci örneğin "göster" iletisi: pencere açılır ya da
	// açıksa öne gelir. "Destek iste" bugün ana ekranı açar (§8d.13: firma alt menüsü sonra).
	CmdOpen Command = iota + 1
	// CmdExit "Çık": pencere/oturum açıksa onaydan sonra süreç biter.
	CmdExit
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
)

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
		y0, y1 := b.Min.Y+y*sh/dh, b.Min.Y+max((y+1)*sh/dh, y*sh/dh+1)
		for x := 0; x < dw; x++ {
			x0, x1 := b.Min.X+x*sw/dw, b.Min.X+max((x+1)*sw/dw, x*sw/dw+1)
			var r, g, bl, a, n uint64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					c := color.NRGBA64Model.Convert(img.At(sx, sy)).(color.NRGBA64)
					r += uint64(c.R) * uint64(c.A)
					g += uint64(c.G) * uint64(c.A)
					bl += uint64(c.B) * uint64(c.A)
					a += uint64(c.A)
					n++
				}
			}
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
