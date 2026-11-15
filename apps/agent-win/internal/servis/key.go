package servis

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Cihaz anahtarı (mimari-p27 §5.3 r2 m.e): kurulum (yönetici bağlamı) Ed25519 tohumunu DPAPI **makine** kapsamıyla
// `device.key.tmp`'ye yazar; servis ilk açılışta SYSTEM **kullanıcı** kapsamıyla yeniden mühürleyip `device.key`'e
// yazar ve geçiciyi siler — bundan sonra anahtarı yalnız SYSTEM çözebilir. Dosyada yalnız 32 baytlık tohum mühürlü
// durur; açık metin kullanımdan sonra sıfırlanır.
const (
	KeyFile    = "device.key"
	KeyTmpFile = "device.key.tmp"
)

// Protector DPAPI soyutlaması (Windows: CryptProtectData; testte sahte).
type Protector interface {
	Protect(plain []byte) ([]byte, error)
	Unprotect(sealed []byte) ([]byte, error)
}

// KeyFiles korumalı klasördeki dosya işlemleri (Windows: reparse denetimli handle'lar, diag.Dir). Create yalnız yeni
// dosya oluşturur (varsa os.ErrExist); Read yoksa os.ErrNotExist.
type KeyFiles interface {
	Read(name string) ([]byte, error)
	Create(name string, data []byte) error
	Remove(name string) error
}

// ErrNoKey cihaz anahtarı yok (kurulmamış ya da klasör silinmiş).
var ErrNoKey = errors.New("servis: cihaz anahtarı yok")

// GenerateKey yeni Ed25519 anahtar çifti.
func GenerateKey() (ed25519.PublicKey, ed25519.PrivateKey, error) {
	return ed25519.GenerateKey(rand.Reader)
}

// PublicKeyB64 kayıt isteğindeki `publicKey` (b64url, 32 bayt).
func PublicKeyB64(pub ed25519.PublicKey) string {
	return base64.RawURLEncoding.EncodeToString(pub)
}

// WriteInstallKey kurulum adımı: tohumu makine kapsamıyla mühürleyip `device.key.tmp`'ye yalnız yeni dosya olarak yazar.
func WriteInstallKey(files KeyFiles, machine Protector, priv ed25519.PrivateKey) error {
	seed := append([]byte(nil), priv.Seed()...)
	defer clear(seed)
	sealed, err := machine.Protect(seed)
	if err != nil {
		return fmt.Errorf("servis: anahtar mühürlenemedi: %w", err)
	}
	return files.Create(KeyTmpFile, sealed)
}

// LoadKey servis açılışı: varsa geçici anahtarı SYSTEM kapsamına taşır, sonra `device.key`'i çözer.
func LoadKey(files KeyFiles, machine, user Protector) (ed25519.PrivateKey, error) {
	if err := promoteKey(files, machine, user); err != nil {
		return nil, err
	}
	sealed, err := files.Read(KeyFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNoKey
	}
	if err != nil {
		return nil, err
	}
	seed, err := user.Unprotect(sealed)
	if err != nil {
		return nil, fmt.Errorf("servis: anahtar çözülemedi: %w", err)
	}
	defer clear(seed)
	return keyFromSeed(seed)
}

// promoteKey `device.key.tmp` → `device.key` (yeniden mühürleme). Önceki açılış anahtarı yazıp geçiciyi silemeden
// kesildiyse (`device.key` var) geçici yalnız silinir.
func promoteKey(files KeyFiles, machine, user Protector) error {
	tmp, err := files.Read(KeyTmpFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	seed, err := machine.Unprotect(tmp)
	if err != nil {
		return fmt.Errorf("servis: geçici anahtar çözülemedi: %w", err)
	}
	defer clear(seed)
	if _, err := keyFromSeed(seed); err != nil {
		return err
	}
	sealed, err := user.Protect(seed)
	if err != nil {
		return fmt.Errorf("servis: anahtar yeniden mühürlenemedi: %w", err)
	}
	if err := files.Create(KeyFile, sealed); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	return files.Remove(KeyTmpFile)
}

func keyFromSeed(seed []byte) (ed25519.PrivateKey, error) {
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("servis: anahtar biçimi geçersiz")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// authPrefix `device.auth` imza alan ayırıcısı (§4.4).
const authPrefix = "rs-device-auth-v1\n"

// AuthPayload imzalanan dize: "rs-device-auth-v1\n" + nonce + "\n" + deviceId + "\n" + origin.
func AuthPayload(nonce, deviceID, origin string) []byte {
	return []byte(authPrefix + nonce + "\n" + deviceID + "\n" + origin)
}

// SignAuth meydan okumayı imzalar; `sig` b64url (dolgusuz).
func SignAuth(priv ed25519.PrivateKey, nonce, deviceID, origin string) string {
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, AuthPayload(nonce, deviceID, origin)))
}

// Origin sunucunun tarayıcı köken biçimi (`new URL(PUBLIC_BASE_URL).origin`): şema + küçük harf host, varsayılan
// 443 portu yazılmaz.
func Origin(u *url.URL) string {
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if p := u.Port(); p != "" && p != "443" {
		host += ":" + p
	}
	return "https://" + host
}
