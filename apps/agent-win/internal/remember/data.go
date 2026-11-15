package remember

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
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

// legacy v1/v2 (`hatirla.bin`) içeriği: tek kayıt.
type legacy struct {
	Personal *Personal
	Binding  *Binding
}

type fileV1 struct {
	V         int    `json:"v"`
	Name      string `json:"name"`
	Phone     string `json:"phone"`
	Email     string `json:"email,omitempty"`
	DeviceKey string `json:"deviceKey"`
}

type filePersonal struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email,omitempty"`
}

type fileBinding struct {
	Server       string `json:"server"`
	Key          string `json:"key"`
	TenantName   string `json:"tenantName"`
	CustomerName string `json:"customerName,omitempty"`
	IssuedAt     string `json:"issuedAt"`
}

type fileV2 struct {
	V         int           `json:"v"`
	Personal  *filePersonal `json:"personal,omitempty"`
	Binding   *fileBinding  `json:"binding,omitempty"`
	DeviceKey string        `json:"deviceKey,omitempty"`
}

type fileBindingV3 struct {
	Server       string `json:"server"`
	Key          string `json:"key"`
	TenantName   string `json:"tenantName"`
	CustomerName string `json:"customerName,omitempty"`
	IssuedAt     string `json:"issuedAt"`
	LastUsedAt   string `json:"lastUsedAt,omitempty"`
}

type filePrefs struct {
	Tray bool `json:"tray"`
}

type fileV3 struct {
	V         int             `json:"v"`
	Personal  *filePersonal   `json:"personal,omitempty"`
	DeviceKey string          `json:"deviceKey,omitempty"`
	Bindings  []fileBindingV3 `json:"bindings,omitempty"`
	Prefs     *filePrefs      `json:"prefs,omitempty"`
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

func (l legacy) valid() bool {
	return (l.Personal != nil || l.Binding != nil) && (l.Personal == nil || l.Personal.valid()) &&
		(l.Binding == nil || l.Binding.valid())
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

func strictDecode(plain []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(plain))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func version(plain []byte) (int, error) {
	var head struct {
		V int `json:"v"`
	}
	err := json.Unmarshal(plain, &head)
	return head.V, err
}

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	return t.UTC(), err
}

// decodeLegacy v1/v2 düz metnini çözer (yalnız göç).
func decodeLegacy(plain []byte) (legacy, error) {
	v, err := version(plain)
	if err != nil {
		return legacy{}, err
	}
	var l legacy
	switch v {
	case formatV1:
		var f fileV1
		if err := strictDecode(plain, &f); err != nil {
			return legacy{}, err
		}
		l.Personal = &Personal{Name: f.Name, Phone: f.Phone, Email: f.Email, DeviceKey: f.DeviceKey}
	case formatV2:
		var f fileV2
		if err := strictDecode(plain, &f); err != nil {
			return legacy{}, err
		}
		if (f.Personal == nil) != (f.DeviceKey == "") {
			return legacy{}, errors.New("remember: cihaz anahtarı kişisel bilgiye bağlı")
		}
		if f.Personal != nil {
			l.Personal = &Personal{Name: f.Personal.Name, Phone: f.Personal.Phone, Email: f.Personal.Email, DeviceKey: f.DeviceKey}
		}
		if f.Binding != nil {
			at, err := parseTime(f.Binding.IssuedAt)
			if err != nil {
				return legacy{}, err
			}
			l.Binding = &Binding{Server: f.Binding.Server, Key: f.Binding.Key, TenantName: f.Binding.TenantName,
				CustomerName: f.Binding.CustomerName, IssuedAt: at}
		}
	default:
		return legacy{}, errors.New("remember: bilinmeyen sürüm")
	}
	if !l.valid() {
		return legacy{}, errors.New("remember: geçersiz veri")
	}
	return l, nil
}

// decode v3 düz metnini katı çözer. Biçim hatası (bilinmeyen sürüm/alan, geçersiz öğe, bütünlük) hata döner (sınıf 1);
// sayım ihlali hata değildir, normalize ile düzeltilir ve ikinci dönüş true olur (G-P20-17).
func decode(plain []byte) (Data, bool, error) {
	v, err := version(plain)
	if err != nil {
		return Data{}, false, err
	}
	if v != formatV3 {
		return Data{}, false, errors.New("remember: bilinmeyen sürüm")
	}
	var f fileV3
	dec := json.NewDecoder(bytes.NewReader(plain))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return Data{}, false, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return Data{}, false, errors.New("remember: fazladan veri")
	}
	if (f.Personal == nil) != (f.DeviceKey == "") {
		return Data{}, false, errors.New("remember: cihaz anahtarı kişisel bilgiye bağlı")
	}
	var d Data
	if f.Personal != nil {
		d.Personal = &Personal{Name: f.Personal.Name, Phone: f.Personal.Phone, Email: f.Personal.Email, DeviceKey: f.DeviceKey}
		if !d.Personal.valid() {
			return Data{}, false, errors.New("remember: geçersiz kişisel bilgi")
		}
	}
	bs := make([]Binding, 0, len(f.Bindings))
	for _, fb := range f.Bindings {
		b := Binding{Server: fb.Server, Key: fb.Key, TenantName: fb.TenantName, CustomerName: fb.CustomerName}
		if b.IssuedAt, err = parseTime(fb.IssuedAt); err != nil {
			return Data{}, false, err
		}
		if fb.LastUsedAt != "" {
			if b.LastUsedAt, err = parseTime(fb.LastUsedAt); err != nil {
				return Data{}, false, err
			}
		}
		if !b.valid() {
			return Data{}, false, errors.New("remember: geçersiz kayıt")
		}
		bs = append(bs, b)
	}
	if f.Prefs != nil {
		if len(bs) == 0 {
			return Data{}, false, errors.New("remember: tercih kayıtsız tutulmaz")
		}
		d.Prefs = &Prefs{Tray: f.Prefs.Tray}
	}
	var trimmed bool
	d.Bindings, trimmed = normalize(bs)
	if d.empty() {
		return Data{}, false, errors.New("remember: boş veri")
	}
	return d, trimmed, nil
}

// encode v3 yazar. Geçersiz öğe veya boş veri → errInvalid; sayım ihlali → ErrLimit (yazımda kesin ret, G-P20-17).
// HTML kaçışı kapalıdır (G-P20-4): `< > &` 6 bayta şişmez (U+2028/2029'u Go her durumda kaçışlar; bütçe bunu kapsar).
func encode(d Data) ([]byte, error) {
	if d.empty() || (d.Personal != nil && !d.Personal.valid()) || (d.Prefs != nil && len(d.Bindings) == 0) {
		return nil, errInvalid
	}
	f := fileV3{V: formatV3}
	if p := d.Personal; p != nil {
		f.Personal = &filePersonal{Name: p.Name, Phone: p.Phone, Email: p.Email}
		f.DeviceKey = p.DeviceKey
	}
	for _, b := range d.Bindings {
		if !b.valid() {
			return nil, errInvalid
		}
	}
	if !countOK(d.Bindings) {
		return nil, ErrLimit
	}
	for _, b := range sortBindings(append([]Binding(nil), d.Bindings...)) {
		fb := fileBindingV3{Server: b.Server, Key: b.Key, TenantName: b.TenantName, CustomerName: b.CustomerName,
			IssuedAt: b.IssuedAt.UTC().Format(time.RFC3339)}
		if !b.LastUsedAt.IsZero() {
			fb.LastUsedAt = b.LastUsedAt.UTC().Format(time.RFC3339)
		}
		f.Bindings = append(f.Bindings, fb)
	}
	if d.Prefs != nil {
		f.Prefs = &filePrefs{Tray: d.Prefs.Tray}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(f); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}
