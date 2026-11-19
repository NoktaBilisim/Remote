// Package update istemci otomatik güncellemesinin platformdan bağımsız çekirdeğidir (P29, ADR-0040, mimari-p29 §4.1, §5.1, §14).
// Manifest ayrıştırma (kanonik bayt), Ed25519 doğrulama (tek işlev Verify), sürüm karşılaştırma ve aynı-köken indirme burada.
//
// Paket YALNIZ Go standart kitaplığını içe aktarır: cmd/update-sign aynı paketi kullanır ve imza işinde GOPROXY=off ile,
// bağımlılık kapanışında yalnız stdlib olacak biçimde derlenir (§14.2). Platforma özgü kurulum dosyaları (install_*.go, K8)
// da bu kurala uymalıdır; x/sys veya başka iç paket gerekiyorsa ayrı pakete konur.
package update

// Reason olay neden kodu (`packages/contracts/src/api/update.ts` UPDATE_FAIL_REASONS + UPDATE_SKIP_REASONS ile birebir).
type Reason string

// Başarısızlık nedenleri (UPDATE_FAIL_REASONS).
const (
	ReasonDownload          Reason = "DOWNLOAD"
	ReasonHashMismatch      Reason = "HASH_MISMATCH"
	ReasonManifestSignature Reason = "MANIFEST_SIGNATURE"
	ReasonPlatformSignature Reason = "PLATFORM_SIGNATURE"
	ReasonDowngrade         Reason = "DOWNGRADE"
	ReasonExpired           Reason = "EXPIRED"
	ReasonEnvMismatch       Reason = "ENV_MISMATCH"
	ReasonInstall           Reason = "INSTALL"
	ReasonHealth            Reason = "HEALTH"
)

// Atlama nedenleri (UPDATE_SKIP_REASONS).
const (
	ReasonPolicyOff   Reason = "POLICY_OFF"
	ReasonNotWritable Reason = "NOT_WRITABLE"
	ReasonManualOnly  Reason = "MANUAL_ONLY"
)

// FailReasons / SkipReasons sözleşmedeki sırayla (fikstür ve sözleşme testleri için tek liste).
var (
	FailReasons = []Reason{ReasonDownload, ReasonHashMismatch, ReasonManifestSignature, ReasonPlatformSignature,
		ReasonDowngrade, ReasonExpired, ReasonEnvMismatch, ReasonInstall, ReasonHealth}
	SkipReasons = []Reason{ReasonPolicyOff, ReasonNotWritable, ReasonManualOnly}
)

// Security AC-489 güvenlik nedeni mi (UPDATE_SECURITY_REASONS). EXPIRED saat kaymasıyla da oluşur, güvenlik nedeni DEĞİL (§14).
func (r Reason) Security() bool {
	switch r {
	case ReasonManifestSignature, ReasonPlatformSignature, ReasonDowngrade, ReasonHashMismatch, ReasonEnvMismatch:
		return true
	}
	return false
}

// Skip neden `skipped` olayına mı aittir (aksi `failed`/`rolled_back`).
func (r Reason) Skip() bool {
	switch r {
	case ReasonPolicyOff, ReasonNotWritable, ReasonManualOnly:
		return true
	}
	return false
}
