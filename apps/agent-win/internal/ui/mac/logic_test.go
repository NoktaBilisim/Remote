package mac

import (
	"errors"
	"testing"

	"remote-support/agent-win/internal/input"
)

// S-P28f-1 (§5.2a): yalnız input.LocalClick kabulü yerel sayılır; klavye etkinleştirmesi uyarısız, gerisi enjekte.
func TestP28fClassifyClick(t *testing.T) {
	key := input.ClickEvent{Present: true, Type: nsKeyDown}
	up := input.ClickEvent{Present: true, Type: input.NSLeftMouseUp}
	if classifyClick(up, true) != clickLocal {
		t.Fatal("yerel tıklama")
	}
	if classifyClick(key, false) != clickKeyboard {
		t.Fatal("klavye")
	}
	for _, ev := range []input.ClickEvent{{}, up, {Present: true, Type: 0}} {
		if classifyClick(ev, false) != clickInjected {
			t.Fatalf("enjekte: %+v", ev)
		}
	}
}

// AC-390 / S-P28f-7 / D-P28f-K3: bant yalnız beklenen Developer ID ekibiyle (Team ID eşit, ad-hoc değil) imzalı ve
// TEST olmayan derlemede gizli; beklenen Team ID gömülmemişse ya da farklı ekiple imzalıysa gösterilir.
func TestP28fTestBand(t *testing.T) {
	const team = "ABCDE12345"
	signed := signInfo{TeamID: team}
	for _, c := range []struct {
		si       signInfo
		test     bool
		expected string
		want     bool
	}{
		{signed, false, team, false},
		{signed, true, team, true},
		{signed, false, "", true},                           // beklenen gömülmemiş
		{signInfo{TeamID: "ZZZZZ99999"}, false, team, true}, // başka ekip (D-P28f-K3)
		{signInfo{}, false, team, true},
		{signInfo{TeamID: team, AdHoc: true}, false, team, true},
		{signInfo{TeamID: team, Err: errors.New("x")}, false, team, true},
	} {
		if got := showTestBand(c.si, c.test, c.expected); got != c.want {
			t.Errorf("%+v test=%v beklenen=%q → %v", c.si, c.test, c.expected, got)
		}
	}
}

// Y-P28f-K1: AppKit çerçevesi (sol alt köken) CoreGraphics noktasına (sol üst köken) çevrilir, 1 nokta dışa.
func TestYP28fK1FlipRect(t *testing.T) {
	// 1440x900 birincil ekranda sol altta (100,50) 400x300 pencere → CG üst = 900-(50+300) = 550.
	if got := flipRect(100, 50, 400, 300, 900); got != (input.FRect{X: 99, Y: 549, W: 402, H: 302}) {
		t.Fatalf("%+v", got)
	}
	// birincil ekranın üstündeki ikinci ekran (y > 900) → negatif CG y.
	if got := flipRect(0, 1000, 200, 100, 900); got.Y != -201 {
		t.Fatalf("%+v", got)
	}
}
