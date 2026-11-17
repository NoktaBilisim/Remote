package uicore

import "testing"

func TestP28cSessionWindowFits768(t *testing.T) {
	const caption = 31 // %100 DPI başlık + kenarlık
	cases := []struct {
		name              string
		client, work, dpi int32
		want              int32
	}{
		{"sığıyor", 532 + 96 + 56, 1040, 96, 0},
		{"en kötü 768 px (görev çubuğu 40)", 776, 728, 96, 776 + caption - (728 - sessionPad)},
		{"yükseltilmemiş + dosya sunucusu 768 px", 532 + 40 + 96 + 56, 728, 96, 532 + 40 + 96 + 56 + caption - (728 - sessionPad)},
		{"tavan", 2000, 728, 96, ChatHistoryH - chatHistoryM},
		{"%150 DPI fiziksel px'i mantıksala çevirir", 0, 1000, 144, 0},
	}
	for _, c := range cases {
		winH := c.client*c.dpi/96 + caption*c.dpi/96
		got := ChatSqueeze(winH, c.work, c.dpi)
		if got != c.want {
			t.Fatalf("%s: %d, beklenen %d", c.name, got, c.want)
		}
		if c.want < ChatHistoryH-chatHistoryM && winH-got*c.dpi/96 > c.work-sessionPad*c.dpi/96 {
			t.Fatalf("%s: sıkıştırma sonrası sığmıyor", c.name)
		}
	}
	// %150 DPI: 150 fiziksel px taşma → 100 mantıksal px kesinti.
	if got := ChatSqueeze(1000-sessionPad*144/96+150, 1000, 144); got != 100 {
		t.Fatalf("%%150 DPI: %d", got)
	}
}

// P28d: ses satırı eklenince en kötü durum (yükseltilmiş + dosya sunucusu + 3 teknisyen + kayıt + ses) 768 px ekrana
// sohbet geçmişi kısaltılarak sığar; sıkıştırma tavanına ulaşmaz.
func TestP28dSessionWindowWithVoiceRowFits768(t *testing.T) {
	const caption, work = 31, 728
	worst := int32(584+40+3*32+56) + VoiceRowH // newSessionWin: yükseltilmiş + dosya sunucusu + rosterH + recRow + ses
	for _, dpi := range []int32{96, 120, 144} {
		winH := worst*dpi/96 + caption*dpi/96
		workH := work * dpi / 96
		sq := ChatSqueeze(winH, workH, dpi)
		if sq >= ChatHistoryH-chatHistoryM && winH-sq*dpi/96 > workH-sessionPad*dpi/96 {
			t.Fatalf("%d DPI: ses satırıyla sığmıyor (kesinti %d, tavan %d)", dpi, sq, ChatHistoryH-chatHistoryM)
		}
		if winH-sq*dpi/96 > workH-sessionPad*dpi/96 {
			t.Fatalf("%d DPI: sıkıştırma sonrası taşıyor", dpi)
		}
	}
}
