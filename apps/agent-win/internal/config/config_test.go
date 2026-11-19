package config

import (
	"crypto/ed25519"
	"crypto/sha256"
	"strings"
	"testing"

	"remote-support/agent-win/internal/update"
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

// P28f D-P28f-K3: beklenen Team ID yalnız `-X config.expectedTeamID=<10 karakter A-Z0-9>` ile; başka değer yok sayılır
// (bant gösterilir). Değişken adı build-darwin.sh TEAM_SYMBOL ile aynıdır (betik ikilide değeri denetler).
func TestP28fExpectedTeamID(t *testing.T) {
	for v, want := range map[string]string{"ABCDE12345": "ABCDE12345", "": "", "abcde12345": "", "ABCDE1234": "",
		"ABCDE123456": "", "ABCDE 1234": "", "ABCDE-1234": ""} {
		if got := teamID(v); got != want {
			t.Errorf("teamID(%q) = %q, beklenen %q", v, got, want)
		}
	}
	old := expectedTeamID
	defer func() { expectedTeamID = old }()
	expectedTeamID = "ABCDE12345"
	if c, _ := Load(); c.TeamID != "ABCDE12345" {
		t.Fatalf("Load TeamID = %q", c.TeamID)
	}
}

// P28g K10 (§5.2b m.7, O-P28g-K1-1): Wayland kontrol anahtarı yalnız boş/"on" ile açık; "off" ve bozuk değer kapalı.
func TestP28gK10WaylandControlSwitch(t *testing.T) {
	for v, want := range map[string]bool{"": true, "on": true, "off": false, "ON": false, "1": false, "on ": false} {
		if got := waylandControlOn(v); got != want {
			t.Errorf("waylandControlOn(%q) = %v, beklenen %v", v, got, want)
		}
	}
	old := waylandControl
	defer func() { waylandControl = old }()
	waylandControl = "off"
	if c, _ := Load(); c.WaylandControl {
		t.Fatal("Load: off iken açık")
	}
	waylandControl = ""
	if c, _ := Load(); !c.WaylandControl {
		t.Fatal("Load: varsayılan kapalı")
	}
}

// AC-472 / K-P29-1: güncelleme kökü ldflags'ten; boş (PR/yer tutucu) ya da bozuksa güncelleyici kapalı, Load hata dönmez.
func TestAC472UpdateTrustFailClosed(t *testing.T) {
	seed := sha256.Sum256([]byte("rs-update-test-key-config"))
	pub := update.EncodePublicKey(ed25519.NewKeyFromSeed(seed[:]).Public().(ed25519.PublicKey))
	if tr := updateTrust("prod", pub+","+pub); !tr.Enabled() || tr.Env != "prod" || len(tr.Keys) != 2 {
		t.Fatalf("geçerli kök kapalı: %+v", tr)
	}
	for _, c := range [][2]string{{"", ""}, {"prod", ""}, {"", pub}, {"dev", pub}, {"prod", pub + "," + pub + "," + pub}, {"prod", pub[:40]}} {
		if updateTrust(c[0], c[1]).Enabled() {
			t.Errorf("%q/%q açık olmamalı", c[0], c[1])
		}
	}
	if c, _ := Load(); c.Update.Enabled() {
		t.Fatal("ldflags'siz test derlemesinde güncelleyici kapalı olmalı")
	}
}
