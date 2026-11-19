package update

import (
	"crypto/ed25519"
	"errors"
	"strings"
	"testing"
	"time"
)

func signed(key string, m Manifest) ([]byte, []byte) {
	raw := m.Canonical()
	return raw, testSign(key, raw)
}

func TestAC474VerifyAcceptsValidWithEitherSlot(t *testing.T) {
	for _, key := range []string{"prod-active", "prod-backup"} {
		raw, sig := signed(key, baseManifest())
		r := Verify(prodTrust(), raw, sig, windowsClient(t, "0.22.0"), Version{}, testNow)
		if r.Outcome != OutcomeAccept || r.Reason != "" || r.Manifest.Version != "0.22.1" {
			t.Fatalf("%s: %+v", key, r)
		}
		if r.MaxSeen != (Version{0, 22, 1}) {
			t.Fatalf("maxSeen yükselmedi: %v", r.MaxSeen)
		}
	}
}

// AC-474: her koşul için ayrı negatif vaka; hiçbiri OutcomeAccept değildir (kurulum sayacı 0 — kurulum yalnız Accept'te başlar).
func TestAC474VerifyNegativeCases(t *testing.T) {
	type tc struct {
		name    string
		raw     []byte
		sig     []byte
		run     Running
		maxSeen Version
		now     time.Time
		outcome Outcome
		reason  Reason
	}
	run := windowsClient(t, "0.22.0")
	m := baseManifest()
	raw, sig := signed("prod-active", m)
	tampered := []byte(strings.Replace(string(raw), `"size":4`, `"size":5`, 1))
	foreign, foreignSig := signed("attacker", m)
	nonCanon := []byte(strings.Replace(string(raw), `"schema":1`, `"schema": 1`, 1))
	expired := m
	expired.ExpiresAt = testNow.Add(-time.Second)
	expired.IssuedAt = expired.ExpiresAt.Add(-10 * 24 * time.Hour)
	tooLong := m
	tooLong.ExpiresAt = m.IssuedAt.Add(31 * 24 * time.Hour)
	older := m
	older.Version = "0.21.9"
	future := m
	future.IssuedAt = testNow.Add(25 * time.Hour)
	future.ExpiresAt = future.IssuedAt.Add(24 * time.Hour)
	mac := m
	mac.Platform, mac.Arch = PlatformMacOS, ArchUniversal
	svc := m
	svc.Component = ComponentService
	same := m
	same.Version = "0.22.0"
	needNew := m
	needNew.MinUpdaterVersion = "0.22.1"
	badSig := append([]byte{}, sig...)
	badSig[0] ^= 1
	sign := func(x Manifest) []byte { _, s := signed("prod-active", x); return s }

	cases := []tc{
		{"imza başka anahtar", foreign, foreignSig, run, Version{}, testNow, OutcomeRejected, ReasonManifestSignature},
		{"imza bozuk", raw, badSig, run, Version{}, testNow, OutcomeRejected, ReasonManifestSignature},
		{"imza kısa", raw, sig[:63], run, Version{}, testNow, OutcomeRejected, ReasonManifestSignature},
		{"manifest değiştirilmiş", tampered, sig, run, Version{}, testNow, OutcomeRejected, ReasonManifestSignature},
		{"imzalı ama kanonik değil", nonCanon, testSign("prod-active", nonCanon), run, Version{}, testNow, OutcomeRejected, ReasonManifestSignature},
		{"süresi dolmuş", expired.Canonical(), sign(expired), run, Version{}, testNow, OutcomeRejected, ReasonExpired},
		{"istemci 30 g üstü", tooLong.Canonical(), sign(tooLong), run, Version{}, testNow, OutcomeRejected, ReasonExpired},
		{"eski sürüm (çalışandan düşük) sessiz", older.Canonical(), sign(older), run, Version{}, testNow, OutcomeNone, ""},
		{"ileri tarih 24 sa+", future.Canonical(), sign(future), run, Version{}, testNow, OutcomeNone, ""},
		{"platform farklı", mac.Canonical(), sign(mac), run, Version{}, testNow, OutcomeNone, ""},
		{"component farklı", svc.Canonical(), sign(svc), run, Version{}, testNow, OutcomeNone, ""},
		{"eşit sürüm = güncel", same.Canonical(), sign(same), run, Version{}, testNow, OutcomeNone, ""},
		{"minUpdaterVersion", needNew.Canonical(), sign(needNew), run, Version{}, testNow, OutcomeManualOnly, ReasonManualOnly},
	}
	for _, c := range cases {
		r := Verify(prodTrust(), c.raw, c.sig, c.run, c.maxSeen, c.now)
		if r.Outcome != c.outcome || r.Reason != c.reason {
			t.Errorf("%s: sonuç %v/%q, beklenen %v/%q", c.name, r.Outcome, r.Reason, c.outcome, c.reason)
		}
		if r.Outcome == OutcomeAccept {
			t.Errorf("%s: kurulum başlamamalı", c.name)
		}
	}
	// minUpdaterVersion dalında da maxSeen yükselir (adım 6 geçti).
	r := Verify(prodTrust(), needNew.Canonical(), sign(needNew), run, Version{}, testNow)
	if r.MaxSeen != (Version{0, 22, 1}) {
		t.Fatalf("MANUAL_ONLY maxSeen: %v", r.MaxSeen)
	}
	// Ret dalında maxSeen değişmez (süresi dolmuş manifest).
	r = Verify(prodTrust(), expired.Canonical(), sign(expired), run, Version{0, 1, 0}, testNow)
	if r.MaxSeen != (Version{0, 1, 0}) {
		t.Fatalf("ret maxSeen değiştirdi: %v", r.MaxSeen)
	}
}

func TestAC474ServiceValidity90Days(t *testing.T) {
	m := baseManifest()
	m.Component = ComponentService
	m.ExpiresAt = m.IssuedAt.Add(90 * 24 * time.Hour)
	raw, sig := signed("prod-active", m)
	run := Running{Platform: PlatformWindows, Arch: ArchAMD64, Component: ComponentService, Version: Version{0, 22, 0}}
	if r := Verify(prodTrust(), raw, sig, run, Version{}, testNow); r.Outcome != OutcomeAccept {
		t.Fatalf("servis 90 g: %+v", r)
	}
	// Sınır: now == expiresAt geçerli, bir saniye sonra EXPIRED.
	if r := Verify(prodTrust(), raw, sig, run, Version{}, m.ExpiresAt); r.Outcome != OutcomeAccept {
		t.Fatalf("expiresAt anı: %+v", r)
	}
	if r := Verify(prodTrust(), raw, sig, run, Version{}, m.ExpiresAt.Add(time.Second)); r.Reason != ReasonExpired {
		t.Fatalf("expiresAt+1 sn: %+v", r)
	}
	// Tam 24 sa ileri tarih hâlâ kabul (saat kayması payı), 24 sa + 1 sn "yayın yok".
	f := baseManifest()
	f.IssuedAt = testNow.Add(24 * time.Hour)
	f.ExpiresAt = f.IssuedAt.Add(time.Hour)
	raw, sig = signed("prod-active", f)
	if r := Verify(prodTrust(), raw, sig, windowsClient(t, "0.22.0"), Version{}, testNow); r.Outcome != OutcomeAccept {
		t.Fatalf("24 sa ileri: %+v", r)
	}
	if r := Verify(prodTrust(), raw, sig, windowsClient(t, "0.22.0"), Version{}, testNow.Add(-time.Second)); r.Outcome != OutcomeNone {
		t.Fatalf("24 sa + 1 sn ileri: %+v", r)
	}
}

// AC-472: prod istemci staging manifestini reddeder, tersi de; aynı ortam kabul (4 kombinasyon).
func TestAC472EnvCombinations(t *testing.T) {
	trusts := map[string]Trust{EnvProd: prodTrust(), EnvStaging: stagingTrust()}
	for _, clientEnv := range []string{EnvProd, EnvStaging} {
		for _, manEnv := range []string{EnvProd, EnvStaging} {
			m := baseManifest()
			m.Env = manEnv
			raw, sig := signed(manEnv+"-active", m)
			r := Verify(trusts[clientEnv], raw, sig, windowsClient(t, "0.22.0"), Version{}, testNow)
			switch {
			case clientEnv == manEnv && r.Outcome != OutcomeAccept:
				t.Errorf("%s istemci %s manifest: kabul beklenirdi, %+v", clientEnv, manEnv, r)
			case clientEnv != manEnv && (r.Outcome != OutcomeRejected || r.Reason != ReasonManifestSignature):
				// Ortama özel anahtar: imza zaten tutmaz.
				t.Errorf("%s istemci %s manifest: MANIFEST_SIGNATURE beklenirdi, %+v", clientEnv, manEnv, r)
			}
		}
	}
	// Anahtar sızsa bile (staging anahtarıyla imzalanmış prod-dışı env): env alanı ayrıca ENV_MISMATCH.
	m := baseManifest()
	m.Env = EnvStaging
	raw, sig := signed("prod-active", m)
	if r := Verify(prodTrust(), raw, sig, windowsClient(t, "0.22.0"), Version{}, testNow); r.Reason != ReasonEnvMismatch {
		t.Fatalf("env alanı denetlenmedi: %+v", r)
	}
	// Tersi: staging güveni + staging anahtarıyla imzalı env=prod manifest.
	m.Env = EnvProd
	raw, sig = signed("staging-active", m)
	if r := Verify(stagingTrust(), raw, sig, windowsClient(t, "0.22.0"), Version{}, testNow); r.Reason != ReasonEnvMismatch {
		t.Fatalf("staging güveninde env=prod: %+v", r)
	}
}

// AC-475: 0.23.0 görülmüşken 0.22.5 manifesti (süresi dolmamış, geçerli imzalı) → DOWNGRADE.
func TestAC475ReplayBelowMaxSeen(t *testing.T) {
	run := windowsClient(t, "0.22.0")
	newer := baseManifest()
	newer.Version = "0.23.0"
	raw, sig := signed("prod-active", newer)
	r := Verify(prodTrust(), raw, sig, run, Version{}, testNow)
	if r.Outcome != OutcomeAccept || r.MaxSeen != (Version{0, 23, 0}) {
		t.Fatalf("0.23.0: %+v", r)
	}
	old := baseManifest()
	old.Version = "0.22.5"
	raw, sig = signed("prod-active", old)
	r2 := Verify(prodTrust(), raw, sig, run, r.MaxSeen, testNow)
	if r2.Outcome != OutcomeRejected || r2.Reason != ReasonDowngrade || r2.MaxSeen != r.MaxSeen {
		t.Fatalf("replay: %+v", r2)
	}
	// Aynı (maxSeen'e eşit) sürüm yeniden görülürse kabul (indirme yarıda kaldıysa tekrar denenir).
	raw, sig = signed("prod-active", newer)
	if r3 := Verify(prodTrust(), raw, sig, run, r.MaxSeen, testNow); r3.Outcome != OutcomeAccept {
		t.Fatalf("maxSeen eşit: %+v", r3)
	}
	// Orkestratör kararı: v ≤ çalışan her zaman sessiz (maxSeen'den bağımsız); olay/alarm yok.
	for _, v := range []string{"0.22.0", "0.21.0"} {
		low := baseManifest()
		low.Version = v
		raw, sig = signed("prod-active", low)
		if r4 := Verify(prodTrust(), raw, sig, run, r.MaxSeen, testNow); r4.Outcome != OutcomeNone || r4.Reason != "" {
			t.Fatalf("%s ≤ çalışan: %+v", v, r4)
		}
	}
}

// AC-472 / K-P29-1: anahtar gömülmemiş (PR/yer tutucu) ya da bozuk → güncelleyici kapalı, olay yok.
func TestAC472DisabledWithoutKeys(t *testing.T) {
	raw, sig := signed("prod-active", baseManifest())
	for name, tr := range map[string]Trust{
		"sıfır":          {},
		"env yok":        {Keys: []ed25519.PublicKey{testPub("prod-active")}},
		"anahtar yok":    {Env: EnvProd},
		"üç anahtar":     {Env: EnvProd, Keys: []ed25519.PublicKey{testPub("a"), testPub("b"), testPub("prod-active")}},
		"kısa anahtar":   {Env: EnvProd, Keys: []ed25519.PublicKey{testPub("prod-active")[:31]}},
		"bilinmeyen env": {Env: "dev", Keys: []ed25519.PublicKey{testPub("prod-active")}},
	} {
		if r := Verify(tr, raw, sig, windowsClient(t, "0.22.0"), Version{}, testNow); r.Outcome != OutcomeDisabled || r.Reason != "" {
			t.Errorf("%s: %+v", name, r)
		}
	}
}

func TestAC472ParseTrust(t *testing.T) {
	a, b := EncodePublicKey(testPub("prod-active")), EncodePublicKey(testPub("prod-backup"))
	tr, err := ParseTrust(EnvProd, a+","+b)
	if err != nil || !tr.Enabled() || len(tr.Keys) != 2 || tr.Env != EnvProd {
		t.Fatalf("iki yuva: %v %+v", err, tr)
	}
	if tr, err := ParseTrust(EnvStaging, a); err != nil || !tr.Enabled() {
		t.Fatalf("tek yuva: %v", err)
	}
	if tr, err := ParseTrust("", ""); err != nil || tr.Enabled() {
		t.Fatalf("boş derleme kapalı ve hatasız olmalı: %v", err)
	}
	bad := [][2]string{
		{"", a}, {EnvProd, ""}, {"dev", a}, {EnvProd, a + "," + b + "," + a}, {EnvProd, a + ","}, {EnvProd, a + "="},
		{EnvProd, "+" + a[1:]}, {EnvProd, a[:42]}, {EnvProd, " " + a}, {"PROD", a},
	}
	for _, c := range bad {
		if tr, err := ParseTrust(c[0], c[1]); !errors.Is(err, ErrTrust) || tr.Enabled() {
			t.Errorf("%q/%q kabul edilmemeliydi", c[0], c[1])
		}
	}
}

func TestAC474SignatureEncoding(t *testing.T) {
	raw, sig := signed("prod-active", baseManifest())
	s := EncodeSignature(sig)
	if len(s) != SignatureB64Len {
		t.Fatalf("uzunluk %d", len(s))
	}
	got, err := DecodeSignature(s)
	if err != nil || !prodTrust().VerifySignature(raw, got) {
		t.Fatalf("gidiş-dönüş: %v", err)
	}
	for _, bad := range []string{"", s[:85], s + "A", s + "=", strings.Replace(s, s[:1], "+", 1), s[:85] + "\n"} {
		if _, err := DecodeSignature(bad); err == nil {
			t.Errorf("%q kabul edilmemeliydi", bad)
		}
	}
}

func TestRunningIdentity(t *testing.T) {
	for goos, want := range map[string][2]string{"windows": {PlatformWindows, ArchAMD64}, "darwin": {PlatformMacOS, ArchUniversal},
		"linux": {PlatformLinux, ArchAMD64}, "plan9": {"", ""}} {
		p, a := RunningIdentity(goos)
		if p != want[0] || a != want[1] {
			t.Errorf("%s: %s/%s", goos, p, a)
		}
	}
}
