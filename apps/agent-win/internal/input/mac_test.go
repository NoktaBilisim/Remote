package input

import (
	"testing"
	"time"
	"unicode/utf16"

	"remote-support/agent-win/internal/control"
)

// P28f K3 — macOS girdi çevirisi (saf Go; her platformda koşar).

// AC-48: DOM code → kVK tablosu SDK değerleriyle; Windows tablosundaki her code'un Mac karşılığı var (bilinçli
// düşürülenler hariç) ve (VK, E0) → kVK çevirisinde çakışma yok.
func TestAC48MacKeyTable(t *testing.T) {
	want := map[string]uint16{"KeyA": 0x00, "KeyQ": 0x0C, "KeyZ": 0x06, "KeyC": 0x08, "KeyV": 0x09, "KeyX": 0x07,
		"Digit0": 0x1D, "Digit1": 0x12, "Digit9": 0x19, "F1": 0x7A, "F5": 0x60, "F11": 0x67, "F12": 0x6F,
		"Enter": 0x24, "NumpadEnter": 0x4C, "Backspace": 0x33, "Delete": 0x75, "Escape": 0x35, "Tab": 0x30,
		"ArrowLeft": 0x7B, "ArrowUp": 0x7E, "Home": 0x73, "PageDown": 0x79, "Numpad0": 0x52, "Numpad9": 0x5C,
		"Backquote": 0x32, "IntlBackslash": 0x0A, "Comma": 0x2B, "Period": 0x2F}
	for code, kvk := range want {
		if got, ok := codeMacVK[code]; !ok || got != kvk {
			t.Errorf("%s: %#x, beklenen %#x", code, got, kvk)
		}
	}
	for code := range codeVK {
		_, ok := codeMacVK[code]
		dropped := code == "PrintScreen" || code == "ScrollLock" || code == "Pause"
		if ok == dropped {
			t.Errorf("%s: tabloda=%v (bilinçli düşen=%v)", code, ok, dropped)
		}
	}
	seen := map[vkInfo]string{}
	for code := range codeMacVK {
		vk, ok := codeVK[code]
		if !ok {
			t.Fatalf("%s Windows tablosunda yok", code)
		}
		if prev, dup := seen[vk]; dup {
			t.Fatalf("(VK,E0) çakışması: %s / %s", prev, code)
		}
		seen[vk] = code
		if macVK[vk] != codeMacVK[code] {
			t.Fatalf("%s türetilmiş tablo farklı", code)
		}
	}
}

// fakeInj Applier → çevirici zincirini kaydeder.
type macRec struct {
	tr  *macTranslator
	out []macEvent
}

func (r *macRec) Inject(evs []Event) error {
	r.out = append(r.out, r.tr.translate(evs)...)
	return nil
}

func newMacRig(t *testing.T, osFlags uint64) (*Applier, *macRec, *control.Gate, *time.Time) {
	t.Helper()
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	clk := &now
	tr := newMacTranslator(func() time.Time { return *clk }, func() uint64 { return osFlags })
	g := &control.Gate{}
	g.Open()
	rec := &macRec{tr: tr}
	a := NewApplier(g, rec, func() time.Time { return *clk })
	mon := Rect{Left: 0, Top: 0, Right: 2056, Bottom: 1329} // Retina ölçekli kip: nokta
	virt := Rect{Left: -1920, Top: -200, Right: 2056, Bottom: 1329}
	a.SetTarget(mon, virt)
	tr.virt = virt
	return a, rec, g, clk
}

func key(code string, down bool, k ...string) []byte {
	s := `{"t":"k","code":"` + code + `","down":` + map[bool]string{true: "true", false: "false"}[down]
	if len(k) > 0 {
		s += `,"key":"` + k[0] + `"`
	}
	return []byte(s + "}")
}

// ADR-0037 m.3: Ctrl → ⌘, Win → Control, Alt → Option; ⌘ bayrağı kısayol tuşunda, bırakınca kalkar.
func TestAC48ModifierMappingCtrlToCommand(t *testing.T) {
	a, rec, _, _ := newMacRig(t, 0)
	a.Handle(key("ControlLeft", true))
	a.Handle(key("KeyC", true, "c"))
	a.Handle(key("KeyC", false, "c"))
	a.Handle(key("ControlLeft", false))
	got := rec.out
	if len(got) != 4 || got[0].typ != cgFlagsChanged || got[0].vk != kvkCommand || got[0].flags&flagCommand == 0 {
		t.Fatalf("⌘ basma: %+v", got)
	}
	if got[1].typ != cgKeyDown || got[1].vk != 0x08 || got[1].flags&flagCommand == 0 || got[1].text != nil {
		t.Fatalf("⌘C: %+v", got[1])
	}
	if got[3].typ != cgFlagsChanged || got[3].flags&flagCommand != 0 {
		t.Fatalf("⌘ bırakma bayrağı kaldırmalı: %+v", got[3])
	}
	rec.out = nil
	a.Handle(key("MetaLeft", true))
	a.Handle(key("AltLeft", true))
	if rec.out[0].vk != kvkControl || rec.out[1].vk != kvkOption ||
		rec.out[1].flags&(flagControl|flagAlternate) != flagControl|flagAlternate {
		t.Fatalf("Win→Control, Alt→Option: %+v", rec.out)
	}
}

// AC-48: Türkçe Q karakterleri düzen bağımsız Unicode ile; bayraksız, vekil çiftleri birlikte.
func TestAC48TurkishTextUnicode(t *testing.T) {
	a, rec, _, _ := newMacRig(t, 0)
	for _, r := range []string{"ç", "ğ", "ı", "ö", "ş", "ü", "İ"} {
		a.Handle(key("KeyA", true, r))
		a.Handle(key("KeyA", false, r))
	}
	var s []rune
	for _, e := range rec.out {
		if e.typ == cgKeyDown {
			if e.flags != 0 || e.vk != 0 {
				t.Fatalf("Unicode olayı bayraksız olmalı: %+v", e)
			}
			s = append(s, utf16.Decode(e.text)...)
		}
	}
	if string(s) != "çğıöşüİ" {
		t.Fatalf("metin %q", string(s))
	}
	rec.out = nil
	a.Handle(key("KeyA", true, "😀"))
	if len(rec.out) != 1 || len(rec.out[0].text) != 2 {
		t.Fatalf("vekil çifti tek olayda: %+v", rec.out)
	}
}

// FFI kuralı 3: ≤ 20 birimlik parçalar, vekil çifti bölünmez.
func TestP28fUnicodeChunks(t *testing.T) {
	units := utf16.Encode([]rune("abcdefghijklmnopqrs😀xyz")) // 19 + 2 + 3
	out := appendText(nil, units, true)
	if len(out) != 2 || len(out[0].text) != 19 || len(out[1].text) != 5 {
		t.Fatalf("parçalar: %d %v", len(out), out)
	}
}

// S-P28f-1: Option ×5 (Fare Tuşları), ⌘F5 (VoiceOver), ⌘⌥F5 enjekte edilmez; yerel ⌘ basılıyken uzaktan F5 de düşer;
// düşen basmanın bırakması da düşer. AC-48 eşi: ⌃⌘Q (kilit) iletilmez.
func TestP28fAccessibilityShortcutsNeverInjected(t *testing.T) {
	a, rec, _, _ := newMacRig(t, 0)
	for range 4 {
		a.Handle(key("AltLeft", true))
		a.Handle(key("AltLeft", false))
	}
	n := len(rec.out)
	a.Handle(key("AltRight", true))
	a.Handle(key("AltRight", false))
	if len(rec.out) != n {
		t.Fatalf("5. Option enjekte edildi: %+v", rec.out[n:])
	}
	a.Handle(key("KeyB", true, "b")) // araya giren tuş sayacı sıfırlar
	a.Handle(key("KeyB", false, "b"))
	n = len(rec.out)
	a.Handle(key("AltLeft", true))
	if len(rec.out) != n+1 {
		t.Fatal("sayaç sıfırlandıktan sonra Option iletilmeli")
	}
	a.Handle(key("AltLeft", false))

	for _, mods := range [][]string{{"ControlLeft"}, {"ControlLeft", "AltLeft"}} {
		rec.out = nil
		for _, m := range mods {
			a.Handle(key(m, true))
		}
		a.Handle(key("F5", true))
		a.Handle(key("F5", false))
		for _, e := range rec.out {
			if e.vk == kvkF5 {
				t.Fatalf("%v+F5 enjekte edildi", mods)
			}
		}
		for _, m := range mods {
			a.Handle(key(m, false))
		}
	}
	rec.out = nil
	a.Handle(key("F5", true))
	if len(rec.out) != 1 || rec.out[0].vk != kvkF5 {
		t.Fatal("değiştiricisiz F5 iletilmeli")
	}
	a.Handle(key("F5", false))

	rec.out = nil
	a.Handle(key("MetaLeft", true))
	a.Handle(key("ControlLeft", true))
	a.Handle(key("KeyQ", true, "q"))
	for _, e := range rec.out {
		if e.vk == kvkANSIQ {
			t.Fatal("⌃⌘Q iletilmemeli")
		}
	}

	// Yerel kullanıcı ⌘ basılı tutuyor (sistem bayrağı) → uzaktan F5 düşer.
	b, rec2, _, _ := newMacRig(t, flagCommand)
	b.Handle(key("F5", true))
	b.Handle(key("F5", false))
	if len(rec2.out) != 0 {
		t.Fatalf("yerel ⌘ + uzak F5 enjekte edildi: %+v", rec2.out)
	}
}

// AC-49: normalize koordinat → nokta (Retina ölçekli kip, negatif kökenli ikinci ekran) ±2 px (= ±1 nokta) içinde;
// sürükleme `LeftMouseDragged`; çift tıkta tık sayısı 2.
func TestAC49MacCoordinatesDragAndDoubleClick(t *testing.T) {
	a, rec, _, clk := newMacRig(t, 0)
	for _, p := range [][2]float64{{0, 0}, {1, 1}, {0.5, 0.5}, {0.1234, 0.8765}} {
		rec.out = nil
		a.Handle([]byte(`{"t":"m.move","x":` + ftoa(p[0]) + `,"y":` + ftoa(p[1]) + `}`))
		wx, wy := p[0]*2055, p[1]*1328
		e := rec.out[0]
		if e.typ != cgMouseMoved || abs(e.x-wx) > 1 || abs(e.y-wy) > 1 {
			t.Fatalf("%v → (%.2f,%.2f), beklenen (%.2f,%.2f)", p, e.x, e.y, wx, wy)
		}
	}
	rec.out = nil
	a.Handle(btn("l", true, 0.5, 0.5))
	a.Handle([]byte(`{"t":"m.move","x":0.6,"y":0.5}`))
	a.Handle(btn("l", false, 0.6, 0.5))
	types := []uint32{}
	for _, e := range rec.out {
		types = append(types, e.typ)
	}
	if !containsSeq(types, []uint32{cgLeftMouseDown, cgLeftMouseDragged}) || types[len(types)-1] != cgLeftMouseUp {
		t.Fatalf("sürükleme türleri %v", types)
	}
	// çift tık
	*clk = clk.Add(time.Second)
	rec.out = nil
	a.Handle(btn("l", true, 0.3, 0.3))
	a.Handle(btn("l", false, 0.3, 0.3))
	*clk = clk.Add(200 * time.Millisecond)
	a.Handle(btn("l", true, 0.3, 0.3))
	a.Handle(btn("l", false, 0.3, 0.3))
	var clicks []int64
	for _, e := range rec.out {
		if e.typ == cgLeftMouseDown || e.typ == cgLeftMouseUp {
			clicks = append(clicks, e.click)
		}
	}
	if len(clicks) != 4 || clicks[0] != 1 || clicks[1] != 1 || clicks[2] != 2 || clicks[3] != 2 {
		t.Fatalf("tık sayıları %v", clicks)
	}
	*clk = clk.Add(time.Second) // aralık aşıldı → yeniden 1
	rec.out = nil
	a.Handle(btn("l", true, 0.3, 0.3))
	if rec.out[len(rec.out)-1].click != 1 {
		t.Fatal("0,5 sn sonra tık sayısı 1'e dönmeli")
	}
}

// Tekerlek: Windows yönü (+ yukarı) dikeyde korunur, yatayda CGEvent wheel2 (+ sol) için ters; piksel ölçeği.
func TestP28fWheel(t *testing.T) {
	a, rec, _, _ := newMacRig(t, 0)
	a.Handle([]byte(`{"t":"m.wheel","dx":120,"dy":120}`)) // DOM: aşağı ve sağa
	if len(rec.out) != 2 || rec.out[0].wheelY != -100 || rec.out[1].wheelX != -100 {
		t.Fatalf("tekerlek %+v", rec.out)
	}
}

// S-P28f-1 ikinci katman: korunan denetim açıkken basılı tuş/düğme bırakılır, yeni girdi düşer; Resume sonrası sürer.
func TestP28fPauseReleasesAndDrops(t *testing.T) {
	a, rec, g, _ := newMacRig(t, 0)
	a.Handle(key("ControlLeft", true))
	a.Handle(btn("l", true, 0.5, 0.5))
	rec.out = nil
	a.Pause()
	var up, cmdUp bool
	for _, e := range rec.out {
		up = up || e.typ == cgLeftMouseUp
		cmdUp = cmdUp || (e.typ == cgFlagsChanged && e.vk == kvkCommand && e.flags&flagCommand == 0)
	}
	if !up || !cmdUp {
		t.Fatalf("Pause basılıları bırakmalı: %+v", rec.out)
	}
	rec.out = nil
	before := g.Dropped()
	a.Handle(btn("l", true, 0.5, 0.5))
	a.Handle(key("KeyA", true, "a"))
	if len(rec.out) != 0 || g.Dropped() != before+2 {
		t.Fatalf("duraklatılmışken enjeksiyon: %+v", rec.out)
	}
	a.Pause()
	a.Resume()
	a.Handle(key("KeyB", true, "b"))
	if len(rec.out) != 0 {
		t.Fatal("iç içe Pause: tek Resume yetmemeli")
	}
	a.Resume()
	a.Handle(key("KeyB", true, "b"))
	if len(rec.out) != 1 {
		t.Fatal("Resume sonrası enjeksiyon sürmeli")
	}
}

// AC-101: kapı kapalıyken çevirici hiç çağrılmaz (Applier ortak kuralı macOS'ta da geçerli).
func TestAC101MacClosedGateNoEvents(t *testing.T) {
	a, rec, g, _ := newMacRig(t, 0)
	a.Handle(key("ShiftLeft", true))
	g.Close() // OnClose → ReleaseAll
	rec.out = nil
	a.Handle(key("KeyA", true, "a"))
	a.Handle(btn("l", true, 0.5, 0.5))
	if len(rec.out) != 0 {
		t.Fatalf("kapalı kapıda olay: %+v", rec.out)
	}
}

func containsSeq(s, sub []uint32) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		ok := true
		for j := range sub {
			ok = ok && s[i+j] == sub[j]
		}
		if ok {
			return true
		}
	}
	return false
}

// AC-48 Türkçe Q AltGr: Windows tarayıcısı AltGr'de ControlLeft + AltRight gönderir; Mac'te "@" bayraksız metin gider
// (⌘⌥Q değil). Gerçek Ctrl+Q (AltGr yok) ⌘Q kısayolu olarak kalır.
func TestAC48AltGrTextOnMac(t *testing.T) {
	a, rec, _, _ := newMacRig(t, 0)
	a.SetAltGrText(true)
	a.Handle(key("ControlLeft", true))
	a.Handle(key("AltRight", true))
	rec.out = nil
	a.Handle(key("KeyQ", true, "@"))
	if len(rec.out) != 1 || string(utf16.Decode(rec.out[0].text)) != "@" || rec.out[0].flags != 0 || rec.out[0].vk != 0 {
		t.Fatalf("AltGr+Q: %+v", rec.out)
	}
	a.Handle(key("KeyQ", false, "@"))
	a.Handle(key("AltRight", false))
	rec.out = nil
	a.Handle(key("KeyQ", true, "q"))
	if len(rec.out) != 1 || rec.out[0].vk != kvkANSIQ || rec.out[0].flags&flagCommand == 0 || rec.out[0].text != nil {
		t.Fatalf("Ctrl+Q → ⌘Q: %+v", rec.out)
	}
}

// Basılı F5'in otomatik tekrarı ⌘ basılınca düşer, ama daha önce enjekte edilmiş basmanın bırakması iletilir.
func TestP28fBlockedRepeatStillReleases(t *testing.T) {
	a, rec, _, _ := newMacRig(t, 0)
	a.Handle(key("F5", true))
	a.Handle(key("ControlLeft", true))
	rec.out = nil
	a.Handle(key("F5", true)) // tekrar
	if len(rec.out) != 0 {
		t.Fatalf("⌘ + F5 tekrarı enjekte edildi: %+v", rec.out)
	}
	a.Handle(key("F5", false))
	if len(rec.out) != 1 || rec.out[0].typ != cgKeyUp || rec.out[0].vk != kvkF5 {
		t.Fatalf("F5 bırakması iletilmeli: %+v", rec.out)
	}
}
