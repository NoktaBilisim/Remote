package mac

import (
	"errors"
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/input"
)

// S-P28f-1 (§5.2a): yalnız input.LocalClick kabulü yerel sayılır; klavye etkinleştirmesi uyarısız, gerisi enjekte.
func TestP28fClassifyClick(t *testing.T) {
	key := input.ClickEvent{Present: true, Type: nsKeyDown}
	up := input.ClickEvent{Present: true, Type: input.NSLeftMouseUp}
	if classifyClick(up, true) != clickLocal {
		t.Fatal("yerel tıklama")
	}
	if classifyClick(key, false) != clickKeyboard {
		t.Fatal("klavye")
	}
	for _, ev := range []input.ClickEvent{{}, up, {Present: true, Type: 0}} {
		if classifyClick(ev, false) != clickInjected {
			t.Fatalf("enjekte: %+v", ev)
		}
	}
}

// S-P28f-2 (§5.2b): 3 ardışık görünmez tikte bir kez tetiklenir; görünür olunca sıfırlanır.
func TestP28fIndicatorHealth(t *testing.T) {
	var h health
	trips := 0
	for _, v := range []bool{false, false, true, false, false, false, false, false} {
		if h.observe(v) {
			trips++
		}
	}
	if trips != 1 || !h.failed {
		t.Fatalf("trips=%d failed=%v", trips, h.failed)
	}
	h.observe(true)
	if h.failed || h.bad != 0 {
		t.Fatal("görünür olunca sıfırlanmalı")
	}
}

// AC-390 / S-P28f-7 / D-P28f-K3: bant yalnız beklenen Developer ID ekibiyle (Team ID eşit, ad-hoc değil) imzalı ve
// TEST olmayan derlemede gizli; beklenen Team ID gömülmemişse ya da farklı ekiple imzalıysa gösterilir.
func TestP28fTestBand(t *testing.T) {
	const team = "ABCDE12345"
	signed := signInfo{TeamID: team}
	for _, c := range []struct {
		si       signInfo
		test     bool
		expected string
		want     bool
	}{
		{signed, false, team, false},
		{signed, true, team, true},
		{signed, false, "", true},                           // beklenen gömülmemiş
		{signInfo{TeamID: "ZZZZZ99999"}, false, team, true}, // başka ekip (D-P28f-K3)
		{signInfo{}, false, team, true},
		{signInfo{TeamID: team, AdHoc: true}, false, team, true},
		{signInfo{TeamID: team, Err: errors.New("x")}, false, team, true},
	} {
		if got := showTestBand(c.si, c.test, c.expected); got != c.want {
			t.Errorf("%+v test=%v beklenen=%q → %v", c.si, c.test, c.expected, got)
		}
	}
}

// Y-P28f-K1: AppKit çerçevesi (sol alt köken) CoreGraphics noktasına (sol üst köken) çevrilir, 1 nokta dışa.
func TestYP28fK1FlipRect(t *testing.T) {
	// 1440x900 birincil ekranda sol altta (100,50) 400x300 pencere → CG üst = 900-(50+300) = 550.
	if got := flipRect(100, 50, 400, 300, 900); got != (input.FRect{X: 99, Y: 549, W: 402, H: 302}) {
		t.Fatalf("%+v", got)
	}
	// birincil ekranın üstündeki ikinci ekran (y > 900) → negatif CG y.
	if got := flipRect(0, 1000, 200, 100, 900); got.Y != -201 {
		t.Fatalf("%+v", got)
	}
}

// AC-52 / S-P28f-12: sohbet geçmişi düz metin, satır sonları normalize, sınırda eski satırlar düşer.
func TestP28fAppendChat(t *testing.T) {
	at := time.Date(2026, 11, 17, 9, 5, 0, 0, time.UTC)
	h := appendChat("", at, "Teknisyen", "a\r\nb<b>")
	if h != "[09:05] Teknisyen: a\nb<b>\n" {
		t.Fatalf("%q", h)
	}
	big := strings.Repeat("x", 1000)
	for range 100 {
		h = appendChat(h, at, "Siz", big)
	}
	if len(h) > chatLimit || !strings.HasPrefix(h, "[09:05]") {
		t.Fatalf("sınır: %d %q", len(h), h[:10])
	}
	if trimRunes("şğüçİö", 3) != "şğü" || trimRunes("ab", 5) != "ab" {
		t.Fatal("trimRunes")
	}
}

// AC-99/103: metinler.
func TestP28fTexts(t *testing.T) {
	if watchText(true, "Ali") != "Uzaktan kontrol aktif — Ali" || watchText(false, "Ali") != "Ekranınız izleniyor — Ali" {
		t.Fatal("watchText")
	}
	if !strings.Contains(controlBody("Ali", "Control+Shift+F12"), "Control+Shift+F12 tuşlarıyla") ||
		strings.Contains(controlBody("Ali", ""), "tuşlarıyla") {
		t.Fatal("controlBody")
	}
	if !strings.Contains(hotkeyText(""), "verilemez") || unreadTitle(2) != "(2 yeni) Nokta Destek — Oturum" ||
		unreadTitle(0) != "Nokta Destek — Oturum" {
		t.Fatal("hotkey/unread")
	}
}

// S-P28f-12: mailto yalnız tek, güvenli karakterli adres.
func TestP28fMailtoAddr(t *testing.T) {
	if mailtoAddr("abuse@nokta.net") != "abuse@nokta.net" {
		t.Fatal("geçerli")
	}
	for _, bad := range []string{"", "a@b", "a@b.c?subject=x", "a b@c.de", "x@y.com\nBcc:z@w.com", "<a@b.com>"} {
		if mailtoAddr(bad) != "" {
			t.Errorf("reddedilmeli: %q", bad)
		}
	}
}

// Logo: FitBGR (dolgulu BGR satırları) → opak RGBA.
func TestP28fBgrToRGBA(t *testing.T) {
	w, h := 2, 2
	stride := (w*3 + 3) &^ 3
	bgr := make([]byte, stride*h)
	bgr[0], bgr[1], bgr[2] = 1, 2, 3    // (0,0)
	bgr[stride+3], bgr[stride+5] = 9, 7 // (1,1) B=9 R=7
	px := bgrToRGBA(bgr, w, h)
	if len(px) != 16 || px[0] != 3 || px[1] != 2 || px[2] != 1 || px[3] != 0xff || px[12] != 7 || px[14] != 9 {
		t.Fatalf("%v", px)
	}
	if bgrToRGBA(bgr[:3], w, h) != nil {
		t.Fatal("kısa tampon")
	}
}

// AC-37/56: işaretleme iletileri, geri alma, temizleme, sınır ve ok/dikdörtgen çizgileri.
func TestP28fAnnot(t *testing.T) {
	x, y := 0.5, 0.25
	var s []annotStroke
	var l *[2]float64
	s, l, _ = applyAnnot(s, l, dc.Ctl{T: "annot.stroke", ID: "a", Tool: "rect", Color: "blue", Pts: [][2]float64{{0, 0}, {1, 1}}})
	s, l, _ = applyAnnot(s, l, dc.Ctl{T: "annot.stroke", ID: "b", Tool: "arrow", Color: "red", Pts: [][2]float64{{0, 0}, {1, 0}}})
	s, l, laser := applyAnnot(s, l, dc.Ctl{T: "annot.laser", X: &x, Y: &y})
	if len(s) != 2 || !laser || l == nil || l[0] != 0.5 {
		t.Fatal("stroke/laser")
	}
	s, _, _ = applyAnnot(s, l, dc.Ctl{T: "annot.undo", ID: "a"})
	if len(s) != 1 || s[0].id != "b" {
		t.Fatal("undo")
	}
	if r := strokePolylines(annotStroke{tool: "rect", pts: [][2]float64{{0, 0}, {1, 1}}}, 100, 50); len(r) != 1 || len(r[0]) != 5 || r[0][2] != [2]float64{100, 50} {
		t.Fatalf("rect %v", r)
	}
	if r := strokePolylines(s[0], 100, 100); len(r) != 3 {
		t.Fatalf("arrow %v", r)
	}
	for range maxStrokes + 10 {
		s, _, _ = applyAnnot(s, nil, dc.Ctl{T: "annot.stroke", Pts: [][2]float64{{0, 0}}})
	}
	if len(s) != maxStrokes {
		t.Fatal("sınır")
	}
	if s, l, _ = applyAnnot(s, l, dc.Ctl{T: "annot.clear"}); s != nil || l != nil {
		t.Fatal("clear")
	}
	if annotColor("mor") != annotColor("red") {
		t.Fatal("bilinmeyen renk")
	}
}

func TestP28fStripAccel(t *testing.T) {
	if stripAccel("Kaydı &durdur") != "Kaydı durdur" || stripAccel("A && B") != "A & B" || stripAccel("Gönder") != "Gönder" {
		t.Fatal("stripAccel")
	}
}

// AC-128 "Hakkında" satırı ve sohbet giriş sınırı.
func TestP28fFooterAndInputLimit(t *testing.T) {
	if footerText("h", "0.19.0", "ab12cd34") != "Sunucu: h  ·  Sürüm 0.19.0  ·  Parmak izi ab12cd34" {
		t.Fatal("footerText")
	}
	if len([]rune(trimRunes(strings.Repeat("ş", 3000), chatInputLimit))) != 2000 {
		t.Fatal("chatInputLimit")
	}
}
