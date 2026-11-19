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

// AC-504 / AC-390 / K-P28f-r4-5 / D-P28f-K3: bant TEST derlemesinde ya da beklenen Team ID gömülüyken imza ona
// uymuyorsa gösterilir; prod ad-hoc (beklenen boş) derlemede yoktur.
func TestAC504TestBand(t *testing.T) {
	const team = "ABCDE12345"
	signed := signInfo{TeamID: team}
	adhoc := signInfo{AdHoc: true}
	for _, c := range []struct {
		name     string
		si       signInfo
		test     bool
		expected string
		want     bool
	}{
		{"prod ad-hoc", adhoc, false, "", false},
		{"prod ad-hoc imza okunamadı", signInfo{Err: errors.New("x")}, false, "", false},
		{"stg ad-hoc", adhoc, true, "", true},
		{"stg Developer ID", signed, true, team, true},
		{"Developer ID eşleşen", signed, false, team, false},
		{"Developer ID farklı ekip", signInfo{TeamID: "ZZZZZ99999"}, false, team, true},
		{"Developer ID beklenen ama ad-hoc", signInfo{TeamID: team, AdHoc: true}, false, team, true},
		{"Developer ID beklenen ama Team ID boş", signInfo{}, false, team, true},
		{"Developer ID beklenen ama Err", signInfo{TeamID: team, Err: errors.New("x")}, false, team, true},
	} {
		if got := showTestBand(c.si, c.test, c.expected); got != c.want {
			t.Errorf("%s: %+v test=%v beklenen=%q → %v", c.name, c.si, c.test, c.expected, got)
		}
	}
}

// AC-504: Hakkında'daki tek imza satırı.
func TestAC504AboutSigLine(t *testing.T) {
	for _, c := range []struct {
		si   signInfo
		want string
	}{
		{signInfo{AdHoc: true}, "İmza: ad-hoc (Apple Developer ID yok)"},
		{signInfo{TeamID: "ABCDE12345"}, "İmza: Apple Developer ID (Ekip ABCDE12345)"},
		{signInfo{Err: errors.New("x")}, "İmza: doğrulanamadı"},
		{signInfo{TeamID: "ABCDE12345", AdHoc: true, Err: errors.New("x")}, "İmza: doğrulanamadı"},
		{signInfo{}, "İmza: doğrulanamadı"},
	} {
		if got := aboutSigLine(c.si); got != c.want {
			t.Errorf("%+v → %q, beklenen %q", c.si, got, c.want)
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
