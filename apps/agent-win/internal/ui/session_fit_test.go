package ui

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
		{"tavan", 2000, 728, 96, chatHistoryH - chatHistoryM},
		{"%150 DPI fiziksel px'i mantıksala çevirir", 0, 1000, 144, 0},
	}
	for _, c := range cases {
		winH := c.client*c.dpi/96 + caption*c.dpi/96
		got := chatSqueeze(winH, c.work, c.dpi)
		if got != c.want {
			t.Fatalf("%s: %d, beklenen %d", c.name, got, c.want)
		}
		if c.want < chatHistoryH-chatHistoryM && winH-got*c.dpi/96 > c.work-sessionPad*c.dpi/96 {
			t.Fatalf("%s: sıkıştırma sonrası sığmıyor", c.name)
		}
	}
	// %150 DPI: 150 fiziksel px taşma → 100 mantıksal px kesinti.
	if got := chatSqueeze(1000-sessionPad*144/96+150, 1000, 144); got != 100 {
		t.Fatalf("%%150 DPI: %d", got)
	}
}
