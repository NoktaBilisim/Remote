package uicore

import (
	"strings"
	"testing"
	"time"

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

func TestAC264P22GChatComposite(t *testing.T) {
	if got := ChatComposite("[10:00] Siz:\n    <b>a</b>\n", "[10:01] Sistem: x\n"); got != "[10:00] Siz:\n    <b>a</b>\n[10:01] Sistem: x\n" {
		t.Fatalf("%q", got)
	}
	big := strings.Repeat("satır\n", ChatLimit/6+10)
	got := ChatComposite(big, "[10:01] Sistem: son\n")
	if len(got) > ChatLimit || !strings.HasSuffix(got, "[10:01] Sistem: son\n") || !strings.HasPrefix(got, "satır\n") {
		t.Fatalf("kırpma: %d", len(got))
	}
}

// Q-P22G-1 / S-P22G-1: üç arayüzün geçmiş kutusu kalıbı — yerel sistem satırı (dosya/virüs taraması sonucu, ses notu)
// birikime girer; ardından gelen her yeni sohbet sürümü kutuyu ChatComposite ile yeniden yazar ve sistem satırı kalır.
func TestQP22G1SystemLinesSurviveChatRev(t *testing.T) {
	at := time.Date(2026, 11, 19, 10, 1, 0, 0, time.Local)
	hist := AppendChat("", at, "Sistem", "Dosya taraması: virüs bulundu")
	hist = AppendChat(hist, at, "Sistem", "Sesli görüşme başladı")
	if box := ChatComposite("", hist); box != hist { // sohbet boşken yalnız sistem satırları
		t.Fatalf("%q", box)
	}
	for _, chat := range []string{
		"[10:02] Teknisyen Ali:\n    merhaba\n",
		"[10:02] Teknisyen Ali:\n    merhaba\n[10:03] Siz:\n    selam\n",
	} {
		box := ChatComposite(chat, hist) // yeni Rev: kutu birleşik metinle yeniden yazılır
		if !strings.HasPrefix(box, chat) {
			t.Fatalf("sohbet bloğu yok: %q", box)
		}
		for _, want := range []string{"[10:01] Sistem: Dosya taraması: virüs bulundu\n", "[10:01] Sistem: Sesli görüşme başladı\n"} {
			if !strings.Contains(box, want) {
				t.Fatalf("sistem satırı silindi (%q): %q", want, box)
			}
		}
	}
}
