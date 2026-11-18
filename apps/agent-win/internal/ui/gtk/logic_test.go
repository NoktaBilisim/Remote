package gtk

import (
	"strings"
	"testing"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

type fakeGuard struct{ ok, a11y bool }

func (g fakeGuard) LocalClick(_, _ ButtonEvent) bool { return g.ok }
func (g fakeGuard) A11yChanged() bool                { return g.a11y }

// AC-99/AC-116 + §5.2a m.1–m.2 (S-P28g-3, S-P28g-13): yalnız aynı denetimde sol basış + sol bırakma, send_event 0,
// bırakma içeride ve K3 kararı olumlu → yerel. Guard yoksa ret (fail-closed); a11y değiştiyse ayrı sınıf.
func TestAC399P28gK4ClassifyClick(t *testing.T) {
	press := ButtonEvent{Present: true, Button: 1, DeviceID: 9}
	rel := ButtonEvent{Present: true, Release: true, Button: 1, DeviceID: 9, Inside: true}
	ok := fakeGuard{ok: true}
	if classifyClick(ok, press, rel, true) != clickLocal {
		t.Fatal("yerel tıklama kabul edilmeli")
	}
	if classifyClick(nil, press, rel, true) != clickInjected {
		t.Fatal("guard yok → ret")
	}
	if classifyClick(fakeGuard{}, press, rel, true) != clickInjected {
		t.Fatal("K3 reddi → enjekte")
	}
	if classifyClick(fakeGuard{ok: true, a11y: true}, press, rel, true) != clickA11y {
		t.Fatal("a11y değişimi → ayrı ret")
	}
	mut := []func(p, r *ButtonEvent, have *bool){
		func(_, _ *ButtonEvent, h *bool) { *h = false },                // eşsiz bırakma
		func(p, _ *ButtonEvent, _ *bool) { p.SendEvent = true },        // XSendEvent basış
		func(_, r *ButtonEvent, _ *bool) { r.SendEvent = true },        // XSendEvent bırakma
		func(_, r *ButtonEvent, _ *bool) { r.Inside = false },          // dışarıda bırakma
		func(p, r *ButtonEvent, _ *bool) { p.Button, r.Button = 3, 3 }, // sağ düğme
		func(p, _ *ButtonEvent, _ *bool) { p.Release = true },          // basış yerine bırakma
		func(_, r *ButtonEvent, _ *bool) { r.Release = false },         // bırakma yerine basış
		func(p, _ *ButtonEvent, _ *bool) { *p = ButtonEvent{} },        // olay yok
		func(_, r *ButtonEvent, _ *bool) { *r = ButtonEvent{} },        // olay yok
	}
	for i, m := range mut {
		p, r, h := press, rel, true
		m(&p, &r, &h)
		if classifyClick(ok, p, r, h) != clickInjected {
			t.Errorf("durum %d reddedilmeli", i)
		}
	}
}

// O-P28g-T2-1: korunan sınıflarda opaklık/zemin resmi sabit, token renkleri, boyut alt sınırı; -gtk-icon-* yok.
func TestAC404P28gK4ThemeCSS(t *testing.T) {
	for _, dark := range []bool{false, true} {
		css := themeCSS(dark)
		for _, want := range []string{"opacity: 1", "background-image: none", "min-height", "font-size",
			"window." + clsWindow, "button." + clsButton, "." + clsDanger, "." + clsField} {
			if !strings.Contains(css, want) {
				t.Errorf("dark=%v: %q yok", dark, want)
			}
		}
		if strings.Contains(css, "-gtk-icon") {
			t.Error("-gtk-icon-* kullanılmamalı")
		}
	}
	if themeCSS(true) == themeCSS(false) {
		t.Fatal("koyu ve açık palet farklı olmalı")
	}
	if !strings.Contains(themeCSS(true), "#151b22") || !strings.Contains(themeCSS(false), "#ffffff") {
		t.Fatal("palet uicore'dan gelmeli")
	}
}

// O-P28g-T2-1: koyu tercih yalnız bool; GNOME gsd-xsettings yalnız tema adı verdiği için "-dark" son eki.
func TestAC404P28gK4DarkFrom(t *testing.T) {
	for name, want := range map[string]bool{"Yaru-dark": true, "Adwaita-dark": true, "Yaru-blue-dark": true,
		"Yaru": false, "Adwaita": false, "": false, "darkness": false} {
		if darkFrom(name, false) != want {
			t.Errorf("%q", name)
		}
	}
	if !darkFrom("Yaru", true) {
		t.Fatal("prefer-dark bool")
	}
}

// S-P28g-9: TEST metni çalışma anında; prod sayılmayan her adres TEST.
func TestAC403P28gK4TestBuild(t *testing.T) {
	for u, want := range map[string]bool{
		"https://stg.remote.noktabilisim.net": true,
		"https://destek.example.invalid:4450": true,
		"https://127.0.0.1:4450":              true,
		"https://localhost":                   true,
		"::bozuk":                             true,
		"https://remote.noktabilisim.net":     false,
		"https://destek.firma.com.tr":         false,
	} {
		if testBuild(u, false) != want {
			t.Errorf("%s", u)
		}
	}
	if !testBuild("https://remote.noktabilisim.net", true) {
		t.Fatal("TEST bayrağı")
	}
	if title("Nokta Destek", true, flow.LinuxTexts.TestBand) != "Nokta Destek — TEST" || title("A", false, "TEST") != "A" {
		t.Fatal("başlık")
	}
}

// G-03 / S-P28g-3 m.3: X11'de diyalog imleci kapsamaz; Wayland'de monitör ortası.
func TestAC398P28gK4PlaceDialog(t *testing.T) {
	work := rect{0, 0, 1920, 1080}
	w, h := 460, 300
	cx, cy := work.X+(work.W-w)/2, work.Y+(work.H-h)/2
	if x, y := placeDialog(work, w, h, 960, 540, true); x != cx || y != cy {
		t.Fatalf("wayland %d,%d", x, y)
	}
	if x, y := placeDialog(work, w, h, 10, 10, false); x != cx || y != cy {
		t.Fatal("imleç uzaktaysa orta")
	}
	for _, p := range [][2]int{{960, 540}, {960, 400}, {960, 700}, {800, 540}} {
		x, y := placeDialog(work, w, h, p[0], p[1], false)
		if (rect{x - 1, y - 1, w + 2, h + 2}).contains(p[0], p[1]) {
			t.Errorf("imleç %v diyalog altında (%d,%d)", p, x, y)
		}
		if y < 0 || y+h > 1080 {
			t.Errorf("ekran dışı %v → %d", p, y)
		}
	}
	// küçük çalışma alanı: dikey sığmaz → yatay kaçış
	small := rect{0, 0, 1920, 400}
	x, y := placeDialog(small, w, 300, 960, 200, false)
	if (rect{x, y, w, 300}).contains(960, 200) {
		t.Fatal("yatay kaçış")
	}
}

// §2.1: kısayol satırı Wayland'de "Durdur" yolu; FFI dizgi temizliği.
func TestAC399P28gK4HotkeyAndClean(t *testing.T) {
	if hotkeyLine("Ctrl+Shift+F12", true, flow.LinuxTexts.WaylandHotkey) != flow.LinuxTexts.WaylandHotkey {
		t.Fatal("wayland")
	}
	if !strings.Contains(hotkeyLine("Ctrl+Shift+F12", false, "x"), "Ctrl+Shift+F12") {
		t.Fatal("x11")
	}
	if clean("a\x00b\xff") != "ab�" {
		t.Fatalf("%q", clean("a\x00b\xff"))
	}
	if len(clean(strings.Repeat("ş", textMax))) > textMax {
		t.Fatal("sınır")
	}
	if monitorLabel("DP-1", 1920, 1080, true) != "DP-1 — 1920×1080 (birincil)" {
		t.Fatal("monitör")
	}
}

// Sürüm gösterimi (2026-11-18): sürüm uygulama adının yanında, TEST eki sonda (çakışmaz).
func TestVersionTitleWithTest(t *testing.T) {
	got := title(uicore.VersionedTitle(uicore.UnreadTitle(2), "0.20.0"), true, flow.LinuxTexts.TestBand)
	if got != "(2 yeni) Nokta Destek 0.20.0 — Oturum — "+flow.LinuxTexts.TestBand {
		t.Fatalf("başlık %q", got)
	}
}
