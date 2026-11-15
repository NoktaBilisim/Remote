package ui

import (
	"strings"
	"testing"

	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/request"
)

// TestAC190AC189FirmHomeSingleScreen tek ana ekran (2026-11-15): satır yoksa "Destek iste" pasif, varsayılan "Bağlantı
// kodum var", AC-190 açıklaması; dosyanın firması tek satırsa öneksiz ve "Bu firmayı unut" pasif; kayıtlı firmada
// "Kayıtlı firma: …" ve unut etkin. Tab sırası her durumda aynı.
func TestAC190AC189FirmHomeSingleScreen(t *testing.T) {
	const order = "Destek iste|Bağlantı kodum var|Bu firmayı unut|Bu bilgisayarı unut (tüm firmalar)"
	file := launch.FirmRow{Text: "Bu dosyanın firması: Ref Firma", File: true}
	reg := launch.FirmRow{Key: "k", Text: "A (kayıt: 01.11.2026)"}
	cases := []struct {
		name      string
		v         launch.FirmView
		text      string
		def       string
		support   bool
		forgetOne bool
		listed    bool
	}{
		{"AC-190 satır yok", launch.FirmView{}, request.MsgNoSource, "Bağlantı kodum var", false, false, false},
		{"yalnız dosyanın firması", launch.FirmView{Firms: []launch.FirmRow{file}, Single: true}, file.Text, "Destek iste", true, false, false},
		{"tek kayıtlı firma", launch.FirmView{Firms: []launch.FirmRow{reg}, Single: true}, "Kayıtlı firma: " + reg.Text, "Destek iste", true, true, false},
		{"dosyanın firması + kayıtlı", launch.FirmView{Firms: []launch.FirmRow{file, reg}}, "", "Destek iste", true, false, true},
	}
	for _, c := range cases {
		var names []string
		for _, b := range firmButtons(c.v) {
			names = append(names, b.text)
			if b.def && b.text != c.def {
				t.Errorf("%s: varsayılan %q", c.name, b.text)
			}
		}
		b := firmButtons(c.v)
		if strings.Join(names, "|") != order || b[0].enabled != c.support || b[2].enabled != c.forgetOne || !b[1].enabled || !b[3].enabled {
			t.Errorf("%s: %+v", c.name, b)
		}
		if listed(c.v) != c.listed || (!c.listed && singleText(c.v) != c.text) {
			t.Errorf("%s: liste=%v satır=%q", c.name, listed(c.v), singleText(c.v))
		}
	}
	v := launch.FirmView{Firms: []launch.FirmRow{file, reg}}
	if forgettable(v, 0) || !forgettable(v, 1) || forgettable(v, 2) || forgettable(v, -1) {
		t.Fatal("yalnız kayıtlı satır unutulabilir (seçim değişince düğme güncellenir)")
	}
}

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
