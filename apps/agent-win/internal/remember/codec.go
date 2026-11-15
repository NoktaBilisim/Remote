package remember

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"time"
)

// `kayitlar.bin` v3 JSON biçimi (ADR-0004 r6, mimari-e11 §8d.1): alan adları ve sırası dosya biçimidir.

type filePersonal struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
	Email string `json:"email,omitempty"`
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

// decode v3 düz metnini katı çözer. Biçim hatası (bilinmeyen sürüm/alan, geçersiz öğe, bütünlük) hata döner (sınıf 1);
// sayım ihlali hata değildir, normalize ile düzeltilir ve ikinci dönüş true olur (G-P20-17).
func decode(plain []byte) (Data, bool, error) {
	f, err := decodeFileV3(plain)
	if err != nil {
		return Data{}, false, err
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
		b, err := decodeBinding(fb)
		if err != nil {
			return Data{}, false, err
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

// decodeFileV3 zarf: sürüm 3, bilinmeyen alan yok, tek JSON değeri, cihaz anahtarı yalnız kişisel bilgiyle.
func decodeFileV3(plain []byte) (fileV3, error) {
	v, err := version(plain)
	if err != nil {
		return fileV3{}, err
	}
	if v != formatV3 {
		return fileV3{}, errors.New("remember: bilinmeyen sürüm")
	}
	var f fileV3
	dec := json.NewDecoder(bytes.NewReader(plain))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return fileV3{}, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return fileV3{}, errors.New("remember: fazladan veri")
	}
	if (f.Personal == nil) != (f.DeviceKey == "") {
		return fileV3{}, errors.New("remember: cihaz anahtarı kişisel bilgiye bağlı")
	}
	return f, nil
}

// decodeBinding tek öğe: zamanlar RFC 3339, öğe geçerli olmalı.
func decodeBinding(fb fileBindingV3) (Binding, error) {
	b := Binding{Server: fb.Server, Key: fb.Key, TenantName: fb.TenantName, CustomerName: fb.CustomerName}
	var err error
	if b.IssuedAt, err = parseTime(fb.IssuedAt); err != nil {
		return Binding{}, err
	}
	if fb.LastUsedAt != "" {
		if b.LastUsedAt, err = parseTime(fb.LastUsedAt); err != nil {
			return Binding{}, err
		}
	}
	if !b.valid() {
		return Binding{}, errors.New("remember: geçersiz kayıt")
	}
	return b, nil
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
