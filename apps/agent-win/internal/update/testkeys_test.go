package update

import (
	"crypto/ed25519"
	"crypto/sha256"
	"testing"
	"time"
)

// Deterministik TEST anahtarları (yalnız testte; gerçek anahtar repoda bulunmaz). Tohum = SHA-256("rs-update-test-key-<ad>").
func testKey(name string) ed25519.PrivateKey {
	seed := sha256.Sum256([]byte("rs-update-test-key-" + name))
	return ed25519.NewKeyFromSeed(seed[:])
}

func testPub(name string) ed25519.PublicKey { return testKey(name).Public().(ed25519.PublicKey) }

func testSign(name string, raw []byte) []byte { return ed25519.Sign(testKey(name), SignedMessage(raw)) }

var testNow = time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)

func mustVersion(t *testing.T, s string) Version {
	t.Helper()
	v, err := ParseVersion(s)
	if err != nil {
		t.Fatalf("%q: %v", s, err)
	}
	return v
}

// baseManifest geçerli bir prod/windows/client manifesti (çalışan 0.22.0'dan yeni).
func baseManifest() Manifest {
	return Manifest{Schema: 1, Env: EnvProd, Platform: PlatformWindows, Arch: ArchAMD64, Component: ComponentClient,
		Version: "0.22.1", SHA256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", Size: 4,
		IssuedAt: testNow.Add(-24 * time.Hour), ExpiresAt: testNow.Add(29 * 24 * time.Hour), MinUpdaterVersion: "0.22.0"}
}

func prodTrust() Trust {
	return Trust{Env: EnvProd, Keys: []ed25519.PublicKey{testPub("prod-active"), testPub("prod-backup")}}
}

func stagingTrust() Trust {
	return Trust{Env: EnvStaging, Keys: []ed25519.PublicKey{testPub("staging-active"), testPub("staging-backup")}}
}

func windowsClient(t *testing.T, v string) Running {
	return Running{Platform: PlatformWindows, Arch: ArchAMD64, Component: ComponentClient, Version: mustVersion(t, v)}
}
