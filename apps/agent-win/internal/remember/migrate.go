package remember

import (
	"bytes"
	"errors"
)

// MigrateResult açılış sonucu: göçten sonra `kayitlar.bin`'in durumu ve ana ekran bilgileri (K-P20-5).
type MigrateResult struct {
	LoadResult
	// Blocked 5 sınırı nedeniyle eklenemeyen eski kaydın firma adı ("Eski sürümden kalan bir kayıt (<firma>)
	// eklenemedi; 5 firma sınırı..."); `hatirla.bin` dokunulmadan kalır. Boşsa engel yok.
	Blocked string
	// Failed yazılan geri okunup doğrulanamadı (diag `migrate_failed`, içerik yok); `hatirla.bin` dokunulmadan kalır,
	// bir sonraki açılışta yeniden denenir.
	Failed bool
}

// Migrate açılışta bir kez, süreçler arası kilit altında `hatirla.bin` (v1/v2) → `kayitlar.bin` (v3) göçü
// (mimari-e11 §8d.1; idempotent). Sonuç aynı zamanda açılışın okuma durumudur: sınıf-2 sayacı burada ilerler
// (G-P20-18).
//
//  1. Yalnız `hatirla.bin` var ve çözülüyor → v3 kurulur (`binding` → `bindings[0]`, `lastUsedAt = issuedAt`), atomik
//     yazılır, geri okunup eşitlik doğrulanır, sonra `hatirla.bin` (+tmp) handle ile silinir. Doğrulama tutmazsa
//     `kayitlar.bin` silinir, eski dosya kalır.
//  2. `hatirla.bin` kesin biçim hatası → silinir; geçici hata → dokunulmaz, göç sonraki açılışa kalır.
//  3. İkisi de var → birleştirme: `personal` yalnız v3'te yoksa alınır; anahtar v3'te yoksa ve yer varsa eklenir; ardından
//     `hatirla.bin` silinir. Yer yoksa eski dosya kalır ve Blocked dolar (sessiz kayıp yok).
//  4. Aynı firmaya iki anahtar birleştirilmez (kimlik anahtardır; sunucu fazlasını sonraki kayıtta iptal eder).
//
// `kayitlar.bin` okunamıyorsa (sınıf 2) hiçbir dosyaya dokunulmaz.
func (s *Store) Migrate() MigrateResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	h, err := s.acquire(false)
	if err != nil {
		if notExist(err) {
			return MigrateResult{LoadResult: LoadResult{Status: StatusAbsent}}
		}
		return MigrateResult{LoadResult: LoadResult{Status: StatusUnreadable, Class: classify(err)}}
	}
	defer h.close()
	r := s.load(h, true)
	if r.Status == StatusUnreadable || s.UnprotectLegacy == nil {
		return MigrateResult{LoadResult: r}
	}
	old, ok := s.readLegacy(h)
	if !ok {
		return MigrateResult{LoadResult: r}
	}
	merged, changed, blocked := mergeLegacy(r.Data, old)
	if changed || r.Trimmed {
		back, ok := s.writeVerified(h, merged)
		if !ok {
			s.restore(h, r)
			return MigrateResult{LoadResult: s.load(h, false), Failed: true}
		}
		r = back
	}
	if blocked == "" {
		s.dropLegacy(h)
	}
	return MigrateResult{LoadResult: r, Blocked: blocked}
}

// readLegacy `hatirla.bin`'i okur (kural 2). Dosya yoksa ya da okunamıyorsa false: kesin biçim hatasında dosya silinir,
// geçici hatada dokunulmaz.
func (s *Store) readLegacy(h *held) (legacy, bool) {
	plain, err := readSealed(h.dir, legacyName, s.UnprotectLegacy)
	if notExist(err) {
		return legacy{}, false
	}
	var old legacy
	if err == nil {
		if old, err = decodeLegacy(plain); err != nil {
			err = errCorrupt
		}
	}
	if err != nil {
		if classify(err) == ClassFormat {
			s.dropLegacy(h)
		}
		return legacy{}, false
	}
	return old, true
}

// mergeLegacy kural 1, 3, 4: `personal` yalnız v3'te yoksa alınır; anahtar v3'te yoksa ve yer varsa eklenir
// (`lastUsedAt = issuedAt`). changed: yazılacak değişiklik var; blocked: yer olmadığı için eklenemeyen firmanın adı.
func mergeLegacy(cur Data, old legacy) (merged Data, changed bool, blocked string) {
	merged = cur
	merged.Bindings = append([]Binding(nil), cur.Bindings...)
	if old.Personal != nil && merged.Personal == nil {
		merged.Personal, changed = old.Personal, true
	}
	if b := old.Binding; b != nil && !hasKey(merged.Bindings, b.Key) {
		nb := *b
		nb.LastUsedAt = nb.IssuedAt
		cand := append(append([]Binding(nil), merged.Bindings...), nb)
		if countOK(cand) {
			merged.Bindings, changed = sortBindings(cand), true
		} else {
			blocked = b.TenantName
		}
	}
	return merged, changed, blocked
}

// writeVerified yazar, geri okur ve encode eşitliğini doğrular.
func (s *Store) writeVerified(h *held, d Data) (LoadResult, bool) {
	want, err := encode(d)
	if err != nil || s.write(h.dir, d) != nil {
		return LoadResult{}, false
	}
	back := s.load(h, false)
	if back.Status != StatusOK || back.Trimmed {
		return back, false
	}
	got, err := encode(back.Data)
	return back, err == nil && bytes.Equal(got, want)
}

// restore doğrulama tutmadığında `kayitlar.bin`'i göç öncesine döndürür: önceden yoksa silinir, varsa eski içerik
// yeniden yazılır (en iyi çaba).
func (s *Store) restore(h *held, prev LoadResult) {
	if prev.Status == StatusOK {
		_ = s.write(h.dir, prev.Data)
		return
	}
	_ = h.dir.Remove(fileName)
	_ = h.dir.Remove(tmpName)
}

func (s *Store) dropLegacy(h *held) {
	_ = h.dir.Remove(legacyName)
	_ = h.dir.Remove(legacyTmpName)
}

func hasKey(bs []Binding, key string) bool {
	for _, b := range bs {
		if b.Key == key {
			return true
		}
	}
	return false
}

// Eski biçimler v1/v2 (`hatirla.bin`, ADR-0004 r3/r4): yalnız göçte okunur.

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

func (l legacy) valid() bool {
	return (l.Personal != nil || l.Binding != nil) && (l.Personal == nil || l.Personal.valid()) &&
		(l.Binding == nil || l.Binding.valid())
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
