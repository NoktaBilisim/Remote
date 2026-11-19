package update

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fixtureDir ortak kanonik manifest fikstürleri (S-P29-T-11, mimari-p29 §14.6): K2 `build.ts` üretir, iki dil aynı baytları
// aynı sonuçla değerlendirir. Dosyalar ham bayttır; bu test onları değiştirmez.
const fixtureDir = "../../../../packages/contracts/test/fixtures/update-manifest"

type fixtureIndex struct {
	Context string `json:"context"`
	Keys    map[string]struct {
		Label     string `json:"label"`
		PublicKey string `json:"publicKey"`
	} `json:"keys"`
	Cases []struct {
		File   string  `json:"file"`
		Doc    string  `json:"doc"`
		Go     string  `json:"go"`
		Reason *string `json:"reason"`
	} `json:"cases"`
	Signatures []struct {
		Manifest string `json:"manifest"`
		Sig      string `json:"sig"`
		Valid    bool   `json:"valid"`
		Doc      string `json:"doc"`
	} `json:"signatures"`
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixtureDir, name))
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return b
}

func loadFixtureIndex(t *testing.T) fixtureIndex {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixtureDir, "cases.json"))
	if err != nil { // atlanmaz: yol bozulursa §14.6 eşlik denetimi sessizce kaybolmasın
		t.Fatal(err)
	}
	var idx fixtureIndex
	if err := json.Unmarshal(b, &idx); err != nil {
		t.Fatal(err)
	}
	if idx.Context != SignatureContext || len(idx.Cases) == 0 || len(idx.Signatures) == 0 {
		t.Fatalf("fikstür dizini beklenmedik: bağlam %q, %d vaka", idx.Context, len(idx.Cases))
	}
	return idx
}

// fixtureTrust test1 anahtarı: Go'da etiketten türetilen açık anahtar TS'in yazdığıyla aynı olmalı (iki dil aynı Ed25519).
func fixtureTrust(t *testing.T, idx fixtureIndex, env string) Trust {
	t.Helper()
	k := idx.Keys["test1"]
	seed := sha256.Sum256([]byte(k.Label))
	derived := EncodePublicKey(ed25519.NewKeyFromSeed(seed[:]).Public().(ed25519.PublicKey))
	if !strings.Contains(k.Label, "TEST") || derived != k.PublicKey {
		t.Fatalf("test1 açık anahtarı uyuşmuyor: %s / %s", derived, k.PublicKey)
	}
	tr, err := ParseTrust(env, k.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return tr
}

// AC-474 / S-P29-T-11: ParseManifest ve Verify her ortak fikstürde cases.json'daki `go` ve `reason` beklentisini verir.
func TestAC474SharedCanonicalFixtures(t *testing.T) {
	idx := loadFixtureIndex(t)
	for _, c := range idx.Cases {
		raw := readFixture(t, c.File)
		m, err := ParseManifest(raw)
		if got := map[bool]string{true: "ok", false: "reject"}[err == nil]; got != c.Go {
			t.Errorf("%s (%s): ParseManifest %s, beklenen %s (%v)", c.File, c.Doc, got, c.Go, err)
			continue
		}
		// Dizin kuralı: trust env = manifest env, çalışan 0.22.0 + manifestin kimliği, now = issuedAt + 1 sa. Ayrıştırılamayan
		// fikstürler prod/windows/client tabanından türetilmiştir.
		env, run, now := EnvProd, Running{Platform: PlatformWindows, Arch: ArchAMD64, Component: ComponentClient},
			time.Date(2026, 11, 19, 1, 0, 0, 0, time.UTC)
		if err == nil {
			env, run, now = m.Env, Running{Platform: m.Platform, Arch: m.Arch, Component: m.Component}, m.IssuedAt.Add(time.Hour)
		}
		run.Version = Version{0, 22, 0}
		sig, derr := DecodeSignature(string(readFixture(t, strings.TrimSuffix(c.File, ".json")+".sig")))
		if derr != nil {
			t.Fatalf("%s: %v", c.File, derr)
		}
		r := Verify(fixtureTrust(t, idx, env), raw, sig, run, Version{}, now)
		switch {
		case c.Reason == nil && r.Outcome != OutcomeAccept:
			t.Errorf("%s: Verify kabul beklenirdi, %+v", c.File, r)
		case c.Reason != nil && (r.Outcome != OutcomeRejected || string(r.Reason) != *c.Reason):
			t.Errorf("%s: Verify %s beklenirdi, %v/%s", c.File, *c.Reason, r.Outcome, r.Reason)
		}
	}
	// Prod güveniyle staging manifesti: imza geçerli (aynı test anahtarı) ama ENV_MISMATCH.
	raw := readFixture(t, "valid-client-linux-staging.json")
	sig, _ := DecodeSignature(string(readFixture(t, "valid-client-linux-staging.sig")))
	m, _ := ParseManifest(raw)
	r := Verify(fixtureTrust(t, idx, EnvProd), raw, sig, Running{Platform: PlatformLinux, Arch: ArchAMD64,
		Component: ComponentClient, Version: Version{0, 22, 0}}, Version{}, m.IssuedAt.Add(time.Hour))
	if r.Reason != ReasonEnvMismatch {
		t.Fatalf("staging manifesti prod güveniyle: %+v", r)
	}
}

// AC-474: ortak imza fikstürleri (yanlış anahtar, bağlamsız imza, başka manifestin imzası).
func TestAC474SharedSignatureFixtures(t *testing.T) {
	idx := loadFixtureIndex(t)
	tr := fixtureTrust(t, idx, EnvProd)
	for _, s := range idx.Signatures {
		sig, err := DecodeSignature(string(readFixture(t, s.Sig)))
		if err != nil {
			t.Fatalf("%s: %v", s.Sig, err)
		}
		if got := tr.VerifySignature(readFixture(t, s.Manifest), sig); got != s.Valid {
			t.Errorf("%s + %s (%s): geçerli=%v, beklenen %v", s.Manifest, s.Sig, s.Doc, got, s.Valid)
		}
	}
}
