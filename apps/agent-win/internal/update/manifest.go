package update

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"time"
)

// Sabitler (`packages/contracts/src/api/update.ts` ile birebir; mimari-p29 §4.1, K-P29-3).
const (
	// SignatureContext imzalanan bayt = SignatureContext ‖ manifest ham baytları.
	SignatureContext = "rs-update-manifest-v1\n"
	// MaxManifestBytes manifest üst sınırı (2 KiB).
	MaxManifestBytes = 2048
	// MaxBinarySize manifest `size` üst sınırı (100 MiB).
	MaxBinarySize = 104857600
	// SchemaVersion desteklenen tek manifest şeması.
	SchemaVersion = 1
	// MaxValidityClient / MaxValidityService `expiresAt − issuedAt` üst sınırı (r2 S-P29-T-7). Ayrıştırıcı şemanın genel
	// sınırını (90 g) uygular; component'e özgü 30 g kuralı Verify'da EXPIRED'dır.
	MaxValidityClient  = 30 * 24 * time.Hour
	MaxValidityService = 90 * 24 * time.Hour
	// timeLayout kanonik zaman biçimi `YYYY-MM-DDTHH:MM:SSZ` (§14.6; kesirli saniye ve ofset yok).
	timeLayout = "2006-01-02T15:04:05Z"
)

// Enum değerleri (UPDATE_ENVS, UPDATE_PLATFORMS, UPDATE_ARCHES, UPDATE_COMPONENTS).
const (
	EnvProd    = "prod"
	EnvStaging = "staging"

	PlatformWindows = "windows"
	PlatformMacOS   = "macos"
	PlatformLinux   = "linux"

	ArchAMD64     = "amd64"
	ArchUniversal = "universal"

	ComponentClient  = "client"
	ComponentService = "service"
)

// Manifest ikili başına güncelleme manifesti (K-P29-2). Alan sırası kanonik sıradır (§14.6).
// Sürüm alanları ham dizgi olarak tutulur: kanonik serileştirme ham baytı birebir yeniden üretmelidir.
type Manifest struct {
	Schema            int
	Env               string
	Platform          string
	Arch              string
	Component         string
	Version           string
	SHA256            string
	Size              int64
	IssuedAt          time.Time
	ExpiresAt         time.Time
	MinUpdaterVersion string
}

// manifestKeys kanonik anahtar sırası (büyük/küçük harfe duyarlı, birebir).
var manifestKeys = [...]string{"schema", "env", "platform", "arch", "component", "version", "sha256", "size",
	"issuedAt", "expiresAt", "minUpdaterVersion"}

// ErrManifest manifest katı/kanonik ayrıştırmadan geçmedi (Verify bunu MANIFEST_SIGNATURE sayar: imzalı ama okunamayan
// manifest güvenilmezdir, §5.1 adım 3).
var ErrManifest = errors.New("update: manifest geçersiz")

func manifestErr(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrManifest, fmt.Sprintf(format, a...))
}

// ParseManifest kanonik manifesti ayrıştırır ve doğrular: yalnız ASCII 0x20–0x7E, sabit anahtar sırası, yinelenen/fazla/eksik
// anahtar yok, sonda veri yok, değerler şemaya uygun ve `Canonical(ayrıştır(b)) == b` (§14.6). İmza burada denetlenmez.
func ParseManifest(b []byte) (Manifest, error) {
	if len(b) == 0 || len(b) > MaxManifestBytes {
		return Manifest{}, manifestErr("boyut 1..%d bayt olmalı", MaxManifestBytes)
	}
	for _, c := range b {
		if c < 0x20 || c > 0x7e {
			return Manifest{}, manifestErr("yalnız yazdırılabilir ASCII")
		}
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return Manifest{}, manifestErr("nesne bekleniyor")
	}
	vals := make([]any, len(manifestKeys))
	for i, want := range manifestKeys {
		k, err := dec.Token()
		if err != nil {
			return Manifest{}, manifestErr("anahtar okunamadı")
		}
		if ks, ok := k.(string); !ok || ks != want {
			return Manifest{}, manifestErr("%d. anahtar %q olmalı", i+1, want)
		}
		v, err := dec.Token()
		if err != nil {
			return Manifest{}, manifestErr("%q değeri okunamadı", want)
		}
		vals[i] = v
	}
	if t, err := dec.Token(); err != nil || t != json.Delim('}') {
		return Manifest{}, manifestErr("fazla anahtar ya da nesne sonu yok")
	}
	if _, err := dec.Token(); err != io.EOF {
		return Manifest{}, manifestErr("nesneden sonra veri var")
	}

	var m Manifest
	var err error
	if m.Schema, err = intValue(vals[0], "schema"); err != nil {
		return Manifest{}, err
	}
	strs := make([]string, len(manifestKeys))
	for i, v := range vals {
		if i == 0 || i == 7 { // schema, size
			continue
		}
		s, ok := v.(string)
		if !ok {
			return Manifest{}, manifestErr("%q dizgi olmalı", manifestKeys[i])
		}
		strs[i] = s
	}
	m.Env, m.Platform, m.Arch, m.Component, m.Version, m.SHA256 = strs[1], strs[2], strs[3], strs[4], strs[5], strs[6]
	size, err := intValue(vals[7], "size")
	if err != nil {
		return Manifest{}, err
	}
	m.Size = int64(size)
	if m.IssuedAt, err = parseTime(strs[8], "issuedAt"); err != nil {
		return Manifest{}, err
	}
	if m.ExpiresAt, err = parseTime(strs[9], "expiresAt"); err != nil {
		return Manifest{}, err
	}
	m.MinUpdaterVersion = strs[10]
	if err := m.Validate(); err != nil {
		return Manifest{}, err
	}
	// Son kapı: kaçışlı dizgi ("A"), baştaki sıfır, boşluk vb. her farkı yakalar (tek biçim → sunucu ile istemci farklı okuyamaz).
	if !bytes.Equal(m.Canonical(), b) {
		return Manifest{}, manifestErr("kanonik biçimde değil")
	}
	return m, nil
}

// intValue yalnız işaretsiz, baştaki sıfırsız, üssüz ondalık tamsayı (kanonik eşitlik ayrıca denetler).
func intValue(v any, key string) (int, error) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, manifestErr("%q sayı olmalı", key)
	}
	s := string(n)
	if s == "" || len(s) > 10 || (len(s) > 1 && s[0] == '0') {
		return 0, manifestErr("%q kanonik tamsayı değil", key)
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, manifestErr("%q kanonik tamsayı değil", key)
		}
	}
	i, err := strconv.Atoi(s)
	if err != nil {
		return 0, manifestErr("%q kanonik tamsayı değil", key)
	}
	return i, nil
}

// parseTime yalnız `YYYY-MM-DDTHH:MM:SSZ`; time.Parse kesirli saniyeyi düzende olmasa da kabul ettiğinden geri biçimleme eşitliği istenir.
func parseTime(s, key string) (time.Time, error) {
	t, err := time.Parse(timeLayout, s)
	if err != nil || t.Format(timeLayout) != s {
		return time.Time{}, manifestErr("%q YYYY-MM-DDTHH:MM:SSZ olmalı", key)
	}
	return t, nil
}

// Validate alan kuralları (updateManifestSchema): enumlar + birleşim (ValidCombo), sürüm deseni, sha256 küçük hex, size 1..MaxBinarySize,
// zamanlar saniye hassasiyetinde UTC ve issuedAt < expiresAt ≤ issuedAt+90 g.
func (m Manifest) Validate() error {
	if m.Schema != SchemaVersion {
		return manifestErr("schema %d olmalı", SchemaVersion)
	}
	if m.Env != EnvProd && m.Env != EnvStaging {
		return manifestErr("env geçersiz")
	}
	if m.Platform != PlatformWindows && m.Platform != PlatformMacOS && m.Platform != PlatformLinux {
		return manifestErr("platform geçersiz")
	}
	if m.Arch != ArchAMD64 && m.Arch != ArchUniversal {
		return manifestErr("arch geçersiz")
	}
	if m.Component != ComponentClient && m.Component != ComponentService {
		return manifestErr("component geçersiz")
	}
	if !ValidCombo(m.Platform, m.Arch, m.Component) {
		return manifestErr("platform/arch/component birleşimi geçersiz")
	}
	if _, err := ParseVersion(m.Version); err != nil {
		return manifestErr("version desen dışı")
	}
	if _, err := ParseVersion(m.MinUpdaterVersion); err != nil {
		return manifestErr("minUpdaterVersion desen dışı")
	}
	if !isLowerHex(m.SHA256, 64) {
		return manifestErr("sha256 64 küçük hex olmalı")
	}
	if m.Size < 1 || m.Size > MaxBinarySize {
		return manifestErr("size 1..%d olmalı", MaxBinarySize)
	}
	for _, t := range []time.Time{m.IssuedAt, m.ExpiresAt} {
		if t.Location() != time.UTC || t.Nanosecond() != 0 || t.Year() < 2000 || t.Year() > 9999 {
			return manifestErr("zaman saniye hassasiyetinde UTC olmalı")
		}
	}
	if !m.IssuedAt.Before(m.ExpiresAt) || m.ExpiresAt.Sub(m.IssuedAt) > MaxValidityService {
		return manifestErr("issuedAt < expiresAt ≤ issuedAt+90 g olmalı")
	}
	return nil
}

// Canonical manifestin tek geçerli bayt biçimi (§14.6). İmzalayıcı yalnız bunu yazar. json.Marshal kullanılmaz
// (HTML kaçışları, alan sırası); Validate'ten geçmiş değerler kaçış gerektiren karakter içermez.
func (m Manifest) Canonical() []byte {
	var b bytes.Buffer
	b.Grow(320)
	b.WriteString(`{"schema":`)
	b.WriteString(strconv.Itoa(m.Schema))
	for _, kv := range [...][2]string{{"env", m.Env}, {"platform", m.Platform}, {"arch", m.Arch},
		{"component", m.Component}, {"version", m.Version}, {"sha256", m.SHA256}} {
		writeStr(&b, kv[0], kv[1])
	}
	b.WriteString(`,"size":`)
	b.WriteString(strconv.FormatInt(m.Size, 10))
	writeStr(&b, "issuedAt", m.IssuedAt.UTC().Format(timeLayout))
	writeStr(&b, "expiresAt", m.ExpiresAt.UTC().Format(timeLayout))
	writeStr(&b, "minUpdaterVersion", m.MinUpdaterVersion)
	b.WriteByte('}')
	return b.Bytes()
}

func writeStr(b *bytes.Buffer, k, v string) {
	b.WriteString(`,"`)
	b.WriteString(k)
	b.WriteString(`":"`)
	b.WriteString(v)
	b.WriteByte('"')
}

// FileName Release/volume dosya adı `update-<component>-<platform>-<arch>.json` (K-P29-2); imza dosyası + ".sig".
func (m Manifest) FileName() string {
	return "update-" + m.Component + "-" + m.Platform + "-" + m.Arch + ".json"
}

// ValidCombo platform↔arch eşlemesi (windows/linux amd64, macOS universal) ve servis yalnız windows/amd64
// (contracts UPDATE_ARCH_BY_PLATFORM + updateManifestSchema çapraz kuralı).
func ValidCombo(platform, arch, component string) bool {
	switch platform {
	case PlatformWindows:
		return arch == ArchAMD64 && (component == ComponentClient || component == ComponentService)
	case PlatformLinux:
		return arch == ArchAMD64 && component == ComponentClient
	case PlatformMacOS:
		return arch == ArchUniversal && component == ComponentClient
	}
	return false
}

// MaxValidity component'e göre en uzun geçerlilik (istemci 30 g, servis 90 g).
func MaxValidity(component string) time.Duration {
	if component == ComponentService {
		return MaxValidityService
	}
	return MaxValidityClient
}

func isLowerHex(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
