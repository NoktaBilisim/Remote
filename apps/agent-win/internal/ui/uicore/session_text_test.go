package uicore

import (
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/transfer"
)

// P28g K4: ui/mac/logic_test.go'dan taşındı (mantık uicore/session_text.go'ya taşındı; davranış aynı).

// S-P28f-2 (§5.2b): 3 ardışık görünmez tikte bir kez tetiklenir; görünür olunca sıfırlanır.
func TestP28fIndicatorHealth(t *testing.T) {
	var h Health
	trips := 0
	for _, v := range []bool{false, false, true, false, false, false, false, false} {
		if h.Observe(v) {
			trips++
		}
	}
	if trips != 1 || !h.Failed {
		t.Fatalf("trips=%d failed=%v", trips, h.Failed)
	}
	h.Observe(true)
	if h.Failed || h.bad != 0 {
		t.Fatal("görünür olunca sıfırlanmalı")
	}
}

// AC-52 / S-P28f-12: sohbet geçmişi düz metin, satır sonları normalize, sınırda eski satırlar düşer.
func TestP28fAppendChat(t *testing.T) {
	at := time.Date(2026, 11, 17, 9, 5, 0, 0, time.UTC)
	h := AppendChat("", at, "Teknisyen", "a\r\nb<b>")
	if h != "[09:05] Teknisyen: a\nb<b>\n" {
		t.Fatalf("%q", h)
	}
	big := strings.Repeat("x", 1000)
	for range 100 {
		h = AppendChat(h, at, "Siz", big)
	}
	if len(h) > ChatLimit || !strings.HasPrefix(h, "[09:05]") {
		t.Fatalf("sınır: %d %q", len(h), h[:10])
	}
	if TrimRunes("şğüçİö", 3) != "şğü" || TrimRunes("ab", 5) != "ab" {
		t.Fatal("TrimRunes")
	}
}

// AC-99/103: metinler.
func TestP28fTexts(t *testing.T) {
	if WatchText(true, "Ali") != "Uzaktan kontrol aktif — Ali" || WatchText(false, "Ali") != "Ekranınız izleniyor — Ali" {
		t.Fatal("WatchText")
	}
	if !strings.Contains(ControlBody("Ali", "Control+Shift+F12"), "Control+Shift+F12 tuşlarıyla") ||
		strings.Contains(ControlBody("Ali", ""), "tuşlarıyla") {
		t.Fatal("ControlBody")
	}
	if !strings.Contains(HotkeyText(""), "verilemez") || UnreadTitle(2) != "(2 yeni) Nokta Destek — Oturum" ||
		UnreadTitle(0) != "Nokta Destek — Oturum" {
		t.Fatal("hotkey/unread")
	}
}

// S-P28f-12: mailto yalnız tek, güvenli karakterli adres.
func TestP28fMailtoAddr(t *testing.T) {
	if MailtoAddr("abuse@nokta.net") != "abuse@nokta.net" {
		t.Fatal("geçerli")
	}
	for _, bad := range []string{"", "a@b", "a@b.c?subject=x", "a b@c.de", "x@y.com\nBcc:z@w.com", "<a@b.com>"} {
		if MailtoAddr(bad) != "" {
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
	px := BGRToRGBA(bgr, w, h)
	if len(px) != 16 || px[0] != 3 || px[1] != 2 || px[2] != 1 || px[3] != 0xff || px[12] != 7 || px[14] != 9 {
		t.Fatalf("%v", px)
	}
	if BGRToRGBA(bgr[:3], w, h) != nil {
		t.Fatal("kısa tampon")
	}
}

// AC-37/56: işaretleme iletileri, geri alma, temizleme, sınır ve ok/dikdörtgen çizgileri.
func TestP28fAnnot(t *testing.T) {
	x, y := 0.5, 0.25
	var s []Stroke
	var l *[2]float64
	s, l, _ = ApplyAnnot(s, l, dc.Ctl{T: "annot.stroke", ID: "a", Tool: "rect", Color: "blue", Pts: [][2]float64{{0, 0}, {1, 1}}})
	s, l, _ = ApplyAnnot(s, l, dc.Ctl{T: "annot.stroke", ID: "b", Tool: "arrow", Color: "red", Pts: [][2]float64{{0, 0}, {1, 0}}})
	s, l, laser := ApplyAnnot(s, l, dc.Ctl{T: "annot.laser", X: &x, Y: &y})
	if len(s) != 2 || !laser || l == nil || l[0] != 0.5 {
		t.Fatal("stroke/laser")
	}
	s, _, _ = ApplyAnnot(s, l, dc.Ctl{T: "annot.undo", ID: "a"})
	if len(s) != 1 || s[0].ID != "b" {
		t.Fatal("undo")
	}
	if r := StrokePolylines(Stroke{Tool: "rect", Pts: [][2]float64{{0, 0}, {1, 1}}}, 100, 50); len(r) != 1 || len(r[0]) != 5 || r[0][2] != [2]float64{100, 50} {
		t.Fatalf("rect %v", r)
	}
	if r := StrokePolylines(s[0], 100, 100); len(r) != 3 {
		t.Fatalf("arrow %v", r)
	}
	for range MaxStrokes + 10 {
		s, _, _ = ApplyAnnot(s, nil, dc.Ctl{T: "annot.stroke", Pts: [][2]float64{{0, 0}}})
	}
	if len(s) != MaxStrokes {
		t.Fatal("sınır")
	}
	if s, l, _ = ApplyAnnot(s, l, dc.Ctl{T: "annot.clear"}); s != nil || l != nil {
		t.Fatal("clear")
	}
	if AnnotColor("mor") != AnnotColor("red") {
		t.Fatal("bilinmeyen renk")
	}
}

func TestP28fStripAccel(t *testing.T) {
	if StripAccel("Kaydı &durdur") != "Kaydı durdur" || StripAccel("A && B") != "A & B" || StripAccel("Gönder") != "Gönder" {
		t.Fatal("StripAccel")
	}
}

// AC-128 "Hakkında" satırı ve sohbet giriş sınırı.
func TestP28fFooterAndInputLimit(t *testing.T) {
	if FooterText("h", "0.19.0", "ab12cd34") != "Sunucu: h  ·  Sürüm 0.19.0  ·  Parmak izi ab12cd34" {
		t.Fatal("FooterText")
	}
	if len([]rune(TrimRunes(strings.Repeat("ş", 3000), ChatInputLimit))) != 2000 {
		t.Fatal("ChatInputLimit")
	}
}

// AC-54: dosya sonucu satırları (ui/mac'ten taşındı).
func TestP28fFileResultText(t *testing.T) {
	if FileResultText(transfer.Result{Status: "OK", Path: "/x/a.txt"}) != "Dosya kaydedildi: /x/a.txt" ||
		!strings.Contains(FileResultText(transfer.Result{Status: "REJECTED", Name: "a", MOTWFailed: true}), "kaydedilmedi") ||
		FileResultText(transfer.Result{Status: "REJECTED", Name: "a"}) != "Dosya reddedildi: a" {
		t.Fatal("FileResultText")
	}
}
