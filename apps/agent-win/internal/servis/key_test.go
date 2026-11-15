package servis

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/url"
	"os"
	"testing"
)

// fakeDPAPI kapsamı etiketleyen sahte mühür: başka kapsamın mührü çözülemez.
type fakeDPAPI struct{ scope byte }

func (f fakeDPAPI) Protect(p []byte) ([]byte, error) { return append([]byte{f.scope}, p...), nil }
func (f fakeDPAPI) Unprotect(s []byte) ([]byte, error) {
	if len(s) == 0 || s[0] != f.scope {
		return nil, errors.New("yanlış kapsam")
	}
	return append([]byte(nil), s[1:]...), nil
}

type memFiles map[string][]byte

func (m memFiles) Read(n string) ([]byte, error) {
	b, ok := m[n]
	if !ok {
		return nil, os.ErrNotExist
	}
	return b, nil
}
func (m memFiles) Create(n string, d []byte) error {
	if _, ok := m[n]; ok {
		return os.ErrExist
	}
	m[n] = append([]byte(nil), d...)
	return nil
}
func (m memFiles) Remove(n string) error { delete(m, n); return nil }

var machine, user = fakeDPAPI{'M'}, fakeDPAPI{'U'}

func TestAC340KeyPromotedToSystemScope(t *testing.T) {
	pub, priv, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	files := memFiles{}
	if err := WriteInstallKey(files, machine, priv); err != nil {
		t.Fatal(err)
	}
	if err := WriteInstallKey(files, machine, priv); !errors.Is(err, os.ErrExist) {
		t.Fatalf("geçici anahtar üzerine yazıldı: %v", err)
	}
	got, err := LoadKey(files, machine, user)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got.Public().(ed25519.PublicKey), pub) {
		t.Fatal("anahtar değişti")
	}
	if _, ok := files[KeyTmpFile]; ok {
		t.Fatal("geçici anahtar silinmedi")
	}
	if files[KeyFile][0] != 'U' {
		t.Fatal("anahtar SYSTEM (kullanıcı) kapsamıyla mühürlenmedi")
	}
	if _, err := (fakeDPAPI{'M'}).Unprotect(files[KeyFile]); err == nil {
		t.Fatal("makine kapsamıyla çözülebiliyor")
	}
}

func TestAC340KeyInterruptedPromotion(t *testing.T) {
	_, priv, _ := GenerateKey()
	files := memFiles{}
	_ = WriteInstallKey(files, machine, priv)
	sealed, _ := user.Protect(priv.Seed())
	files[KeyFile] = sealed // önceki açılış yazdı, geçiciyi silemeden kesildi
	if _, err := LoadKey(files, machine, user); err != nil {
		t.Fatal(err)
	}
	if _, ok := files[KeyTmpFile]; ok {
		t.Fatal("geçici kaldı")
	}
}

func TestKeyMissingAndCorrupt(t *testing.T) {
	if _, err := LoadKey(memFiles{}, machine, user); !errors.Is(err, ErrNoKey) {
		t.Fatalf("anahtar yokken %v", err)
	}
	if _, err := LoadKey(memFiles{KeyFile: []byte("Ukisa")}, machine, user); err == nil {
		t.Fatal("bozuk anahtar kabul edildi")
	}
}

func TestAC273SignAuthVerifies(t *testing.T) {
	pub, priv, _ := GenerateKey()
	nonce := "Tzvurhrfhd0k9x-ZN1JarzZap5Ix7vMOKvclD1Y-lUE"
	sig := SignAuth(priv, nonce, "01JD0000000000000000000001", "https://destek.example.com")
	raw, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !b64url64.MatchString(sig) {
		t.Fatalf("imza biçimi: %v", err)
	}
	if !ed25519.Verify(pub, AuthPayload(nonce, "01JD0000000000000000000001", "https://destek.example.com"), raw) {
		t.Fatal("imza doğrulanmadı")
	}
	if ed25519.Verify(pub, AuthPayload(nonce, "01JD0000000000000000000001", "https://baska.example.com"), raw) {
		t.Fatal("imza başka kökene bağlanabiliyor")
	}
	if !b64url32.MatchString(PublicKeyB64(pub)) {
		t.Fatal("publicKey b64url 32 bayt değil")
	}
}

func TestOrigin(t *testing.T) {
	for in, want := range map[string]string{
		"https://Destek.Example.com:443": "https://destek.example.com",
		"https://destek.example.com":     "https://destek.example.com",
		"https://192.0.2.10:4450":        "https://192.0.2.10:4450",
	} {
		u, _ := url.Parse(in)
		if got := Origin(u); got != want {
			t.Errorf("Origin(%s) = %s, beklenen %s", in, got, want)
		}
	}
}
