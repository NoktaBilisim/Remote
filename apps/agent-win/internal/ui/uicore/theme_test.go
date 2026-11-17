package uicore

import (
	"math"
	"testing"
)

// AC-247: iki temada paletteki her metin/zemin çifti WCAG AA (≥ 4.5:1).
func TestAC247ContrastTableWCAGAA(t *testing.T) {
	for _, dark := range []bool{false, true} {
		for _, p := range ThemePalette(dark).textPairs() {
			if r := contrastRatio(p.fg, p.bg); r < 4.5 {
				t.Errorf("koyu=%v %s: %.2f:1 < 4.5:1", dark, p.name, r)
			}
		}
	}
}

// AC-247 regresyon: açık tablo 0.10.x görünümüyle aynı (Windows varsayılan pencere/metin rengi + 0.10.x uyarı kırmızısı).
func TestAC247LightPaletteMatches010x(t *testing.T) {
	want := Palette{Window: RGB{255, 255, 255}, Text: RGB{0, 0, 0}, Danger: RGB{185, 28, 28}, Field: RGB{255, 255, 255},
		FieldText: RGB{0, 0, 0}, LogoBg: RGB{255, 255, 255}}
	if ThemePalette(false) != want {
		t.Fatalf("açık tablo değişti: %+v", ThemePalette(false))
	}
}

// AC-247: koyu tablo DESIGN.md §2 koyu token'ları; logo kutusu koyu temada açık zeminli kalır.
func TestAC247DarkPaletteDesignTokens(t *testing.T) {
	d := ThemePalette(true)
	if d.Window != (RGB{0x15, 0x1b, 0x22}) || d.Text != (RGB{0xe6, 0xeb, 0xf0}) || d.Danger != (RGB{0xff, 0x8a, 0x80}) ||
		d.Field != (RGB{0x1d, 0x25, 0x2e}) || d.LogoBg != (RGB{0xf5, 0xf7, 0xfa}) {
		t.Fatalf("koyu tablo DESIGN.md ile uyumsuz: %+v", d)
	}
	if luminance(d.Window) > 0.05 || luminance(d.LogoBg) < 0.8 {
		t.Fatal("koyu zemin koyu, logo zemini açık olmalı")
	}
}

// AC-247: AppsUseLightTheme yoksa açık; 0 → koyu; 1 → açık; yüksek karşıtlıkta sistem renkleri (açık yol).
func TestAC247UseDarkDecision(t *testing.T) {
	cases := []struct {
		v         uint32
		found, hc bool
		want      bool
	}{
		{0, false, false, false}, {0, true, false, true}, {1, true, false, false}, {0, true, true, false},
	}
	for _, c := range cases {
		if got := UseDark(c.v, c.found, c.hc); got != c.want {
			t.Errorf("UseDark(%d,%v,%v)=%v", c.v, c.found, c.hc, got)
		}
	}
}

// WCAG hesap fonksiyonunun kendisi: bilinen değerler.
func TestAC247ContrastFunction(t *testing.T) {
	for _, c := range []struct {
		a, b RGB
		want float64
	}{
		{RGB{0, 0, 0}, RGB{255, 255, 255}, 21},
		{RGB{255, 255, 255}, RGB{255, 255, 255}, 1},
		{RGB{0x76, 0x76, 0x76}, RGB{255, 255, 255}, 4.54},
	} {
		if got := contrastRatio(c.a, c.b); math.Abs(got-c.want) > 0.01 {
			t.Errorf("%v/%v: %.3f, beklenen %.2f", c.a, c.b, got, c.want)
		}
		if contrastRatio(c.a, c.b) != contrastRatio(c.b, c.a) {
			t.Error("sıra bağımsız olmalı")
		}
	}
}

// AC-247 / AC-346: gösterge ve 3 sn bildirim satırı iki temada aynı renklerle WCAG AA (≥ 4.5:1).
func TestAC247IndicatorNoticeContrast(t *testing.T) {
	if r := contrastRatio(IndicatorText, IndicatorBg); r < 4.5 {
		t.Fatalf("gösterge/bildirim: %.2f:1 < 4.5:1", r)
	}
}
