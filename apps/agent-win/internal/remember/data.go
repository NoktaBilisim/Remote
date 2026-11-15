package remember

import (
	"regexp"
	"sort"
	"time"
	"unicode"
	"unicode/utf8"
)

// Dosya biçimleri. v1/v2 (`hatirla.bin`, ADR-0004 r3/r4) yalnız göçte okunur (migrate.go); her yazım v3'tür
// (`kayitlar.bin`, ADR-0004 r6, mimari-e11 §8d.1).
const (
	formatV1      = 1
	formatV2      = 2
	formatV3      = 3
	nameMaxRune   = 80
	emailMax      = 254
	tenantMaxRune = 120
	custMaxRune   = 100

	// MaxPerOrigin köken başına kayıt sınırı (AC-254, G-P20-12).
	MaxPerOrigin = 5
	// MaxOrigins dosyadaki en çok köken sayısı: gömülü + 1 başka (G-P20-17); toplam ≤ 10 öğe.
	MaxOrigins = 2
)

var (
	phoneRe     = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
	deviceKeyRe = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)
	// BindingKeyRe contracts `bindingKeySchema` ile aynı ifade (`rsb_` + base64url 32 bayt).
	BindingKeyRe = regexp.MustCompile(`^rsb_[A-Za-z0-9_-]{43}$`)
)

// Personal "Bilgilerimi bu bilgisayarda hatırla" (AC-136). DeviceKey kişiye bağlıdır (G-E10-5): kişisel bilgiler
// silinince o da silinir, bir sonraki hatırlamada yenisi üretilir.
type Personal struct {
	Name, Phone, Email, DeviceKey string
}

// Binding bilgisayar kaydı (AC-181, AC-254). Server kaydı veren sunucunun kanonik kökenidir (CanonicalOrigin).
// LastUsedAt yalnız yerel sıralamadır (sunucuya gitmez); sıfırsa sıralamada IssuedAt kullanılır.
type Binding struct {
	Server, Key, TenantName, CustomerName string
	IssuedAt, LastUsedAt                  time.Time
}

// Prefs kullanıcı tercihleri; yalnız en az bir kayıt varken tutulur (kayıtsız bilgisayarda tepsi yok).
type Prefs struct {
	Tray bool
}

// Data dosyanın içeriği. Bindings `lastUsedAt` azalan sıradadır (ekran sırası). Personal veya en az bir kayıt dolu;
// ikisi de boşsa dosya silinir.
type Data struct {
	Personal *Personal
	Bindings []Binding
	Prefs    *Prefs
}

// ForOrigin verilen kökenin kayıtları (sıra korunur). Başka kökenli kayıtlar kullanılmaz ve gönderilmez (T43).
func (d Data) ForOrigin(server string) []Binding {
	var out []Binding
	for _, b := range d.Bindings {
		if b.Server == server {
			out = append(out, b)
		}
	}
	return out
}

func (d Data) empty() bool { return d.Personal == nil && len(d.Bindings) == 0 }

func (b Binding) usedAt() time.Time {
	if b.LastUsedAt.IsZero() {
		return b.IssuedAt
	}
	return b.LastUsedAt
}

func hasControl(s string) bool {
	for _, r := range s {
		if unicode.In(r, unicode.Cc, unicode.Cf) {
			return true
		}
	}
	return false
}

func validText(s string, minRune, maxRune int) bool {
	n := utf8.RuneCountInString(s)
	return utf8.ValidString(s) && n >= minRune && n <= maxRune && !hasControl(s)
}

func (p Personal) valid() bool {
	return validText(p.Name, 1, nameMaxRune) && phoneRe.MatchString(p.Phone) && len(p.Email) <= emailMax &&
		utf8.ValidString(p.Email) && !hasControl(p.Email) && deviceKeyRe.MatchString(p.DeviceKey)
}

func (b Binding) valid() bool {
	origin, ok := CanonicalOrigin(b.Server)
	return ok && origin == b.Server && BindingKeyRe.MatchString(b.Key) && validText(b.TenantName, 1, tenantMaxRune) &&
		validText(b.CustomerName, 0, custMaxRune) && !b.IssuedAt.IsZero()
}

// countOK yazım kuralı (G-P20-17): anahtar benzersiz, köken başına ≤ 5, en çok 2 köken.
func countOK(bs []Binding) bool {
	keys := make(map[string]bool, len(bs))
	per := map[string]int{}
	for _, b := range bs {
		if keys[b.Key] {
			return false
		}
		keys[b.Key] = true
		per[b.Server]++
		if per[b.Server] > MaxPerOrigin {
			return false
		}
	}
	return len(per) <= MaxOrigins
}

// sortBindings `lastUsedAt` (yoksa issuedAt) azalan; eşitlikte giriş sırası korunur.
func sortBindings(bs []Binding) []Binding {
	if len(bs) == 0 {
		return nil
	}
	sort.SliceStable(bs, func(i, j int) bool { return bs[i].usedAt().After(bs[j].usedAt()) })
	return bs
}

// normalize okumadaki sayım ihlallerini (G-P20-17) bellekte düzeltir; dosya silinmez. Yinelenen anahtarda dosyadaki
// ilk öğe kalır; ardından en yeni kullanılandan başlayarak köken başına 5 ve en çok 2 köken tutulur (atılanlar en
// eskilerdir; kalan iki köken en son kullanılan iki kökendir). İkinci dönüş: bir şey atıldı mı.
func normalize(in []Binding) ([]Binding, bool) {
	seen := map[string]bool{}
	var uniq []Binding
	for _, b := range in {
		if !seen[b.Key] {
			seen[b.Key] = true
			uniq = append(uniq, b)
		}
	}
	uniq = sortBindings(uniq)
	per := map[string]int{}
	var out []Binding
	for _, b := range uniq {
		if _, known := per[b.Server]; !known && len(per) >= MaxOrigins {
			continue
		}
		if per[b.Server] >= MaxPerOrigin {
			continue
		}
		per[b.Server]++
		out = append(out, b)
	}
	return out, len(out) != len(in)
}
