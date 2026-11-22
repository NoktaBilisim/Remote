package capture

import "strings"

// P33 K2 (mimari-p33 §6.1–6.3, AC-543..546): macOS "Yalnız bir pencere" modunun platformdan bağımsız parçaları.
// Etiketsizdir ki Linux CI'da da test edilsin (mimari §9 "Go ortak"); SCK/CG çağrıları window_darwin.go'dadır.
//
// Başlık ve uygulama adı (S-P33-T-8) yalnız ShareWindow.Label'a girer; Label yalnız seçim ekranında gösterilir.
// Hata, log ve WS iletilerinde pencere kimliği bile yazılmaz; yalnız sabit işlem adı ve sayı bulunur.

// MacWindow SCShareableContent'ten gelen pencere adayı (Go'ya kopyalanmış alanlar; objc nesnesi taşınmaz).
type MacWindow struct {
	ID       uint32 // CGWindowID
	Title    string
	App      string // uygulama adı
	Bundle   string // paket kimliği (süzgeç için; gösterilmez)
	PID      int32  // 0: owningApplication yok
	Layer    int
	OnScreen bool
	W, H     float64 // çerçeve (nokta)
}

// ShareWindow seçim ekranındaki pencere satırı.
type ShareWindow struct {
	ID    uintptr // flow.ShareChoice.Window
	Label string  // "<Başlık> — <Uygulama>"
}

const (
	macWindowsMax  = 64 // liste üst sınırı (önden arkaya)
	macTitleMax    = 80 // başlık uzunluğu (rune)
	macWindowMinPt = 64 // 64×64 noktadan küçük pencereler (araç ipucu, kayan rozet) listelenmez
)

// macSystemBundles listelenmeyen sistem süreçleri (§6.2): Dock, Denetim Merkezi, Bildirim Merkezi, Sahne Yöneticisi,
// Spotlight, menü çubuğu sunucusu, giriş penceresi, ekran görüntüsü arayüzü.
var macSystemBundles = map[string]bool{
	"com.apple.dock": true, "com.apple.controlcenter": true, "com.apple.notificationcenterui": true,
	"com.apple.WindowManager": true, "com.apple.Spotlight": true, "com.apple.systemuiserver": true,
	"com.apple.loginwindow": true, "com.apple.screencaptureui": true,
}

// filterWindows AC-543 süzgeci; sıra korunur (SCK sırası: önden arkaya). D-P33-1: simge durumundaki pencere
// (isOnScreen false) listelenmez.
func filterWindows(all []MacWindow, selfPID int32) []ShareWindow {
	var out []ShareWindow
	for _, w := range all {
		title := strings.Join(strings.Fields(w.Title), " ")
		if w.ID == 0 || w.Layer != 0 || !w.OnScreen || title == "" || w.W < macWindowMinPt || w.H < macWindowMinPt ||
			w.PID == 0 || w.PID == selfPID || macSystemBundles[w.Bundle] {
			continue
		}
		if r := []rune(title); len(r) > macTitleMax {
			title = string(r[:macTitleMax-1]) + "…"
		}
		label := title
		if app := strings.Join(strings.Fields(w.App), " "); app != "" {
			label += " — " + app
		}
		out = append(out, ShareWindow{ID: uintptr(w.ID), Label: label})
		if len(out) == macWindowsMax {
			break
		}
	}
	return out
}

// winObs CG pencere yoklamasının sonucu (K-P33-5). W/H çıktı boyutu (OutputSize uygulanmış piksel).
type winObs struct {
	Exists, OnScreen bool
	W, H             int
}

// winAct yoklamanın akışa etkisi.
type winAct int

const (
	winKeep   winAct = iota
	winClosed        // kalıcı WINDOW_CLOSED (AC-546)
	winHide          // görünmez oldu: son kare plakayla değişir, girdi düşer (AC-545, S-P33-T-9)
	winShow          // yeniden görünür: akış yeniden açılır (taze kare ≤ 2 sn)
	winResize        // boyut değişti: updateConfiguration (AC-544)
)

// winTrack pencerenin son bilinen durumu (kodlama goroutine'inde; kilitsiz).
type winTrack struct {
	w, h   int
	hidden bool
	closed bool
}

// observe yeni yoklamayı durum makinesine verir. Kapanış kalıcıdır; görünmez durum (küçültme, ⌘H, başka Space, tam
// ekran: K-P33-5 tek durum) yalnız geçişte bir kez bildirilir.
func (t *winTrack) observe(o winObs) winAct {
	switch {
	case t.closed || !o.Exists:
		t.closed = true
		return winClosed
	case !o.OnScreen:
		if t.hidden {
			return winKeep
		}
		t.hidden = true
		return winHide
	case t.hidden:
		t.hidden = false
		t.w, t.h = o.W, o.H
		return winShow
	case o.W >= 2 && o.H >= 2 && (o.W != t.w || o.H != t.h):
		t.w, t.h = o.W, o.H
		return winResize
	}
	return winKeep
}

// Plaka (S-P33-T-9): video aralığı siyahı (BT.709 sınırlı: Y 16, UV 128), yazı maskesi beyaza (Y 235) karışır.
const (
	plateBlackY  = 16
	plateWhiteY  = 235
	plateChroma  = 128
	plateDefault = 1280
	plateDefH    = 720
)

// hidePlate son gerçek karenin boyutunda (kodlayıcı yeniden kurulmasın) siyah NV12 plaka; mask (w×h kapsama 0..255,
// "Pencere simge durumunda" yazısı) nil ya da boyutu uymuyorsa düz siyah. Son gerçek kare hiçbir koşulda plakaya
// kopyalanmaz.
func hidePlate(w, h int, mask []byte) *NV12 {
	if w < 2 || h < 2 {
		w, h = plateDefault, plateDefH
	}
	f := NewNV12(w, h)
	y := f.Data[:w*h]
	if len(mask) == w*h {
		for i, m := range mask {
			y[i] = byte(plateBlackY + int(m)*(plateWhiteY-plateBlackY)/255)
		}
	} else {
		for i := range y {
			y[i] = plateBlackY
		}
	}
	uv := f.Data[w*h:]
	for i := range uv {
		uv[i] = plateChroma
	}
	return f
}
