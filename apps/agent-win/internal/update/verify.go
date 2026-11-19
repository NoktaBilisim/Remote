package update

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

// MaxKeys gömülü açık anahtar yuvası sayısı (etkin + yedek, K-P29-1).
const MaxKeys = 2

// SignatureB64Len `.sig` dosyası / `signature` alanı uzunluğu (64 bayt base64url dolgusuz).
const SignatureB64Len = 86

// futureSkew issuedAt bu kadar ileri tarihliyse manifest "yayın yok" sayılır (saat geri, §14 Diğer).
const futureSkew = 24 * time.Hour

// Trust derlemede gömülü güven kökü: ortam + en çok 2 Ed25519 açık anahtar. Sıfır değer = güncelleyici kapalı.
type Trust struct {
	Env  string
	Keys []ed25519.PublicKey
}

// ErrTrust gömülü anahtar/ortam bozuk; çağıran güncelleyiciyi tümüyle kapatır (fail-closed).
var ErrTrust = errors.New("update: gömülü güncelleme anahtarı geçersiz")

// ParseTrust ldflags değerlerini (`config.updateEnv`, `config.updateKeys` = "<b64url>[,<b64url>]") doğrular. İkisi de boşsa
// (PR/yer tutucu derleme) sıfır Trust ve nil döner. Biri bozuksa ErrTrust; çağıran yine sıfır Trust kullanır.
func ParseTrust(env, keys string) (Trust, error) {
	if env == "" && keys == "" {
		return Trust{}, nil
	}
	if env != EnvProd && env != EnvStaging {
		return Trust{}, ErrTrust
	}
	parts := strings.Split(keys, ",")
	if len(parts) < 1 || len(parts) > MaxKeys {
		return Trust{}, ErrTrust
	}
	t := Trust{Env: env}
	for _, p := range parts {
		k, err := ParsePublicKey(p)
		if err != nil {
			return Trust{}, ErrTrust
		}
		t.Keys = append(t.Keys, k)
	}
	return t, nil
}

// ParsePublicKey base64url (dolgusuz) 32 bayt Ed25519 açık anahtarı.
func ParsePublicKey(s string) (ed25519.PublicKey, error) {
	b, err := base64.RawURLEncoding.Strict().DecodeString(s)
	if err != nil || len(b) != ed25519.PublicKeySize {
		return nil, ErrTrust
	}
	return ed25519.PublicKey(b), nil
}

// EncodePublicKey ParsePublicKey'in tersi (`build/update-keys/<env>.pub` biçimi).
func EncodePublicKey(k ed25519.PublicKey) string { return base64.RawURLEncoding.EncodeToString(k) }

// Enabled güncelleyici açık mı: geçerli ortam ve 1..2 adet 32 baytlık anahtar.
func (t Trust) Enabled() bool {
	if (t.Env != EnvProd && t.Env != EnvStaging) || len(t.Keys) < 1 || len(t.Keys) > MaxKeys {
		return false
	}
	for _, k := range t.Keys {
		if len(k) != ed25519.PublicKeySize {
			return false
		}
	}
	return true
}

// ErrSignatureEncoding imza base64url 86 karakter değil.
var ErrSignatureEncoding = errors.New("update: imza 86 karakter base64url olmalı")

// DecodeSignature `.sig` / `signature` (base64url dolgusuz, 86 karakter) → 64 bayt.
func DecodeSignature(s string) ([]byte, error) {
	if len(s) != SignatureB64Len {
		return nil, ErrSignatureEncoding
	}
	b, err := base64.RawURLEncoding.Strict().DecodeString(s)
	if err != nil || len(b) != ed25519.SignatureSize {
		return nil, ErrSignatureEncoding
	}
	return b, nil
}

// EncodeSignature DecodeSignature'ın tersi.
func EncodeSignature(sig []byte) string { return base64.RawURLEncoding.EncodeToString(sig) }

// SignedMessage imzalanan bayt dizisi: SignatureContext ‖ manifest.
func SignedMessage(manifest []byte) []byte {
	msg := make([]byte, 0, len(SignatureContext)+len(manifest))
	msg = append(msg, SignatureContext...)
	return append(msg, manifest...)
}

// VerifySignature imza herhangi bir gömülü anahtarla geçerli mi (boyut sınırları dahil).
func (t Trust) VerifySignature(manifest, sig []byte) bool {
	if len(manifest) == 0 || len(manifest) > MaxManifestBytes || len(sig) != ed25519.SignatureSize {
		return false
	}
	msg := SignedMessage(manifest)
	for _, k := range t.Keys {
		if len(k) == ed25519.PublicKeySize && ed25519.Verify(k, msg, sig) {
			return true
		}
	}
	return false
}

// Running çalışan ikilinin kimliği; çağıran verir (macOS `macos`/`universal` — runtime.GOARCH'tan türetilmez).
type Running struct {
	Platform  string
	Arch      string
	Component string
	Version   Version
}

// Outcome Verify sonucu sınıfı.
type Outcome int

const (
	// OutcomeDisabled gömülü anahtar yok/bozuk: güncelleyici kapalı, olay yok (§5.1 adım 1).
	OutcomeDisabled Outcome = iota
	// OutcomeNone sessiz "yayın yok": platform/arch/component uyuşmazlığı, sürüm ≤ çalışan, ileri tarihli issuedAt. Olay yok.
	OutcomeNone
	// OutcomeRejected neden kodlu ret → `failed(Reason)` olayı (Reason.Security() ise güvenlik olayı, AC-489).
	OutcomeRejected
	// OutcomeManualOnly çalışan güncelleyici minUpdaterVersion'dan eski → `skipped(MANUAL_ONLY)` (K-P29-15).
	OutcomeManualOnly
	// OutcomeAccept manifest kabul: indirme + Download doğrulaması (§5.1 adım 8) sıradaki iştir.
	OutcomeAccept
)

// Result Verify çıktısı. Manifest yalnız ayrıştırma geçtiyse doludur. MaxSeen çağıranın kalıcı/bellekteki değeri için yeni
// değerdir (yalnız adım 6 geçince yükselir); diğer durumlarda girdi değeriyle aynıdır.
type Result struct {
	Outcome  Outcome
	Reason   Reason
	Manifest Manifest
	MaxSeen  Version
}

// Verify tek doğrulama işlevi (AC-474/475/472, mimari-p29 §5.1 adım 1–7 + §14). Saf işlevdir: saat ve maxSeen parametredir,
// G/Ç yapmaz. Sıra: anahtar → imza (ham bayt üzerinde, ayrıştırmadan önce) → kanonik ayrıştırma → env → kimlik eşleşmesi →
// ileri tarih → süre (component'e göre 30/90 g) → sürüm/maxSeen → minUpdaterVersion.
func Verify(t Trust, manifest, sig []byte, run Running, maxSeen Version, now time.Time) Result {
	r := Result{MaxSeen: maxSeen}
	if !t.Enabled() {
		r.Outcome = OutcomeDisabled
		return r
	}
	reject := func(reason Reason) Result {
		r.Outcome, r.Reason = OutcomeRejected, reason
		return r
	}
	if !t.VerifySignature(manifest, sig) {
		return reject(ReasonManifestSignature)
	}
	m, err := ParseManifest(manifest)
	if err != nil {
		return reject(ReasonManifestSignature)
	}
	r.Manifest = m
	if m.Env != t.Env {
		return reject(ReasonEnvMismatch)
	}
	if m.Platform != run.Platform || m.Arch != run.Arch || m.Component != run.Component {
		r.Outcome = OutcomeNone
		return r
	}
	if m.IssuedAt.After(now.Add(futureSkew)) {
		r.Outcome = OutcomeNone
		return r
	}
	if now.After(m.ExpiresAt) || m.ExpiresAt.Sub(m.IssuedAt) > MaxValidity(m.Component) {
		return reject(ReasonExpired)
	}
	v, _ := ParseVersion(m.Version) // Validate'ten geçti
	// Orkestratör kararı (mimari §5.1 adım 6'yı daraltır, 2026-11-19): v ≤ çalışan → sessiz "yayın yok" (eşit = güncel; düşük =
	// cihaz yayından önde ya da yayın geri çekildi), olay/alarm yok. Yalnız çalışan < v < maxSeen yeniden oynatmadır → DOWNGRADE.
	if v.Compare(run.Version) <= 0 {
		r.Outcome = OutcomeNone
		return r
	}
	if v.Compare(maxSeen) < 0 {
		return reject(ReasonDowngrade)
	}
	if v.Compare(r.MaxSeen) > 0 {
		r.MaxSeen = v
	}
	minUp, _ := ParseVersion(m.MinUpdaterVersion)
	if run.Version.Compare(minUp) < 0 {
		r.Outcome, r.Reason = OutcomeManualOnly, ReasonManualOnly
		return r
	}
	r.Outcome = OutcomeAccept
	return r
}

// RunningIdentity GOOS için manifest platform/arch adı (windows/linux amd64, macOS universal). Bilinmeyen GOOS → "" (eşleşme yok).
func RunningIdentity(goos string) (platform, arch string) {
	switch goos {
	case "windows":
		return PlatformWindows, ArchAMD64
	case "darwin":
		return PlatformMacOS, ArchUniversal
	case "linux":
		return PlatformLinux, ArchAMD64
	}
	return "", ""
}
