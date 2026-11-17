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
