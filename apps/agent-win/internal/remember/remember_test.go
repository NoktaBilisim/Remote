package remember

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"remote-support/agent-win/internal/diag"
)

// xorSeal sahte koruma: düz metnin diskte görünmediğini sınamaya yeter.
func xorSeal(b []byte) ([]byte, error) {
	out := make([]byte, len(b))
	for i, c := range b {
		out[i] = c ^ 0x5a
	}
	return out, nil
}

func store(t *testing.T) *Store {
	return &Store{Dir: filepath.Join(t.TempDir(), "NoktaDestek"), Protect: xorSeal, Unprotect: xorSeal, UnprotectLegacy: xorSeal}
}

const testKey = "rsb_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

// samplePersonal deviceKey üretimi request.newKey'dedir (QA-P8b2-1); depo yalnız biçimi denetler.
func samplePersonal() Personal {
	return Personal{Name: "Ayşe Yılmaz", Phone: "+905321234567", Email: "ayse@example.com", DeviceKey: "Ab0_-Ab0_-Ab0_-Ab0_-Ab"}
}

func sampleBinding() Binding {
	return Binding{Server: "https://remote.noktabilisim.net:443", Key: testKey, TenantName: "Nokta Bilişim",
		CustomerName: "Örnek Müşteri A.Ş.", IssuedAt: time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)}
}

func writePlain(t *testing.T, s *Store, plain string) { writeNamed(t, s, fileName, plain) }

func writeNamed(t *testing.T, s *Store, name, plain string) {
	t.Helper()
	sealed, _ := xorSeal([]byte(plain))
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, name), sealed, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readPlain(t *testing.T, s *Store) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(s.Dir, fileName))
	if err != nil {
		t.Fatal(err)
	}
	plain, _ := xorSeal(raw)
	return plain
}

func key(c byte) string { return "rsb_" + strings.Repeat(string(c), 43) }

func bindingAt(server string, c byte, used time.Time) Binding {
	return Binding{Server: server, Key: key(c), TenantName: "Firma " + string(c), IssuedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		LastUsedAt: used}
}

func day(n int) time.Time { return time.Date(2026, 11, n, 0, 0, 0, 0, time.UTC) }

const home = "https://remote.noktabilisim.net:443"

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	ents, _ := os.ReadDir(dir)
	var out []string
	for _, e := range ents {
		out = append(out, e.Name())
	}
	return out
}

func TestAC136SaveLoadOnlyAllowedFields(t *testing.T) {
	s := store(t)
	if _, ok := s.Load(); ok {
		t.Fatal("dosya yokken veri dönmemeli")
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("okuma klasör/kilit oluşturmamalı (AC-108 iz yok)")
	}
	p := samplePersonal()
	if err := s.SavePersonal(p); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(dirNames(t, s.Dir), ","); got != "kayitlar.bin,kayitlar.lock" {
		t.Fatalf("klasörde yalnız kayitlar.bin ve kayitlar.lock olmalı: %s", got)
	}
	raw, _ := os.ReadFile(filepath.Join(s.Dir, fileName))
	if bytes.Contains(raw, []byte("905321234567")) {
		t.Error("dosya korumasız yazılmış")
	}
	plain := readPlain(t, s)
	for _, k := range []string{"description", "requestSecret", "ref", "consent", "autostart"} {
		if bytes.Contains(plain, []byte(`"`+k)) {
			t.Errorf("%s yazılmamalı", k)
		}
	}
	if !bytes.HasPrefix(plain, []byte(`{"v":3,`)) {
		t.Errorf("v3 yazılmalı: %s", plain)
	}
	got, ok := s.LoadPersonal()
	if !ok || got != p {
		t.Fatalf("%+v %v", got, ok)
	}
}

func TestAC254V3BindingsPersonalPrefsRoundTrip(t *testing.T) {
	s := store(t)
	b := sampleBinding()
	if err := s.SaveBinding(b, ""); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.LoadPersonal(); ok {
		t.Fatal("yalnız kayıt varken kişisel bilgi dönmemeli")
	}
	if err := s.SavePersonal(samplePersonal()); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPrefs(Prefs{Tray: true}); err != nil {
		t.Fatal(err)
	}
	d, ok := s.Load()
	if !ok || len(d.Bindings) != 1 || d.Bindings[0] != b || d.Personal == nil || *d.Personal != samplePersonal() ||
		d.Prefs == nil || !d.Prefs.Tray {
		t.Fatalf("%+v", d)
	}
	plain := string(readPlain(t, s))
	for _, want := range []string{`"bindings":[{"server":"https://remote.noktabilisim.net:443"`, `"deviceKey":"Ab0_-Ab0_-Ab0_-Ab0_-Ab"`,
		`"issuedAt":"2026-11-12T10:00:00Z"`, `"personal":{"name":"Ayşe Yılmaz"`, `"prefs":{"tray":true}`} {
		if !strings.Contains(plain, want) {
			t.Errorf("dosyada %s yok: %s", want, plain)
		}
	}
}

func TestAC254SaveBindingSlotsOrderTouchRemove(t *testing.T) {
	s := store(t)
	for i, c := range []byte("ABC") {
		if err := s.SaveBinding(bindingAt(home, c, day(i+1)), ""); err != nil {
			t.Fatal(err)
		}
	}
	d, _ := s.Load()
	if d.Bindings[0].Key != key('C') || d.Bindings[2].Key != key('A') {
		t.Fatalf("lastUsedAt azalan olmalı: %+v", d.Bindings)
	}
	if err := s.TouchBinding(key('A'), day(10).Add(500*time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	d, _ = s.Load()
	if d.Bindings[0].Key != key('A') || !d.Bindings[0].LastUsedAt.Equal(day(10)) {
		t.Fatalf("touch sıralamayı güncellemeli: %+v", d.Bindings[0])
	}
	// Yenileme: replaceKey yuvası yeni anahtarla değişir, son kullanım korunur; başka öğeler dokunulmaz.
	n := bindingAt(home, 'D', time.Time{})
	n.TenantName = "Yeni Ad"
	if err := s.SaveBinding(n, key('A')); err != nil {
		t.Fatal(err)
	}
	d, _ = s.Load()
	if len(d.Bindings) != 3 || d.Bindings[0].Key != key('D') || !d.Bindings[0].LastUsedAt.Equal(day(10)) {
		t.Fatalf("yuva güncellemesi: %+v", d.Bindings)
	}
	// Başka kökenin anahtarı replaceKey olarak verilse de silinmez.
	other := bindingAt("https://staging.example:4450", 'E', day(2))
	_ = s.SaveBinding(other, "")
	if err := s.SaveBinding(bindingAt(home, 'F', day(3)), key('E')); err != nil {
		t.Fatal(err)
	}
	d, _ = s.Load()
	if len(d.ForOrigin("https://staging.example:4450")) != 1 || len(d.ForOrigin(home)) != 4 {
		t.Fatalf("başka köken korunmalı: %+v", d.Bindings)
	}
	if err := s.RemoveBinding(key('B')); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveBinding(key('Z')); err != nil {
		t.Fatal("olmayan anahtar hata değil:", err)
	}
	if err := s.TouchBinding(key('Z'), day(4)); err != nil {
		t.Fatal("olmayan anahtar hata değil:", err)
	}
	d, _ = s.Load()
	if hasKey(d.Bindings, key('B')) || len(d.Bindings) != 4 {
		t.Fatalf("yalnız o öğe silinmeli: %+v", d.Bindings)
	}
}

// §8d.4: son öğe silinince tercih düşer; kişisel bilgi de yoksa dosya, kilit ve boş klasör silinir.
func TestAC254RemoveLastBindingDropsPrefsThenFile(t *testing.T) {
	s := store(t)
	_ = s.SaveBinding(sampleBinding(), "")
	_ = s.SavePersonal(samplePersonal())
	_ = s.SetPrefs(Prefs{Tray: true})
	if err := s.RemoveBinding(testKey); err != nil {
		t.Fatal(err)
	}
	d, ok := s.Load()
	if !ok || d.Prefs != nil || len(d.Bindings) != 0 || d.Personal == nil {
		t.Fatalf("tercih düşmeli, kişisel kalmalı: %+v", d)
	}
	if err := s.SetPrefs(Prefs{Tray: true}); !errors.Is(err, ErrNoBinding) {
		t.Fatalf("kayıtsız tercih yazılmamalı: %v", err)
	}
	if err := s.ClearPersonal(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("boşalan klasör silinmeli: %v", dirNames(t, s.Dir))
	}
}

// G-P20-17 yazım: köken başına 6. öğe, 3. köken ve yinelenen anahtar kesin ret; dosya değişmez.
func TestAC254GP2017WriteRejectsCountViolations(t *testing.T) {
	s := store(t)
	for i, c := range []byte("ABCDE") {
		if err := s.SaveBinding(bindingAt(home, c, day(i+1)), ""); err != nil {
			t.Fatal(err)
		}
	}
	err := s.SaveBinding(bindingAt(home, 'F', day(9)), "")
	if !errors.Is(err, ErrLimit) || ErrorClass(err) != ClassLimit {
		t.Fatalf("6. öğe reddedilmeli: %v", err)
	}
	if err := s.SaveBinding(bindingAt("https://b.example:443", 'G', day(9)), ""); err != nil {
		t.Fatal("ikinci köken kabul:", err)
	}
	if err := s.SaveBinding(bindingAt("https://c.example:443", 'H', day(9)), ""); !errors.Is(err, ErrLimit) {
		t.Fatalf("3. köken reddedilmeli: %v", err)
	}
	if !countOK([]Binding{bindingAt(home, 'A', day(1))}) || countOK([]Binding{bindingAt(home, 'A', day(1)), bindingAt(home, 'A', day(2))}) {
		t.Fatal("yinelenen anahtar yazımda reddedilmeli")
	}
	if _, err := encode(Data{Bindings: []Binding{bindingAt(home, 'A', day(1)), bindingAt(home, 'A', day(2))}}); !errors.Is(err, ErrLimit) {
		t.Fatalf("encode yineleneni reddetmeli: %v", err)
	}
	d, _ := s.Load()
	if len(d.Bindings) != 6 || hasKey(d.Bindings, key('F')) || hasKey(d.Bindings, key('H')) {
		t.Fatalf("reddedilen yazım dosyayı değiştirmemeli: %d", len(d.Bindings))
	}
	// Yenileme (replaceKey) dolu kökende sınırı aşmaz.
	if err := s.SaveBinding(bindingAt(home, 'F', day(9)), key('A')); err != nil {
		t.Fatal("dolu kökende yenileme kabul:", err)
	}
}

func v3Item(server string, c byte, used string) string {
	return `{"server":"` + server + `","key":"` + key(c) + `","tenantName":"F","issuedAt":"2026-01-01T00:00:00Z","lastUsedAt":"` + used + `"}`
}

// G-P20-17 okuma: sayım ihlali kesin biçim hatası değildir; dosya silinmez, en eski fazlalar bellekte atılır,
// yinelenen anahtarda ilki kalır; bir sonraki yazımda dosya düzelir.
func TestAC254GP2017ReadTrimsOldestKeepsFile(t *testing.T) {
	var items []string
	for i, c := range []byte("ABCDEFG") { // aynı kökende 7 öğe
		items = append(items, v3Item(home, c, time.Date(2026, 11, i+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)))
	}
	items = append(items, v3Item("https://b.example:443", 'H', "2026-10-01T00:00:00Z"))
	items = append(items, v3Item("https://c.example:443", 'I', "2026-09-01T00:00:00Z")) // 3. köken, en eski
	dup := strings.Replace(v3Item(home, 'G', "2026-08-01T00:00:00Z"), `"tenantName":"F"`, `"tenantName":"Kopya"`, 1)
	items = append(items, dup)
	s := store(t)
	writePlain(t, s, `{"v":3,"bindings":[`+strings.Join(items, ",")+`]}`)
	r := s.LoadState()
	if r.Status != StatusOK || !r.Trimmed {
		t.Fatalf("okunmalı ve atma bildirilmeli: %+v", r)
	}
	d := r.Data
	if len(d.ForOrigin(home)) != 5 || len(d.ForOrigin("https://b.example:443")) != 1 || len(d.Bindings) != 6 {
		t.Fatalf("köken başına 5, 2 köken: %+v", d.Bindings)
	}
	if hasKey(d.Bindings, key('A')) || hasKey(d.Bindings, key('B')) || hasKey(d.Bindings, key('I')) {
		t.Fatal("en eskiler atılmalı")
	}
	for _, b := range d.Bindings {
		if b.Key == key('G') && b.TenantName != "F" {
			t.Fatal("yinelenen anahtarda ilki kalmalı")
		}
	}
	if !strings.Contains(string(readPlain(t, s)), key('A')) {
		t.Fatal("okuma dosyayı silmemeli/değiştirmemeli")
	}
	if err := s.TouchBinding(key('C'), day(20)); err != nil {
		t.Fatal(err)
	}
	if r := s.LoadState(); r.Trimmed || len(r.Data.Bindings) != 6 {
		t.Fatalf("yazımdan sonra dosya düzelmeli: %+v", r)
	}
}

// G-P20-3 sınıf 1: biçim hataları dosyayı siler (kayıtsız sayılır).
func TestAC254GP203FormatErrorsDeleteFile(t *testing.T) {
	const pv = `"personal":{"name":"A","phone":"+905321234567"},"deviceKey":"AAAAAAAAAAAAAAAAAAAAAA"`
	item := v3Item(home, 'A', "2026-11-01T00:00:00Z")
	for name, content := range map[string]string{
		"bozuk json":           "{",
		"v2 bu dosyada":        `{"v":2,` + pv + `}`,
		"bilinmeyen sürüm":     `{"v":4,` + pv + `}`,
		"bilinmeyen alan":      `{"v":3,` + pv + `,"autostart":true}`,
		"boş":                  `{"v":3}`,
		"boş dizi":             `{"v":3,"bindings":[]}`,
		"anahtarsız kişi":      `{"v":3,"personal":{"name":"A","phone":"+905321234567"}}`,
		"kişisiz anahtar":      `{"v":3,"bindings":[` + item + `],"deviceKey":"AAAAAAAAAAAAAAAAAAAAAA"}`,
		"kayıtsız tercih":      `{"v":3,` + pv + `,"prefs":{"tray":true}}`,
		"biçimsiz anahtar":     `{"v":3,"bindings":[` + strings.Replace(item, key('A'), "rsb_x", 1) + `]}`,
		"kanonik değil":        `{"v":3,"bindings":[` + strings.Replace(item, home, "https://Remote.noktabilisim.net", 1) + `]}`,
		"öğede bilinmeyen":     `{"v":3,"bindings":[` + strings.Replace(item, `"tenantName"`, `"x":1,"tenantName"`, 1) + `]}`,
		"kontrol karakteri":    `{"v":3,"bindings":[` + strings.Replace(item, `"F"`, `"F\u202e"`, 1) + `]}`,
		"geçersiz zaman":       `{"v":3,"bindings":[` + strings.Replace(item, "2026-11-01T00:00:00Z", "dün", 1) + `]}`,
		"fazladan veri":        `{"v":3,` + pv + `}{}`,
		"çok uzun firma adı":   `{"v":3,"bindings":[` + strings.Replace(item, `"F"`, `"`+strings.Repeat("ş", 121)+`"`, 1) + `]}`,
		"32 KB üstü düz metin": `{"v":3,` + pv + `,"x":"` + strings.Repeat("a", plainMax) + `"}`,
	} {
		s := store(t)
		writePlain(t, s, content)
		r := s.LoadState()
		if r.Status != StatusAbsent || r.Class != ClassFormat {
			t.Errorf("%s: sınıf 1 olmalı: %+v", name, r)
		}
		if _, err := os.Stat(filepath.Join(s.Dir, fileName)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s: dosya silinmeli", name)
		}
	}
	s := store(t)
	s.Unprotect = func([]byte) ([]byte, error) { return nil, errCorrupt }
	writePlain(t, s, "x")
	if r := s.LoadState(); r.Status != StatusAbsent || r.Class != ClassFormat {
		t.Fatalf("NTE_BAD_DATA sınıf 1: %+v", r)
	}
	s = store(t)
	writePlain(t, s, "")
	if err := os.WriteFile(filepath.Join(s.Dir, fileName), make([]byte, sealedMax+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if r := s.LoadState(); r.Status != StatusAbsent {
		t.Fatalf("128 KB üstü mühürlü dosya sınıf 1: %+v", r)
	}
}

// G-P20-3/18 sınıf 2: geçici hatada dosyaya dokunulmaz, yazma reddedilir, ForgetAll yine siler; aynı kod ardışık 3
// açılışta silme önerilir, başarılı okumada sayaç sıfırlanır.
func TestAC254GP2018TransientErrorKeepsFileAndCounts(t *testing.T) {
	s := store(t)
	_ = s.SaveBinding(sampleBinding(), "")
	_ = s.SavePersonal(samplePersonal())
	sealed, _ := os.ReadFile(filepath.Join(s.Dir, fileName))
	fail := errKeyState
	s.Unprotect = func([]byte) ([]byte, error) { return nil, fail }
	for i := 1; i <= 3; i++ {
		r := s.Migrate()
		if r.Status != StatusUnreadable || r.Class != ClassKeyState || r.SuggestForget != (i == 3) {
			t.Fatalf("açılış %d: %+v", i, r)
		}
	}
	if r := s.LoadState(); !r.SuggestForget || r.Status != StatusUnreadable {
		t.Fatalf("öneri sonraki okumada da görünmeli: %+v", r)
	}
	if err := s.RemoveBinding(testKey); !errors.Is(err, ErrUnreadable) || ErrorClass(err) != ClassUnreadable {
		t.Fatalf("okunamayan dosyaya yazılmamalı: %v", err)
	}
	if err := s.SavePersonal(samplePersonal()); !errors.Is(err, ErrUnreadable) {
		t.Fatalf("boş veriyle üzerine yazılmamalı: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(s.Dir, fileName)); !bytes.Equal(got, sealed) {
		t.Fatal("sınıf 2'de dosya değişmemeli")
	}
	fail = errDPAPI // farklı kod: sayaç yeniden başlar
	if r := s.Migrate(); r.SuggestForget || r.Class != ClassDPAPI {
		t.Fatalf("farklı kodda sayaç sıfırdan: %+v", r)
	}
	s.Unprotect = xorSeal
	if r := s.Migrate(); r.Status != StatusOK {
		t.Fatalf("hata geçince okunmalı: %+v", r)
	}
	lock, _ := os.ReadFile(filepath.Join(s.Dir, lockName))
	if len(lock) != 1 || lock[0] != 0 {
		t.Fatalf("başarılı okumada sayaç 0: %v", lock)
	}
	s.Unprotect = func([]byte) ([]byte, error) { return nil, errors.New("G/Ç") }
	if r := s.LoadState(); r.Status != StatusUnreadable || r.Class != ClassIO {
		t.Fatalf("sınıflandırılmamış hata sınıf 2: %+v", r)
	}
	if err := s.ForgetAll(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("ForgetAll okuma durumundan bağımsız silmeli: %v", dirNames(t, s.Dir))
	}
}

// G-P20-2/16: kilit başka tutucudayken okuma salt-okunur (lock_timeout), yazma görünür hata, unut yine siler.
func TestAC254GP2016LockTimeoutVisible(t *testing.T) {
	lockWait, lockPoll = 120*time.Millisecond, 10*time.Millisecond
	t.Cleanup(func() { lockWait, lockPoll = 2*time.Second, 50*time.Millisecond })
	s := store(t)
	_ = s.SaveBinding(sampleBinding(), "")
	f, err := os.OpenFile(filepath.Join(s.Dir, lockName), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if ok, err := tryLock(f); !ok || err != nil {
		t.Fatal("kilit alınamadı", err)
	}
	if r := s.LoadState(); r.Status != StatusUnreadable || r.Class != ClassLock {
		t.Fatalf("%+v", r)
	}
	if err := s.TouchBinding(testKey, day(5)); ErrorClass(err) != ClassLock || !errors.Is(err, ErrLockTimeout) {
		t.Fatalf("zaman aşımı görünür yazma hatası olmalı: %v", err)
	}
	if err := s.ForgetAll(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, fileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("kilit alınamasa da unut veri dosyasını silmeli")
	}
	unlock(f)
}

// Aynı süreçte eşzamanlı oku-değiştir-yaz (iki ayrı Store = iki ayrı kilit handle'ı): kayıp güncelleme yok.
func TestAC254GP202ConcurrentUpdatesNoLostWrite(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NoktaDestek")
	mk := func() *Store { return &Store{Dir: dir, Protect: xorSeal, Unprotect: xorSeal} }
	if err := mk().SaveBinding(bindingAt(home, 'A', day(1)), ""); err != nil {
		t.Fatal(err)
	}
	const n = 40
	var wg sync.WaitGroup
	for w := 0; w < 2; w++ {
		wg.Add(1)
		go func(s *Store) {
			defer wg.Done()
			for i := 0; i < n; i++ {
				if err := s.update(incr); err != nil {
					t.Error(err)
					return
				}
			}
		}(mk())
	}
	wg.Wait()
	d, _ := mk().Load()
	if got := d.Bindings[0].CustomerName; got != strconv.Itoa(2*n) {
		t.Fatalf("kayıp güncelleme: %s", got)
	}
}

// incr ilk kaydın müşteri adını sayaç olarak artırır (eşzamanlılık testleri).
func incr(d *Data) error {
	v, _ := strconv.Atoi(d.Bindings[0].CustomerName)
	d.Bindings[0].CustomerName = strconv.Itoa(v + 1)
	return nil
}

// G-P20-4: 10 öğe × azami alan uzunluğu × `&`/`<`/U+2028 ve 4 baytlık karakter yazılır ve geri okunur; ≤ 32 KB;
// HTML kaçışı kapalı.
func TestAC254GP204WorstCaseBudgetFixture(t *testing.T) {
	host := func(c string) string {
		return strings.Repeat(c, 63) + "." + strings.Repeat(c, 63) + "." + strings.Repeat(c, 63) + "." + strings.Repeat(c, 61)
	}
	origins := []string{"https://" + host("a") + ":65535", "https://" + host("b") + ":65534"}
	tenant := strings.Repeat("&😀<\u2028", 30) // 120 rune
	cust := strings.Repeat("&😀<\u2029", 25)   // 100 rune
	var bs []Binding
	for i := 0; i < 10; i++ {
		b := Binding{Server: origins[i%2], Key: key(byte('A' + i)), TenantName: tenant, CustomerName: cust,
			IssuedAt: day(1), LastUsedAt: day(i + 2)}
		if !b.valid() {
			t.Fatalf("fikstür öğesi geçerli olmalı: %d", len(b.Server))
		}
		bs = append(bs, b)
	}
	p := Personal{Name: strings.Repeat("&😀<\u2028", 20), Phone: "+123456789012345",
		Email: strings.Repeat("&", 254), DeviceKey: "AAAAAAAAAAAAAAAAAAAAAA"}
	d := Data{Personal: &p, Bindings: bs, Prefs: &Prefs{Tray: true}}
	plain, err := encode(d)
	if err != nil {
		t.Fatal(err)
	}
	if len(plain) > plainMax {
		t.Fatalf("bütçe aşıldı: %d", len(plain))
	}
	if bytes.Contains(plain, []byte("\\u0026")) || bytes.Contains(plain, []byte("\\u003c")) || !bytes.Contains(plain, []byte("&")) {
		t.Fatal("SetEscapeHTML(false) olmalı")
	}
	t.Logf("en kötü durum düz metin: %d bayt", len(plain))
	s := store(t)
	_ = s.SavePersonal(p)
	for _, b := range bs {
		if err := s.SaveBinding(b, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.SetPrefs(Prefs{Tray: true}); err != nil {
		t.Fatal(err)
	}
	r := s.LoadState()
	got, _ := encode(r.Data)
	if r.Status != StatusOK || r.Trimmed || !bytes.Equal(got, plain) {
		t.Fatalf("geri okuma eşit olmalı: %+v", r.Status)
	}
}

func TestAC254GP204WriteErrorsAreClassified(t *testing.T) {
	s := store(t)
	s.Protect = func([]byte) ([]byte, error) { return nil, errors.New("dpapi") }
	if err := s.SaveBinding(sampleBinding(), ""); ErrorClass(err) != ClassDPAPI {
		t.Fatalf("koruma hatası görünür olmalı: %v", err)
	}
	s = store(t)
	s.Protect = func([]byte) ([]byte, error) { return make([]byte, sealedMax+1), nil }
	if err := s.SaveBinding(sampleBinding(), ""); ErrorClass(err) != ClassTooLarge {
		t.Fatalf("128 KB üstü mühürlü veri yazılmamalı: %v", err)
	}
	b := sampleBinding()
	b.TenantName = strings.Repeat("ş", 121)
	if err := s.SaveBinding(b, ""); ErrorClass(err) != ClassInvalid {
		t.Fatalf("firma adı 120 karakteri aşmamalı: %v", err)
	}
	if ErrorClass(nil) != "" {
		t.Fatal("nil sınıfsız")
	}
}

func TestAC186ClearPersonalKeepsBindingsAndRenewsDeviceKey(t *testing.T) {
	s := store(t)
	_ = s.SaveBinding(sampleBinding(), "")
	_ = s.SavePersonal(samplePersonal())
	if err := s.ClearPersonal(); err != nil {
		t.Fatal(err)
	}
	d, ok := s.Load()
	if !ok || d.Personal != nil || len(d.Bindings) != 1 {
		t.Fatalf("Bilgilerimi unut kaydı korumalı: %+v %v", d, ok)
	}
	if strings.Contains(string(readPlain(t, s)), "deviceKey") {
		t.Fatal("G-E10-5: cihaz anahtarı kişisel bilgiyle silinmeli")
	}
	if err := s.RemoveBinding(testKey); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("iki alan da boşsa dosya ve boş klasör silinmeli")
	}
}

// §8d.4 "Bu bilgisayarı unut": iki dosya + tmp'ler + tanılama logu + kilit + boş klasör; idempotent.
func TestAC186AC254ForgetAllRemovesEverything(t *testing.T) {
	for _, withData := range []bool{true, false} {
		s := store(t)
		if withData {
			_ = s.SavePersonal(samplePersonal())
			_ = s.SaveBinding(sampleBinding(), "")
		}
		l := &diag.Log{Dir: s.Dir, Max: 200}
		for i := 0; i < 4; i++ { // dönmeye zorlar: tanilama.log + tanilama.log.1
			if err := l.Write(diag.Report{Event: diag.EventOpenFail, Reason: "DXGI_UNSUPPORTED"}); err != nil {
				t.Fatal(err)
			}
		}
		for _, n := range []string{tmpName, legacyName, legacyTmpName} {
			if err := os.WriteFile(filepath.Join(s.Dir, n), []byte("x"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.ForgetAll(); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("withData=%v: her şey silinip boş klasör kaldırılmalı: %v", withData, dirNames(t, s.Dir))
		}
		if err := s.ForgetAll(); err != nil {
			t.Fatal("dosya yokken unut hata vermemeli (idempotent)")
		}
	}
}

// QA#2: veri boşaltan her yol tanılama logunu da siler; veri kalıyorsa log kalır.
func TestAC185AC137ClearPathsRemoveDiagnosticsLog(t *testing.T) {
	writeLog := func(s *Store) {
		if err := (&diag.Log{Dir: s.Dir}).Write(diag.Report{Event: diag.EventOpenFail}); err != nil {
			t.Fatal(err)
		}
	}
	gone := func(s *Store) bool {
		_, err := os.Stat(filepath.Join(s.Dir, diag.FileName))
		return errors.Is(err, os.ErrNotExist)
	}
	s := store(t)
	_ = s.SavePersonal(samplePersonal())
	writeLog(s)
	if err := s.ClearPersonal(); err != nil || !gone(s) {
		t.Fatal("ClearPersonal (kayıt yok) logu silmeli")
	}
	s = store(t)
	_ = s.SaveBinding(sampleBinding(), "")
	writeLog(s)
	if err := s.RemoveBinding(testKey); err != nil || !gone(s) {
		t.Fatal("RemoveBinding (son öğe, kişisel bilgi yok) logu silmeli")
	}
	s = store(t)
	_ = s.SavePersonal(samplePersonal())
	_ = s.SaveBinding(sampleBinding(), "")
	writeLog(s)
	if err := s.RemoveBinding(testKey); err != nil || gone(s) {
		t.Fatal("kişisel bilgi kalıyorsa log kalmalı")
	}
}

func TestPersistentMode(t *testing.T) {
	s := store(t)
	if s.Persistent() {
		t.Fatal("dosya yokken kalıcı değil")
	}
	_ = s.SavePersonal(samplePersonal())
	if !s.Persistent() {
		t.Fatal("hatırla açıkken kalıcı")
	}
	_ = s.ClearPersonal()
	_ = s.SaveBinding(sampleBinding(), "")
	if !s.Persistent() {
		t.Fatal("kayıt varken kalıcı")
	}
	_ = s.ForgetAll()
	if s.Persistent() {
		t.Fatal("unut sonrası kalıcı değil")
	}
}

func TestAC137ForgetKeepsNonEmptyDir(t *testing.T) {
	s := store(t)
	_ = s.SavePersonal(samplePersonal())
	other := filepath.Join(s.Dir, "baska.txt")
	if err := os.WriteFile(other, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.ClearPersonal(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Fatal("klasör boş değilse dokunulmamalı")
	}
	if _, err := os.Stat(filepath.Join(s.Dir, fileName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("kayıt yokken Bilgilerimi unut dosyayı silmeli")
	}
}

func TestGE913StaleTmpRetriedOnce(t *testing.T) {
	s := store(t)
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, tmpName), []byte("eski"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePersonal(samplePersonal()); err != nil {
		t.Fatalf("kalan tmp silinip yeniden denenmeli: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, tmpName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("tmp kalmamalı")
	}
	if _, ok := s.Load(); !ok {
		t.Fatal("yeni dosya okunmalı")
	}
}

func TestSaveRejectsInvalidData(t *testing.T) {
	s := store(t)
	if err := s.SavePersonal(Personal{Name: "A", Phone: "0532", DeviceKey: "x"}); err == nil {
		t.Fatal("geçersiz kişisel bilgi yazılmamalı")
	}
	b := sampleBinding()
	b.Server = "https://remote.noktabilisim.net" // kanonik değil (port yok)
	if err := s.SaveBinding(b, ""); err == nil {
		t.Fatal("kanonik olmayan köken yazılmamalı")
	}
	b = sampleBinding()
	b.Key = "rsb_short"
	if err := s.SaveBinding(b, ""); err == nil {
		t.Fatal("biçimsiz anahtar yazılmamalı")
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("geçersiz veride klasör oluşmamalı")
	}
}

func TestGE106CanonicalOrigin(t *testing.T) {
	ok := map[string]string{
		"https://remote.noktabilisim.net":      "https://remote.noktabilisim.net:443",
		"https://REMOTE.NoktaBilisim.NET/":     "https://remote.noktabilisim.net:443",
		"https://remote.noktabilisim.net.":     "https://remote.noktabilisim.net:443",
		"https://remote.noktabilisim.net:443":  "https://remote.noktabilisim.net:443",
		"https://remote.noktabilisim.net:0443": "https://remote.noktabilisim.net:443",
		"HTTPS://remote.noktabilisim.net":      "https://remote.noktabilisim.net:443",
		"https://185.126.217.99:4450":          "https://185.126.217.99:4450",
		"https://[2001:DB8::1]:8443":           "https://[2001:db8::1]:8443",
		"https://xn--bcher-kva.example:443":    "https://xn--bcher-kva.example:443",
		"https://XN--BCHER-KVA.example.":       "https://xn--bcher-kva.example:443",
	}
	for in, want := range ok {
		got, valid := CanonicalOrigin(in)
		if !valid || got != want {
			t.Errorf("%s → %q %v, beklenen %q", in, got, valid, want)
		}
	}
	for _, in := range []string{
		"http://remote.noktabilisim.net", "https://user@remote.noktabilisim.net", "https://u:p@remote.noktabilisim.net",
		"https://remote.noktabilisim.net/api", "https://remote.noktabilisim.net?x=1", "https://remote.noktabilisim.net?",
		"https://remote.noktabilisim.net#x", "https://remote.noktabilisim.net:", "https://remote.noktabilisim.net:70000",
		"https://", "https://.", "remote.noktabilisim.net", "", "https:remote", "https://a b.example",
		// IDN (Unicode host) fail-closed: kayıt kullanılmaz (S1 sapması — x/net/idna yeni modül ister).
		"https://bücher.example", "https://BÜCHER.example.", "https://-a.example", "https://a..example",
		"https://a_b.example",
	} {
		if got, valid := CanonicalOrigin(in); valid {
			t.Errorf("%s reddedilmeliydi, %q döndü", in, got)
		}
	}
}

func TestAC188NoticeText(t *testing.T) {
	want := "Oturumdan sonra bu bilgisayar Demo için hatırlanır; istediğinizde 'Bu bilgisayarı unut' ile silebilirsiniz."
	if got := NoticeText("Demo"); got != want {
		t.Fatal(got)
	}
}
