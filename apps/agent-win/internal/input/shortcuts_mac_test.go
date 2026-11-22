package input

import (
	"math/rand/v2"
	"slices"
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

// altGrPress mods basılıyken code'a key metniyle basar; yalnız bu basmanın enjekte ettiği olayları döndürür, sonra
// hepsini bırakır. all, oturum başından beri enjekte edilen olayların tamamıdır (çeviriciye sırayla verilir).
func altGrPress(a *Applier, inj *fakeInj, all *[]Event, mods []string, code, key string) []Event {
	for _, m := range mods {
		a.Handle(kd(m, true, ""))
	}
	*all = append(*all, inj.take()...)
	a.Handle(kd(code, true, key))
	evs := inj.take()
	*all = append(*all, evs...)
	a.Handle(kd(code, false, key))
	for i := len(mods) - 1; i >= 0; i-- {
		a.Handle(kd(mods[i], false, ""))
	}
	*all = append(*all, inj.take()...)
	return evs
}

// keyDowns olaylarda bırakma olmayan klavye olayları.
func keyDowns(evs []Event) []Event {
	var out []Event
	for _, e := range evs {
		if !e.Mouse && e.Flags&KeyUp == 0 {
			out = append(out, e)
		}
	}
	return out
}

var altGr = []string{"ControlLeft", "AltRight"} // Windows tarayıcısının AltGr dizisi

func newAltGrScoped(t *testing.T) (*macDesk, *fakeInj, *Applier, *[]string) {
	t.Helper()
	d, inj, a, logs := newMacScoped(t)
	a.SetAltGrText(true)
	return d, inj, a, logs
}

// K5 AltGr kararı: Windows TR AltGr dizisi (ControlLeft↓ AltRight↓ tuş↓ key=@) pencere modunda tek bir Unicode olayı
// olarak geçer (VK yok); macOS çeviricisinde bu olay bayraksız (flags 0, vk 0) metin olayıdır. ⇧ eklenmesi de geçer.
func TestAC549MacAltGrTextPassesAsUnicode(t *testing.T) {
	_, inj, a, logs := newAltGrScoped(t)
	var all []Event
	for _, c := range []struct {
		mods      []string
		code, key string
	}{
		{altGr, "KeyQ", "@"}, {altGr, "Digit3", "#"}, {altGr, "Digit7", "{"}, {altGr, "Digit0", "}"},
		{altGr, "Digit8", "["}, {altGr, "Digit9", "]"}, {altGr, "Minus", "|"}, {altGr, "Equal", "~"},
		{altGr, "KeyE", "€"}, {append([]string{"ShiftLeft"}, altGr...), "KeyE", "€"},
	} {
		downs := keyDowns(altGrPress(a, inj, &all, c.mods, c.code, c.key))
		r := []rune(c.key)[0]
		if len(downs) != 1 || downs[0].Flags != KeyUnicode || downs[0].VK != 0 || downs[0].Scan != uint16(r) {
			t.Fatalf("%v + %s (%s): %+v", c.mods, c.code, c.key, downs)
		}
	}
	if len(*logs) != 0 {
		t.Fatalf("düşme olmamalı: %v", *logs)
	}
	var text int
	for _, e := range newMacTranslator(nil, func() uint64 { return 0 }).translate(all) {
		if e.text != nil {
			text++
			if e.flags != 0 || e.vk != 0 {
				t.Fatalf("Unicode olayı bayraksız olmalı: %+v", e)
			}
		}
	}
	if text == 0 {
		t.Fatal("çeviricide metin olayı yok")
	}
	if len(a.keys) != 0 {
		t.Fatalf("basılı kalan: %v", a.keys)
	}
}

// K5 AltGr kararı m.3: key yoksa, "Dead" ise ya da çok karakterliyse istisna yok → genel kural düşürür (VK yoluna
// geçmez). Yazı tuşu olmayan tuşlar (Tab/Space/F5/ArrowLeft) AltGr ile, key metni ne olursa olsun düşer (uzun key
// adları — "ArrowLeft" — zaten mesaj doğrulamasında reddedilir).
func TestAC549MacAltGrWithoutCharacterDropped(t *testing.T) {
	for _, c := range []struct{ code, key string }{
		{"KeyQ", ""}, {"KeyQ", "Dead"}, {"KeyQ", "ab"}, {"Tab", "Tab"}, {"Space", " "}, {"F5", "F5"},
		{"ArrowLeft", ""}, {"ArrowLeft", "@"}, {"Space", "@"}, {"Tab", "@"}, {"F5", "@"},
	} {
		t.Run(c.code+"/"+c.key, func(t *testing.T) {
			_, inj, a, logs := newAltGrScoped(t)
			var all []Event
			if downs := keyDowns(altGrPress(a, inj, &all, altGr, c.code, c.key)); len(downs) != 0 {
				t.Fatalf("iletildi: %+v", downs)
			}
			if len(*logs) == 0 || (*logs)[0] != DropShell {
				t.Fatalf("%v", *logs)
			}
		})
	}
}

// K5 AltGr kararı m.1–2, m.5: AltRight yoksa (AltLeft+ControlLeft), ek ⌃/AltLeft/ControlRight basılıysa, OS ⌃
// basılıysa, altGrText kapalıysa ya da kabuk kilidi açıksa istisna yok.
func TestAC549MacAltGrExtraModifiersDropped(t *testing.T) {
	for _, c := range []struct {
		name string
		set  func(d *macDesk, a *Applier)
		mods []string
	}{
		{"AltLeft+ControlLeft", nil, []string{"ControlLeft", "AltLeft"}},
		{"+MetaLeft (⌃)", nil, []string{"ControlLeft", "AltRight", "MetaLeft"}},
		{"+MetaRight (⌃)", nil, []string{"ControlLeft", "AltRight", "MetaRight"}},
		{"+AltLeft", nil, []string{"ControlLeft", "AltRight", "AltLeft"}},
		{"+ControlRight", nil, []string{"ControlLeft", "AltRight", "ControlRight"}},
		{"OS ⌃", func(d *macDesk, _ *Applier) { d.osWin = true }, altGr},
		{"altGrText kapalı", func(_ *macDesk, a *Applier) { a.SetAltGrText(false) }, altGr},
	} {
		t.Run(c.name, func(t *testing.T) {
			d, inj, a, _ := newAltGrScoped(t)
			if c.set != nil {
				c.set(d, a)
			}
			var all []Event
			if downs := keyDowns(altGrPress(a, inj, &all, c.mods, "KeyQ", "@")); len(downs) != 0 {
				t.Fatalf("iletildi: %+v", downs)
			}
		})
	}
	t.Run("kilit açık", func(t *testing.T) {
		_, inj, a, _ := newAltGrScoped(t)
		play(a, inj, "+ControlLeft", "+AltRight", "+Tab", "-Tab") // AltGr dizisiyle Tab kilidi açar; ⌘⌥ basılı kalır
		if !a.scopeLatch {
			t.Fatal("kilit açılmalıydı")
		}
		a.Handle(kd("KeyQ", true, "@")) // istisna koşulları tam, ama kilit önce
		if downs := keyDowns(inj.take()); len(downs) != 0 {
			t.Fatalf("kilitliyken iletildi: %+v", downs)
		}
	})
}

// K5 AltGr kararı m.5: Yapışkan Tuşlar açıkken 5. madde tuşları (KeyQ tablo tuşu) ve Fare Tuşları açıkken karşılık
// tuşları (KeyU, Digit7) istisnadan önce düşer; diğer karakter tuşları geçer.
func TestAC549MacAltGrStickyAndMouseKeysFirst(t *testing.T) {
	d, inj, a, _ := newAltGrScoped(t)
	d.sticky, d.mouseKeys = true, true
	var all []Event
	for _, k := range []string{"KeyQ", "Digit3", "KeyU", "KeyI", "Digit7"} {
		if downs := keyDowns(altGrPress(a, inj, &all, altGr, k, "@")); len(downs) != 0 {
			t.Fatalf("%s iletildi (ayar açık): %+v", k, downs)
		}
	}
	if downs := keyDowns(altGrPress(a, inj, &all, altGr, "Digit0", "}")); len(downs) != 1 || downs[0].Flags != KeyUnicode {
		t.Fatalf("Digit0 } geçmeli: %+v", downs)
	}
}

// K5 AltGr kararı m.4 (savunma derinliği): istisnayla geçen basma Unicode yoluna gitmezse enjekte edilmez. Burada
// KeyQ önce tek ⌘ ile VK olarak basılır (⌘Q izinli); AltRight eklenince gelen otomatik tekrar istisna koşullarını
// sağlar ama key() önceki yöntemi (VK) kullanacağı için düşer.
func TestAC549MacAltGrRepeatOfVKKeyDropped(t *testing.T) {
	_, inj, a, logs := newAltGrScoped(t)
	a.Handle(kd("ControlLeft", true, ""))
	a.Handle(kd("KeyQ", true, "q"))
	if !hasVKDown(inj.take(), 'Q') {
		t.Fatal("⌘Q VK olarak geçmeli")
	}
	a.Handle(kd("AltRight", true, ""))
	inj.take()
	a.Handle(kd("KeyQ", true, "@")) // otomatik tekrar
	if downs := keyDowns(inj.take()); len(downs) != 0 {
		t.Fatalf("VK tekrarı iletildi: %+v", downs)
	}
	if len(*logs) == 0 || (*logs)[len(*logs)-1] != DropShell {
		t.Fatalf("%v", *logs)
	}
}

// S-P33-T-2 özellik testi (AltGr istisnasıyla): ControlLeft + AltRight her zaman basılı, üstüne rastgele ek
// değiştirici, rastgele tuş ve key metni. Kâhin istisnayı politikadan bağımsız yazar: yalnız ek değiştirici ⇧'dan
// ibaretse, tuş yazı tuşuysa ve metin tek yazdırılabilir karakterse tek bir Unicode olayı geçer; aksi halde hiçbir
// basma iletilmez. Tuşun VK basması hiçbir durumda iletilmez.
func TestAC549MacAltGrPropertyOracle(t *testing.T) {
	r := rand.New(rand.NewPCG(549, 33))
	var keys []string
	for code := range codeMacVK {
		if !macModifier(code) {
			keys = append(keys, code)
		}
	}
	slices.Sort(keys)
	extras := []string{"ShiftLeft", "ShiftRight", "AltLeft", "MetaLeft", "MetaRight", "ControlRight", "CapsLock"}
	texts := []string{"", "@", "€", "{", "Dead", "ab", " ", "ç"}
	_, inj, a, _ := newAltGrScoped(t)
	var all []Event
	passed := 0
	for range 2000 {
		mods := append([]string(nil), altGr...)
		onlyShift := true
		for _, e := range extras {
			if r.IntN(5) == 0 {
				mods = append(mods, e)
				onlyShift = onlyShift && (e == "ShiftLeft" || e == "ShiftRight")
			}
		}
		code, text := keys[r.IntN(len(keys))], texts[r.IntN(len(texts))]
		rs := []rune(text)
		want := onlyShift && charKey(code) && len(rs) == 1 && rs[0] != ' '
		downs := keyDowns(altGrPress(a, inj, &all, mods, code, text))
		if hasVKDown(downs, codeVK[code].vk) {
			t.Fatalf("%v + %s (%q): VK iletildi", mods, code, text)
		}
		switch {
		case want && (len(downs) != 1 || downs[0].Flags != KeyUnicode || downs[0].Scan != uint16(rs[0])):
			t.Fatalf("%v + %s (%q): geçmeliydi, %+v", mods, code, text, downs)
		case !want && len(downs) != 0:
			t.Fatalf("%v + %s (%q): düşmeliydi, %+v", mods, code, text, downs)
		}
		if want {
			passed++
		}
	}
	if passed == 0 {
		t.Fatal("hiç geçen örnek yok (kâhin sınanmadı)")
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
