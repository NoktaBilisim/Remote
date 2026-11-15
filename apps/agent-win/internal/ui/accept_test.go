package ui

import "testing"

// S8b2-4: onay diyaloğu teknisyen adı + doğrulama koduyla eşleştirilir.
func TestS8b24AcceptDecision(t *testing.T) {
	ali1 := acceptKey{tech: "Ali Kaya", verify: "4821"}
	cases := []struct {
		name string
		open bool
		cur  acceptKey
		next acceptKey
		want acceptAction
	}{
		{"diyalog yok", false, acceptKey{}, ali1, acceptOpen},
		{"karar verilmiş diyalog yok sayılır", false, ali1, ali1, acceptOpen},
		{"aynı ad + aynı kod: yerinde güncelle", true, ali1, ali1, acceptUpdate},
		{"aynı ad + farklı kod: yeniden aç", true, ali1, acceptKey{tech: "Ali Kaya", verify: "9137"}, acceptReopen},
		{"farklı ad + aynı kod: yeniden aç", true, ali1, acceptKey{tech: "Veli Kaya", verify: "4821"}, acceptReopen},
		{"farklı ad + farklı kod: yeniden aç", true, ali1, acceptKey{tech: "Veli Kaya", verify: "1111"}, acceptReopen},
	}
	for _, c := range cases {
		if got := acceptDecision(c.open, c.cur, c.next); got != c.want {
			t.Errorf("%s: %v, beklenen %v", c.name, got, c.want)
		}
	}
}

// AC-239: onay diyaloğunda kabul kodu aralıklı rakamlarla; kodsuzsa satır eklenmez (eski akış).
func TestAC239AdmitLine(t *testing.T) {
	if got := admitLine("0937"); got != "  ·  Kabul kodu: 0 9 3 7" {
		t.Fatalf("%q", got)
	}
	if admitLine("") != "" {
		t.Fatal("kodsuz mesajda satır olmamalı")
	}
}
