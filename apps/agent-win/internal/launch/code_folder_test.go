package launch

import "testing"

// P28f AC-97/AC-392 + S-P28f-13: klasör/bundle adından kod, çapalı desen.
func TestP28fCodeFromBundlePath(t *testing.T) {
	cases := map[string]string{
		"/Users/a/Downloads/Destek-12345678/Nokta Destek.app":     "12345678",
		"/Users/a/Downloads/Destek-12345678 (1)/Nokta Destek.app": "12345678",
		"/Users/a/Downloads/Destek-12345678 2/Nokta Destek.app":   "12345678",
		"/Users/a/Downloads/Destek-12345678.app":                  "12345678",
		"/Users/a/Downloads/Nokta Destek.app":                     "",
		"/Users/a/Downloads/Destek-1234567/Nokta Destek.app":      "",
		"/Users/a/Downloads/Destek-123456789/Nokta Destek.app":    "",
		"/Users/a/Downloads/xDestek-12345678/Nokta Destek.app":    "",
		"/Users/a/Downloads/Destek-12345678 (1234)/N.app":         "",
		"/Users/a/Downloads/Destek-12345678-kopya/N.app":          "",
		"/Users/a/Downloads/Destek-١٢٣٤٥٦٧٨/N.app":                "",
		"": "",
	}
	for in, want := range cases {
		if got := CodeFromBundlePath(in); got != want {
			t.Errorf("CodeFromBundlePath(%q) = %q, beklenen %q", in, got, want)
		}
	}
}

// P28g AC-97/AC-398 (mimari-p28g §4.3): /proc/self/exe taban adından kod; Firefox'un boşluksuz `(1)` eki dahil.
// macOS örnekleri (yukarıda) aynen geçer; boşluksuz ek klasör adında da kabul edilir (genişletilmiş tek desen).
func TestAC398P28gCodeFromExeName(t *testing.T) {
	cases := map[string]string{
		"Destek-12345678":              "12345678",
		"Destek-12345678(1)":           "12345678",
		"Destek-12345678 (1)":          "12345678",
		"Destek-12345678(123)":         "12345678",
		"Destek-12345678 2":            "12345678",
		"Destek-12345678(1234)":        "",
		"Destek-12345678((1))":         "",
		"Destek-12345678.part":         "",
		"Destek-12345678.crdownload":   "",
		"Destek-12345678 (deleted)":    "",
		"Destek-12345678(1) (deleted)": "",
		"destek-12345678":              "",
		"Destek-1234567":               "",
		"Destek-123456789":             "",
		"Destek-12345678\n":            "",
		"NoktaDestek-linux":            "",
		"":                             "",
	}
	for in, want := range cases {
		if got := CodeFromExeName(in); got != want {
			t.Errorf("CodeFromExeName(%q) = %q, beklenen %q", in, got, want)
		}
	}
	if got := CodeFromBundlePath("/Users/a/Downloads/Destek-12345678(1)/Nokta Destek.app"); got != "12345678" {
		t.Errorf("boşluksuz ek klasör adında: %q", got)
	}
}
