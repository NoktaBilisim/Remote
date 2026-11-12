package remember

import (
	"bytes"
	"encoding/json"
	"errors"
	"regexp"
	"time"
	"unicode"
	"unicode/utf8"
)

// Dosya biçimleri (ADR-0004 r4, mimari-e10 §8.3). v1 (P8b-2) okunur ve bellekte v2'ye yükseltilir; her yazım v2'dir.
const (
	formatV1      = 1
	formatV2      = 2
	nameMaxRune   = 80
	emailMax      = 254
	tenantMaxRune = 120
	custMaxRune   = 100
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

// Binding bilgisayar kaydı (AC-181, ADR-0017). Server kaydı veren sunucunun kanonik kökenidir (CanonicalOrigin).
type Binding struct {
	Server, Key, TenantName, CustomerName string
	IssuedAt                              time.Time
}

// Data dosyanın içeriği; iki alan ayrı ayrı isteğe bağlı, en az biri dolu (aksi dosya silinir).
type Data struct {
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
	return n >= minRune && n <= maxRune && !hasControl(s)
}

func (p Personal) valid() bool {
	return validText(p.Name, 1, nameMaxRune) && phoneRe.MatchString(p.Phone) && len(p.Email) <= emailMax &&
		!hasControl(p.Email) && deviceKeyRe.MatchString(p.DeviceKey)
}

func (b Binding) valid() bool {
	origin, ok := CanonicalOrigin(b.Server)
	return ok && origin == b.Server && BindingKeyRe.MatchString(b.Key) && validText(b.TenantName, 1, tenantMaxRune) &&
		validText(b.CustomerName, 0, custMaxRune) && !b.IssuedAt.IsZero()
}

func (d Data) valid() bool {
	return (d.Personal != nil || d.Binding != nil) && (d.Personal == nil || d.Personal.valid()) &&
		(d.Binding == nil || d.Binding.valid())
}

func strictDecode(plain []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(plain))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// decode düz metni sürümüne göre çözer; v1 → v2 yükseltmesi bellekte yapılır.
func decode(plain []byte) (Data, error) {
	var head struct {
		V int `json:"v"`
	}
	if err := json.Unmarshal(plain, &head); err != nil {
		return Data{}, err
	}
	var d Data
	switch head.V {
	case formatV1:
		var f fileV1
		if err := strictDecode(plain, &f); err != nil {
			return Data{}, err
		}
		d.Personal = &Personal{Name: f.Name, Phone: f.Phone, Email: f.Email, DeviceKey: f.DeviceKey}
	case formatV2:
		var f fileV2
		if err := strictDecode(plain, &f); err != nil {
			return Data{}, err
		}
		if (f.Personal == nil) != (f.DeviceKey == "") {
			return Data{}, errors.New("remember: cihaz anahtarı kişisel bilgiye bağlı")
		}
		if f.Personal != nil {
			d.Personal = &Personal{Name: f.Personal.Name, Phone: f.Personal.Phone, Email: f.Personal.Email, DeviceKey: f.DeviceKey}
		}
		if f.Binding != nil {
			at, err := time.Parse(time.RFC3339, f.Binding.IssuedAt)
			if err != nil {
				return Data{}, err
			}
			d.Binding = &Binding{Server: f.Binding.Server, Key: f.Binding.Key, TenantName: f.Binding.TenantName,
				CustomerName: f.Binding.CustomerName, IssuedAt: at.UTC()}
		}
	default:
		return Data{}, errors.New("remember: bilinmeyen sürüm")
	}
	if !d.valid() {
		return Data{}, errors.New("remember: geçersiz veri")
	}
	return d, nil
}

// encode her zaman v2 yazar.
func encode(d Data) ([]byte, error) {
	if !d.valid() {
		return nil, errors.New("remember: geçersiz veri")
	}
	f := fileV2{V: formatV2}
	if p := d.Personal; p != nil {
		f.Personal = &filePersonal{Name: p.Name, Phone: p.Phone, Email: p.Email}
		f.DeviceKey = p.DeviceKey
	}
	if b := d.Binding; b != nil {
		f.Binding = &fileBinding{Server: b.Server, Key: b.Key, TenantName: b.TenantName, CustomerName: b.CustomerName,
			IssuedAt: b.IssuedAt.UTC().Format(time.RFC3339)}
	}
	return json.Marshal(f)
}
