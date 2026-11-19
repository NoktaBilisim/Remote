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

// AC-292 (mimari-p22 §9): ConsentReady tablo testi — gün 0 / eksik (0) / 90 × satır çizildi / çizilmedi.
func TestAC292ConsentReady(t *testing.T) {
	for _, c := range []struct {
		days  int
		drawn bool
		want  bool
	}{
		{0, false, false}, {0, true, false}, // eksik alan (eski sunucu) json'da 0 olur
		{-1, true, false},
		{90, false, false}, {90, true, true},
		{1, true, true},
	} {
		if got := ConsentReady(c.days, c.drawn); got != c.want {
			t.Errorf("ConsentReady(%d, %v) = %v", c.days, c.drawn, got)
		}
	}
	if RetentionText(0) != "Sunucu güncel değil; lütfen daha sonra deneyin" ||
		RetentionText(90) != "Sohbet mesajları kayıt altına alınır ve 90 gün saklanır" {
		t.Fatal("RetentionText")
	}
	if !RetentionDrawn(90, RetentionText(90)) || RetentionDrawn(90, "") || RetentionDrawn(0, RetentionText(0)) ||
		RetentionDrawn(30, RetentionText(90)) {
		t.Fatal("RetentionDrawn")
	}
}
