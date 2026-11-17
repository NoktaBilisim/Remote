package config

import (
	"strings"
	"testing"
)

func TestAC109ParseAcceptsHTTPSOnly(t *testing.T) {
	ok := []string{"https://destek.example", "https://destek.example:4450", "https://destek.example:4450/"}
	for _, in := range ok {
		c, err := parse(in, "1.0.0")
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		if c.ServerURL.Path != "" || c.ServerURL.Scheme != "https" {
			t.Fatalf("%q: normalize edilmedi: %v", in, c.ServerURL)
		}
	}
	bad := []string{"", "http://destek.example", "wss://destek.example", "https://", "https://u:p@destek.example",
		"https://destek.example/api", "https://destek.example?x=1", "https://destek.example#f", "destek.example"}
	for _, in := range bad {
		if _, err := parse(in, "1.0.0"); err == nil {
			t.Fatalf("%q kabul edilmemeliydi", in)
		}
	}
}

func TestAC109LoadWithoutLdflagsFails(t *testing.T) {
	if _, err := Load(); err != ErrNotConfigured {
		t.Fatalf("ldflags olmadan ErrNotConfigured beklenirdi, alınan %v", err)
	}
	if _, err := parse("https://destek.example", ""); err != ErrNotConfigured {
		t.Fatalf("sürümsüz build reddedilmeli")
	}
}

func TestAC128FingerprintIsFirst8HexOfSHA256(t *testing.T) {
	// sha256("abc") = ba7816bf...
	got, err := Fingerprint(strings.NewReader("abc"))
	if err != nil || got != "ba7816bf" {
		t.Fatalf("got %q %v", got, err)
	}
	c, _ := parse("https://destek.example:4450", "1.2.3")
	if c.DisplayHost() != "destek.example:4450" || c.Version != "1.2.3" {
		t.Fatalf("display %q", c.DisplayHost())
	}
}

// P28f S-P28f-7: TEST derlemesi yalnız `-X config.testBuild=1` ile; başka değer TEST sayılmaz.
func TestP28fTestBuildFlag(t *testing.T) {
	for v, want := range map[string]bool{"1": true, "": false, "0": false, "true": false, " 1": false} {
		if got := isTestBuild(v); got != want {
			t.Errorf("isTestBuild(%q) = %v, beklenen %v", v, got, want)
		}
	}
}
