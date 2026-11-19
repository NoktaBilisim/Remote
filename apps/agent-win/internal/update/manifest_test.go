package update

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"
)

const canonicalBase = `{"schema":1,"env":"prod","platform":"windows","arch":"amd64","component":"client","version":"0.22.1",` +
	`"sha256":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","size":4,` +
	`"issuedAt":"2026-11-19T12:00:00Z","expiresAt":"2026-12-19T12:00:00Z","minUpdaterVersion":"0.22.0"}`

func TestAC470CanonicalMatchesFixedBytes(t *testing.T) {
	m := baseManifest()
	if got := string(m.Canonical()); got != canonicalBase {
		t.Fatalf("kanonik bayt farklı:\n%s\n%s", got, canonicalBase)
	}
	p, err := ParseManifest([]byte(canonicalBase))
	if err != nil {
		t.Fatal(err)
	}
	if p != m {
		t.Fatalf("gidiş-dönüş farklı: %+v", p)
	}
	if m.FileName() != "update-client-windows-amd64.json" {
		t.Fatal(m.FileName())
	}
}

// S-P29-T-11 (§14.6): kanonik olmayan her biçim reddedilir — doğrulayıcı bunu MANIFEST_SIGNATURE sayar.
func TestAC474ParseRejectsNonCanonical(t *testing.T) {
	r := strings.NewReplacer
	cases := map[string]string{
		"BOM":                  "\xef\xbb\xbf" + canonicalBase,
		"sonda yeni satır":     canonicalBase + "\n",
		"sonda veri":           canonicalBase + "{}",
		"sonda boşluk":         canonicalBase + " ",
		"iki nokta boşluğu":    r(`"schema":1`, `"schema": 1`).Replace(canonicalBase),
		"başta boşluk":         " " + canonicalBase,
		"sıra farkı":           r(`"env":"prod","platform":"windows"`, `"platform":"windows","env":"prod"`).Replace(canonicalBase),
		"Sha256 harf farkı":    r(`"sha256"`, `"Sha256"`).Replace(canonicalBase),
		"yinelenen anahtar":    r(`"env":"prod",`, `"env":"prod","env":"prod",`).Replace(canonicalBase),
		"fazla anahtar":        strings.TrimSuffix(canonicalBase, "}") + `,"url":"https://x"}`,
		"eksik anahtar":        r(`,"minUpdaterVersion":"0.22.0"`, ``).Replace(canonicalBase),
		"schema 2":             r(`"schema":1`, `"schema":2`).Replace(canonicalBase),
		"schema dizgi":         r(`"schema":1`, `"schema":"1"`).Replace(canonicalBase),
		"size baştaki sıfır":   r(`"size":4`, `"size":04`).Replace(canonicalBase),
		"size üs":              r(`"size":4`, `"size":4e0`).Replace(canonicalBase),
		"size ondalık":         r(`"size":4`, `"size":4.0`).Replace(canonicalBase),
		"size negatif":         r(`"size":4`, `"size":-4`).Replace(canonicalBase),
		"size sıfır":           r(`"size":4`, `"size":0`).Replace(canonicalBase),
		"size 100 MiB üstü":    r(`"size":4`, `"size":104857601`).Replace(canonicalBase),
		"kaçışlı dizgi":        r(`"env":"prod"`, `"env":"pro`+string(rune(92))+`u0064"`).Replace(canonicalBase),
		"kesirli saniye":       r(`2026-11-19T12:00:00Z`, `2026-11-19T12:00:00.000Z`).Replace(canonicalBase),
		"ofsetli zaman":        r(`2026-11-19T12:00:00Z`, `2026-11-19T15:00:00+03:00`).Replace(canonicalBase),
		"büyük hex":            r(`9f86d081`, `9F86D081`).Replace(canonicalBase),
		"sürüm deseni":         r(`"version":"0.22.1"`, `"version":"0.22.1-rc1"`).Replace(canonicalBase),
		"sürüm 4 hane":         r(`"version":"0.22.1"`, `"version":"0.2222.1"`).Replace(canonicalBase),
		"env bilinmeyen":       r(`"env":"prod"`, `"env":"dev"`).Replace(canonicalBase),
		"platform bilinmeyen":  r(`"platform":"windows"`, `"platform":"darwin"`).Replace(canonicalBase),
		"süre 90 günden uzun":  r(`2026-12-19T12:00:00Z`, `2027-02-18T12:00:01Z`).Replace(canonicalBase),
		"expiresAt ≤ issuedAt": r(`2026-12-19T12:00:00Z`, `2026-11-19T12:00:00Z`).Replace(canonicalBase),
		"macos amd64":          r(`"platform":"windows"`, `"platform":"macos"`).Replace(canonicalBase),
		"linux servis":         r(`"platform":"windows","arch":"amd64","component":"client"`, `"platform":"linux","arch":"amd64","component":"service"`).Replace(canonicalBase),
		"null değer":           r(`"arch":"amd64"`, `"arch":null`).Replace(canonicalBase),
		"dizi":                 "[" + canonicalBase + "]",
		"boş":                  "",
		"sekme":                r(`,"env"`, ",\t\"env\"").Replace(canonicalBase),
		"ASCII dışı":           r(`"env":"prod"`, `"env":"prödd"`).Replace(canonicalBase),
	}
	for name, in := range cases {
		if _, err := ParseManifest([]byte(in)); !errors.Is(err, ErrManifest) {
			t.Errorf("%s: ErrManifest beklenirdi, alınan %v", name, err)
		}
	}
	big := strings.Repeat(" ", MaxManifestBytes+1)
	if _, err := ParseManifest([]byte(big)); !errors.Is(err, ErrManifest) {
		t.Fatal("2 KiB üstü kabul edildi")
	}
}

func TestAC470ParseAcceptsServiceAt90Days(t *testing.T) {
	m := baseManifest()
	m.Component = ComponentService
	m.ExpiresAt = m.IssuedAt.Add(90 * 24 * time.Hour)
	if _, err := ParseManifest(m.Canonical()); err != nil {
		t.Fatal(err)
	}
	// Sürüm deseni baştaki sıfırı kabul eder (DEVICE_VERSION_PATTERN); ham dizgi korunur.
	m.Version = "0.022.001"
	p, err := ParseManifest(m.Canonical())
	if err != nil || p.Version != "0.022.001" || !bytes.Equal(p.Canonical(), m.Canonical()) {
		t.Fatalf("baştaki sıfırlı sürüm: %v", err)
	}
}

func TestK_P29_4VersionCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.22.0", "0.22.0", 0}, {"0.22.1", "0.22.0", 1}, {"0.9.0", "0.10.0", -1}, {"1.0.0", "0.99.99", 1},
		{"0.022.0", "0.22.0", 0}, {"999.999.999", "0.0.0", 1},
	}
	for _, c := range cases {
		if got := mustVersion(t, c.a).Compare(mustVersion(t, c.b)); got != c.want {
			t.Errorf("%s ? %s = %d, beklenen %d", c.a, c.b, got, c.want)
		}
	}
	for _, bad := range []string{"", "1", "1.2", "1.2.3.4", "1.2.x", "1..2", "1.2.3-rc", "1000.0.0", " 1.2.3", "+1.2.3", "-1.2.3"} {
		if _, err := ParseVersion(bad); err == nil {
			t.Errorf("%q kabul edilmemeliydi", bad)
		}
	}
	if (Version{0, 22, 1}).String() != "0.22.1" {
		t.Fatal("String")
	}
}

func TestAC489ReasonClasses(t *testing.T) {
	security := map[Reason]bool{ReasonManifestSignature: true, ReasonPlatformSignature: true, ReasonDowngrade: true,
		ReasonHashMismatch: true, ReasonEnvMismatch: true}
	for _, r := range append(append([]Reason{}, FailReasons...), SkipReasons...) {
		if r.Security() != security[r] {
			t.Errorf("%s güvenlik sınıfı yanlış", r)
		}
	}
	if ReasonExpired.Security() {
		t.Fatal("EXPIRED güvenlik nedeni değil (§14)")
	}
	for _, r := range SkipReasons {
		if !r.Skip() {
			t.Errorf("%s skip olmalı", r)
		}
	}
	for _, r := range FailReasons {
		if r.Skip() {
			t.Errorf("%s skip olmamalı", r)
		}
	}
}
