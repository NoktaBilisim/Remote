package macperm

import "testing"

// T4 / S-P28f-13: yalnız `--restart <32 onaltılık>` kabul edilir.
func TestP28fRestartToken(t *testing.T) {
	good := "0123456789abcdef0123456789abcdef"
	for _, c := range []struct {
		args []string
		ok   bool
	}{
		{[]string{"--restart", good}, true},
		{[]string{"-psn_0_1", "--restart", good}, true},
		{[]string{"--restart"}, false},
		{[]string{"--restart", "0123"}, false},
		{[]string{"--restart", "0123456789ABCDEF0123456789ABCDEF"}, false},
		{[]string{"-restart", good}, false},
		{[]string{"--restart=" + good}, false},
		{nil, false},
	} {
		got, ok := RestartToken(c.args)
		if ok != c.ok || (ok && got != good) {
			t.Errorf("%v → %q %v", c.args, got, ok)
		}
	}
	a, err := NewToken()
	if err != nil || !tokenRe.MatchString(a) {
		t.Fatalf("NewToken %q %v", a, err)
	}
	if b, _ := NewToken(); a == b {
		t.Fatal("belirteç rastgele olmalı")
	}
}
