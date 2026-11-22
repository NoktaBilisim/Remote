package input

import (
	"math/rand/v2"
	"strings"
	"testing"
)

// P33 K2 (mimari-p33 §6.4, §9; AC-549, S-P33-T-2, S-P33-T-5): macOS pencere modu kısayol politikası. Build etiketsiz:
// Linux CI'da da koşar. Tuş adları DOM code'dur; eşleme Control* = ⌘, Meta* = ⌃, Alt* = ⌥.

// macDesk sahte masaüstü + işletim sistemi ⇧ durumu (osShifter).
type macDesk struct {
	*fakeDesk
	shift bool
}

func (d *macDesk) OSShift() bool { return d.shift }

func newMacScoped(t *testing.T) (*macDesk, *fakeInj, *Applier, *[]string) {
	t.Helper()
	d, inj, a, logs := newScoped(t)
	md := &macDesk{fakeDesk: d}
	a.SetWindowTarget(hTarget, virtDesk, md)
	a.SetShortcutPolicy(MacShortcuts())
	return md, inj, a, logs
}

// chord mods basılıyken key'e basar, sonra hepsini bırakır; key'in BASMASI enjekte edildiyse true.
func chord(a *Applier, inj *fakeInj, mods []string, key string) bool {
	for _, m := range mods {
		a.Handle(kd(m, true, ""))
	}
	inj.take()
	a.Handle(kd(key, true, ""))
	sent := hasVKDown(inj.take(), codeVK[key].vk)
	a.Handle(kd(key, false, ""))
	for i := len(mods) - 1; i >= 0; i-- {
		a.Handle(kd(mods[i], false, ""))
	}
	inj.take()
	return sent
}

var (
	cmdK   = []string{"ControlLeft"}
	ctlK   = []string{"MetaLeft"}
	optK   = []string{"AltLeft"}
	sftK   = []string{"ShiftLeft"}
	sftCmd = []string{"ShiftLeft", "ControlLeft"}
)

func TestAC549MacShortcutTable(t *testing.T) {
	for _, c := range []struct {
		name string
		mods []string
		key  string
		pass bool
	}{
		// 1. genel kural (iki değiştirici)
		{"⌃⌘Q kilit ekranı", []string{"MetaLeft", "ControlLeft"}, "KeyQ", false},
		{"⌥⇧⌘Q", []string{"AltLeft", "ShiftLeft", "ControlLeft"}, "KeyQ", false},
		{"⌃⌘Space", []string{"MetaLeft", "ControlLeft"}, "Space", false},
		{"⌃⌘F tam ekran", []string{"MetaLeft", "ControlLeft"}, "KeyF", false},
		{"⌥⌘Esc zorla çık", []string{"AltLeft", "ControlLeft"}, "Escape", false},
		{"⌥⌘D Dock", []string{"AltLeft", "ControlLeft"}, "KeyD", false},
		{"⌃⌥ ok", []string{"MetaLeft", "AltLeft"}, "ArrowRight", false},
		{"⌃⇧⌘4", []string{"MetaLeft", "ShiftLeft", "ControlLeft"}, "Digit4", false},
		// 2. tek değiştirici tablosu
		{"⌃F1", ctlK, "F1", false},
		{"⌃ ok (Space geçişi)", ctlK, "ArrowLeft", false},
		{"⌃Space", ctlK, "Space", false},
		{"⌃Tab", ctlK, "Tab", false},
		{"⌃Esc", ctlK, "Escape", false},
		{"⌥Space", optK, "Space", false},
		{"⌘Space Spotlight", cmdK, "Space", false},
		{"⌘Tab", cmdK, "Tab", false},
		{"⌘`", cmdK, "Backquote", false},
		{"⌘F5 VoiceOver", cmdK, "F5", false},
		{"⇧⌘Q çıkış", sftCmd, "KeyQ", false},
		{"⇧⌘3", sftCmd, "Digit3", false},
		{"⇧⌘4", sftCmd, "Digit4", false},
		{"⇧⌘5", sftCmd, "Digit5", false},
		{"⇧⌘6", sftCmd, "Digit6", false},
		// 3. değiştiricisiz
		{"F3 Görev Kontrolü", nil, "F3", false},
		{"F4 Launchpad", nil, "F4", false},
		{"F11 masaüstü", nil, "F11", false},
		// 6. izinli listede olmayan birleşimler (varsayılan-ret)
		{"⌃C", ctlK, "KeyC", false},
		{"⌘ ok", cmdK, "ArrowLeft", false},
		{"⌘Enter", cmdK, "Enter", false},
		{"⌘Backspace", cmdK, "Backspace", false},
		{"⌥ noktalama", optK, "Minus", false},
		{"⌥ ok", optK, "ArrowLeft", false},
		// 6. izinli liste
		{"harf", nil, "KeyA", true},
		{"⇧ harf", sftK, "KeyA", true},
		{"Enter", nil, "Enter", true},
		{"Tab", nil, "Tab", true},
		{"Esc", nil, "Escape", true},
		{"Space", nil, "Space", true},
		{"ok", nil, "ArrowLeft", true},
		{"F1", nil, "F1", true},
		{"F5", nil, "F5", true},
		{"⌘C", cmdK, "KeyC", true},
		{"⌘V", cmdK, "KeyV", true},
		{"⌘X", cmdK, "KeyX", true},
		{"⌘Z", cmdK, "KeyZ", true},
		{"⌘A", cmdK, "KeyA", true},
		{"⌘S", cmdK, "KeyS", true},
		{"⇧⌘Z", sftCmd, "KeyZ", true},
		{"⇧⌘S", sftCmd, "KeyS", true},
		{"⌘W", cmdK, "KeyW", true},
		{"⌘Q (paylaşılan programı kapatır)", cmdK, "KeyQ", true},
		{"⌘3 (⇧ yok)", cmdK, "Digit3", true},
		{"⌘ noktalama", cmdK, "Minus", true},
		{"⌥E", optK, "KeyE", true},
		{"⌥⇧2", []string{"AltLeft", "ShiftLeft"}, "Digit2", true},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, inj, a, _ := newMacScoped(t)
			if got := chord(a, inj, c.mods, c.key); got != c.pass {
				t.Fatalf("iletildi=%v beklenen=%v", got, c.pass)
			}
			if !c.pass && a.ScopeDropped() == 0 {
				t.Fatal("düşme sayılmadı")
			}
			if len(a.keys) != 0 {
				t.Fatalf("basılı kalan: %v", a.keys)
			}
		})
	}
}

// S-P33-T-2 özellik testi: {⌘,⌥,⌃}'den herhangi ikisi (+ isteğe bağlı ⇧) ile rastgele değiştirici olmayan tuş düşer;
// tek ⌘ ile her harf geçer.
func TestAC549MacTwoModifiersAnyKeyDropped(t *testing.T) {
	r := rand.New(rand.NewPCG(33, 549))
	var keys []string
	for code := range codeMacVK {
		if !macModifier(code) {
			keys = append(keys, code)
		}
	}
	mods := [][]string{{"ControlLeft", "AltLeft"}, {"ControlRight", "MetaLeft"}, {"AltRight", "MetaRight"},
		{"ControlLeft", "AltLeft", "MetaLeft"}}
	_, inj, a, _ := newMacScoped(t)
	for range 2000 {
		m := append([]string(nil), mods[r.IntN(len(mods))]...)
		if r.IntN(2) == 0 {
			m = append([]string{"ShiftLeft"}, m...)
		}
		k := keys[r.IntN(len(keys))]
		if chord(a, inj, m, k) {
			t.Fatalf("%v + %s iletildi", m, k)
		}
	}
	for c := 'A'; c <= 'Z'; c++ {
		if !chord(a, inj, cmdK, "Key"+string(c)) {
			t.Fatalf("⌘%c düşmemeli", c)
		}
	}
}

// S-P33-T-2: değiştirici kararı işletim sisteminin durumunu da sayar (yerel kullanıcının tuttuğu ⌘ + uzaktan Tab).
func TestAC549MacOSModifierStateCounted(t *testing.T) {
	for _, c := range []struct {
		name string
		set  func(d *macDesk)
		mods []string
		key  string
	}{
		{"OS ⌘ + Tab", func(d *macDesk) { d.osCtrl = true }, nil, "Tab"},
		{"OS ⌃ + ok", func(d *macDesk) { d.osWin = true }, nil, "ArrowLeft"},
		{"OS ⌥ + Space", func(d *macDesk) { d.osAlt = true }, nil, "Space"},
		{"OS ⌥ + uzak ⌘ + harf (iki değiştirici)", func(d *macDesk) { d.osAlt = true }, cmdK, "KeyH"},
		{"OS ⇧ (Yapışkan) + uzak ⌘Q = ⇧⌘Q", func(d *macDesk) { d.shift = true }, cmdK, "KeyQ"},
	} {
		t.Run(c.name, func(t *testing.T) {
			d, inj, a, _ := newMacScoped(t)
			c.set(d)
			if chord(a, inj, c.mods, c.key) {
				t.Fatal("iletildi")
			}
		})
	}
}

// S-P33-T-2: genel kural kilidi değiştiriciler bırakılana dek bütün basmaları düşürür.
func TestAC549MacLatchUntilModifiersReleased(t *testing.T) {
	_, inj, a, logs := newMacScoped(t)
	evs := play(a, inj, "+ControlLeft", "+AltLeft", "+Escape", "-Escape", "-AltLeft", "+KeyA", "-KeyA")
	if hasVKDown(evs, vkEsc, 'A') {
		t.Fatalf("kilitliyken iletildi: %+v", evs)
	}
	play(a, inj, "-ControlLeft")
	if !hasVKDown(play(a, inj, "+KeyA", "-KeyA"), 'A') {
		t.Fatal("bırakınca kilit açılmalı")
	}
	if len(*logs) == 0 || (*logs)[0] != DropShell {
		t.Fatalf("%v", *logs)
	}
}

// S-P33-T-5: art arda 5. ⇧ ve 5. ⌥ ayardan bağımsız düşer; araya giren tuş sayacı sıfırlar.
func TestAC549MacFifthShiftAndOptionDropped(t *testing.T) {
	for _, mod := range []string{"ShiftLeft", "AltLeft"} {
		t.Run(mod, func(t *testing.T) {
			_, inj, a, logs := newMacScoped(t)
			var seq []string
			for range 5 {
				seq = append(seq, "+"+mod, "-"+mod)
			}
			if evs := play(a, inj, seq...); len(evs) != 8 {
				t.Fatalf("4 basma+bırakma beklenir: %d", len(evs))
			}
			if len(*logs) != 1 || (*logs)[0] != DropSticky {
				t.Fatalf("%v", *logs)
			}
			play(a, inj, "+KeyA", "-KeyA")
			if evs := play(a, inj, "+"+mod, "-"+mod); len(evs) != 2 {
				t.Fatalf("sayaç sıfırlanmalı: %+v", evs)
			}
		})
	}
}

// S-P33-T-5: Yapışkan Tuşlar açık (ya da okunamadı) → Tab/Esc/Space ve tablo tuşları değiştiricisiz de düşer; Fare
// Tuşları açık → tuş takımı ve tuş takımsız karşılıkları düşer. Kapalıyken geçer.
func TestAC549MacStickyAndMouseKeys(t *testing.T) {
	sticky := []string{"Tab", "Escape", "Space", "ArrowUp", "F1", "Backquote", "KeyQ", "Digit3"}
	mouse := []string{"Numpad1", "NumLock", "KeyU", "KeyI", "Digit8"}
	d, inj, a, _ := newMacScoped(t)
	d.sticky, d.mouseKeys = true, true
	for _, k := range append(append([]string(nil), sticky...), mouse...) {
		if chord(a, inj, nil, k) {
			t.Fatalf("%s iletildi (ayar açık)", k)
		}
	}
	if !chord(a, inj, nil, "KeyA") || !chord(a, inj, nil, "Enter") {
		t.Fatal("sıradan tuş düşmemeli")
	}
	d2, inj2, a2, _ := newMacScoped(t)
	d2.sticky, d2.mouseKeys = false, false
	for _, k := range append(sticky[:4], mouse...) {
		if !chord(a2, inj2, nil, k) {
			t.Fatalf("%s düştü (ayar kapalı)", k)
		}
	}
}

// Açık konu (implementation.md P33-K2): Windows tarayıcısı AltGr için ControlLeft + AltRight gönderir; macOS pencere
// modunda bu ⌘⌥ sayılır ve genel kural (S-P33-T-2) karakteri düşürür. İstisna açılmaz; bu test davranışı sabitler.
func TestAC549MacAltGrDroppedByGeneralRule(t *testing.T) {
	_, inj, a, _ := newMacScoped(t)
	a.SetAltGrText(true)
	a.Handle(kd("ControlLeft", true, ""))
	a.Handle(kd("AltRight", true, ""))
	inj.take()
	a.Handle(kd("KeyQ", true, "@"))
	for _, e := range inj.take() {
		if !e.Mouse && e.Flags&KeyUp == 0 {
			t.Fatalf("AltGr karakteri iletildi: %+v", e)
		}
	}
}

// AC-558: Windows politikası (varsayılan) taşımadan etkilenmez: Ctrl+C geçer, Win düşer; macOS tablosundaki ⌘Tab
// karşılığı (Ctrl+Tab) Windows'ta geçer.
func TestAC558WindowsPolicyUnchangedAfterMove(t *testing.T) {
	_, inj, a, _ := newScoped(t)
	if !chord(a, inj, []string{"ControlLeft"}, "KeyC") || !chord(a, inj, []string{"ControlLeft"}, "Tab") {
		t.Fatal("Windows Ctrl+C / Ctrl+Tab geçmeli")
	}
	if chord(a, inj, []string{"MetaLeft"}, "KeyE") {
		t.Fatal("Windows Win+E düşmeli")
	}
	if !strings.HasPrefix(DropShell, "SHELL") {
		t.Fatal(DropShell)
	}
}
