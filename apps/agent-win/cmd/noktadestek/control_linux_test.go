//go:build linux

package main

import "testing"

// P28g K10 (§5.2b m.7, O-P28g-K1-1; D-P28g-K1-2): Wayland kontrol anahtarı kapalıyken yalnız ScreenCast istenir ve
// kontrol bağlanmaz (VIEW{WAYLAND_NO_CONTROL}); X11'de kontrol verilemezse kaynak OS_PERMISSION'dır.
func TestP28gK10ControlPlan(t *testing.T) {
	cases := []struct {
		name                       string
		wayland, waylandCtl, busOK bool
		portal, viewOnly           bool
		source                     string
	}{
		{"wayland açık + veri yolu", true, true, true, true, false, "WAYLAND_NO_CONTROL"},
		{"wayland açık, veri yolu uymuyor", true, true, false, false, false, "WAYLAND_NO_CONTROL"},
		{"wayland kapalı anahtar", true, false, true, false, true, "WAYLAND_NO_CONTROL"},
		{"wayland kapalı anahtar, veri yolu yok", true, false, false, false, true, "WAYLAND_NO_CONTROL"},
		{"x11 anahtar kapalı (etkisiz)", false, false, true, false, false, "OS_PERMISSION"},
		{"x11", false, true, true, false, false, "OS_PERMISSION"},
	}
	for _, c := range cases {
		p, v, s := controlPlan(c.wayland, c.waylandCtl, c.busOK)
		if p != c.portal || v != c.viewOnly || s != c.source {
			t.Errorf("%s: controlPlan = (%v, %v, %q), beklenen (%v, %v, %q)", c.name, p, v, s, c.portal, c.viewOnly, c.source)
		}
	}
}
