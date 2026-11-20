package ui

import (
	"strings"
	"testing"

	"remote-support/agent-win/internal/launch"
)

// TestAC254FirmHomeButtonsAndOthers firma ekranı Tab sırası; başka kökenli kayıtlar başlıkla ve seçilemez notuyla;
// yükseklik başka köken + bilgi satırıyla büyür.
func TestAC254FirmHomeButtonsAndOthers(t *testing.T) {
	v := launch.FirmView{Firms: []launch.FirmRow{{Key: "k", Text: "A (kayıt: 01.11.2026)"}}}
	var names []string
	for _, b := range firmButtons(v) {
		names = append(names, b.text)
		if !b.enabled {
			t.Fatalf("%s pasif", b.text)
		}
	}
	if strings.Join(names, "|") != "Destek iste|Bağlantı kodum var|Bu firmayı unut|Bu bilgisayarı unut (tüm firmalar)" {
		t.Fatal(names)
	}
	if b := firmButtons(launch.FirmView{}); b[0].enabled || b[2].enabled || !b[1].def {
		t.Fatalf("firmasız: %+v", b)
	}
	base := firmHomeHeight(v)
	v.Others = []launch.OtherOrigin{{Host: "staging.example", Rows: []string{"S (kayıt: 02.11.2026)"}}}
	v.Notice = "x"
	if got := othersText(v); got != "Başka sunucu (staging.example) — talep için seçilemez\r\n    S (kayıt: 02.11.2026)" {
		t.Fatalf("%q", got)
	}
	if firmHomeHeight(v) <= base || firmListRows(v) != 1 {
		t.Fatal("yükseklik")
	}
}
