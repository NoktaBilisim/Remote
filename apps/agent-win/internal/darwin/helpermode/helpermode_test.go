package helpermode

import "testing"

// S-P33-T2-3: yardımcı kipi yalnız tam olarak [exe, "--opus-cozucu"] argv'siyle seçilir.
func TestP33K1HelperModeExactArgv(t *testing.T) {
	cases := []struct {
		args []string
		want bool
	}{
		{[]string{"/x/noktadestek", "--opus-cozucu"}, true},
		{[]string{"/x/noktadestek"}, false},
		{[]string{"/x/noktadestek", "--opus-cozucu", "ek"}, false},
		{[]string{"/x/noktadestek", "--opus-cozucu="}, false},
		{[]string{"/x/noktadestek", "-opus-cozucu"}, false},
		{[]string{"/x/noktadestek", "--restart", "--opus-cozucu"}, false},
		{nil, false},
	}
	for _, c := range cases {
		if got := Is(c.args); got != c.want {
			t.Errorf("Is(%q) = %v, beklenen %v", c.args, got, c.want)
		}
	}
}
