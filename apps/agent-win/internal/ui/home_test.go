package ui

import (
	"testing"

	"remote-support/agent-win/internal/request"
)

func TestAC189HomeTabOrder(t *testing.T) {
	cases := []struct {
		name string
		v    request.HomeView
		want []string
		def  string
	}{
		{"kaynaklı + kötüye kullanım", request.HomeView{Support: true, AbuseEmail: "a@b.c"},
			[]string{"Destek iste", "Bağlantı kodum var", "Bu bilgisayarı unut", "Kötüye kullanımı bildir"}, "Destek iste"},
		{"kaynaklı, adres yok", request.HomeView{Support: true},
			[]string{"Destek iste", "Bağlantı kodum var", "Bu bilgisayarı unut"}, "Destek iste"},
		{"AC-190 kaynaksız", request.HomeView{}, []string{"Destek iste", "Bağlantı kodum var", "Bu bilgisayarı unut"}, "Bağlantı kodum var"},
	}
	for _, c := range cases {
		got := homeButtons(c.v)
		if len(got) != len(c.want) {
			t.Fatalf("%s: %+v", c.name, got)
		}
		defs := 0
		for i, b := range got {
			if b.text != c.want[i] {
				t.Errorf("%s: %d. düğme %q, beklenen %q", c.name, i, b.text, c.want[i])
			}
			if b.def {
				defs++
				if b.text != c.def || !b.enabled {
					t.Errorf("%s: varsayılan %q", c.name, b.text)
				}
			}
			if b.text == "Destek iste" && b.enabled != c.v.Support {
				t.Errorf("%s: Destek iste etkinliği", c.name)
			}
			if b.text != "Destek iste" && !b.enabled {
				t.Errorf("%s: %s her zaman etkin", c.name, b.text)
			}
		}
		if defs != 1 {
			t.Errorf("%s: tek varsayılan düğme olmalı", c.name)
		}
	}
	if registeredText("Nokta – Örnek") != "Bu bilgisayar Nokta – Örnek için kayıtlı" || registeredText("") != "" {
		t.Fatal("kayıt satırı")
	}
}
