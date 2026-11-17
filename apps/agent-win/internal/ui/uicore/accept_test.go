package uicore

import "testing"

// S8b2-4: onay diyaloğu teknisyen adı + doğrulama koduyla eşleştirilir.
func TestS8b24AcceptDecision(t *testing.T) {
	ali1 := AcceptKey{Tech: "Ali Kaya", Verify: "4821"}
	cases := []struct {
		name string
		open bool
		cur  AcceptKey
		next AcceptKey
		want AcceptAction
	}{
		{"diyalog yok", false, AcceptKey{}, ali1, AcceptOpen},
		{"karar verilmiş diyalog yok sayılır", false, ali1, ali1, AcceptOpen},
		{"aynı ad + aynı kod: yerinde güncelle", true, ali1, ali1, AcceptUpdate},
		{"aynı ad + farklı kod: yeniden aç", true, ali1, AcceptKey{Tech: "Ali Kaya", Verify: "9137"}, AcceptReopen},
		{"farklı ad + aynı kod: yeniden aç", true, ali1, AcceptKey{Tech: "Veli Kaya", Verify: "4821"}, AcceptReopen},
		{"farklı ad + farklı kod: yeniden aç", true, ali1, AcceptKey{Tech: "Veli Kaya", Verify: "1111"}, AcceptReopen},
	}
	for _, c := range cases {
		if got := AcceptDecision(c.open, c.cur, c.next); got != c.want {
			t.Errorf("%s: %v, beklenen %v", c.name, got, c.want)
		}
	}
}

// AC-239: onay diyaloğunda kabul kodu aralıklı rakamlarla; kodsuzsa satır eklenmez (eski akış).
func TestAC239AdmitLine(t *testing.T) {
	if got := AdmitLine("0937"); got != "  ·  Kabul kodu: 0 9 3 7" {
		t.Fatalf("%q", got)
	}
	if AdmitLine("") != "" {
		t.Fatal("kodsuz mesajda satır olmamalı")
	}
}
