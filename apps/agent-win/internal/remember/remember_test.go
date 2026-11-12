package remember

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
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
	return &Store{Dir: filepath.Join(t.TempDir(), "NoktaDestek"), Protect: xorSeal, Unprotect: xorSeal}
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

func writePlain(t *testing.T, s *Store, plain string) {
	t.Helper()
	sealed, _ := xorSeal([]byte(plain))
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, fileName), sealed, 0o600); err != nil {
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

func TestAC136SaveLoadOnlyAllowedFields(t *testing.T) {
	s := store(t)
	if _, ok := s.Load(); ok {
		t.Fatal("dosya yokken veri dönmemeli")
	}
	p := samplePersonal()
	if err := s.SavePersonal(p); err != nil {
		t.Fatal(err)
	}
	ents, _ := os.ReadDir(s.Dir)
	if len(ents) != 1 || ents[0].Name() != "hatirla.bin" {
		t.Fatalf("klasörde yalnız hatirla.bin olmalı: %v", ents)
	}
	raw, _ := os.ReadFile(filepath.Join(s.Dir, "hatirla.bin"))
	if bytes.Contains(raw, []byte("905321234567")) {
		t.Error("dosya korumasız yazılmış")
	}
	plain := readPlain(t, s)
	for _, k := range []string{"description", "requestSecret", "ref", "consent"} {
		if bytes.Contains(plain, []byte(`"`+k)) {
			t.Errorf("%s yazılmamalı", k)
		}
	}
	if !bytes.HasPrefix(plain, []byte(`{"v":2,`)) {
		t.Errorf("v2 yazılmalı: %s", plain)
	}
	got, ok := s.LoadPersonal()
	if !ok || got != p {
		t.Fatalf("%+v %v", got, ok)
	}
}

func TestAC181V2BindingAndPersonalCoexist(t *testing.T) {
	s := store(t)
	b := sampleBinding()
	if err := s.SaveBinding(b); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.LoadPersonal(); ok {
		t.Fatal("yalnız kayıt varken kişisel bilgi dönmemeli")
	}
	if err := s.SavePersonal(samplePersonal()); err != nil {
		t.Fatal(err)
	}
	d, ok := s.Load()
	if !ok || d.Binding == nil || *d.Binding != b || d.Personal == nil || *d.Personal != samplePersonal() {
		t.Fatalf("kişisel kayıt kaydı silmemeli: %+v", d)
	}
	plain := string(readPlain(t, s))
	for _, want := range []string{`"binding":{"server":"https://remote.noktabilisim.net:443"`, `"deviceKey":"Ab0_-Ab0_-Ab0_-Ab0_-Ab"`,
		`"issuedAt":"2026-11-12T10:00:00Z"`, `"personal":{"name":"Ayşe Yılmaz"`} {
		if !strings.Contains(plain, want) {
			t.Errorf("dosyada %s yok: %s", want, plain)
		}
	}
}

func TestAC187SaveBindingOverwritesSingleRecord(t *testing.T) {
	s := store(t)
	_ = s.SaveBinding(sampleBinding())
	n := sampleBinding()
	n.Key, n.TenantName, n.CustomerName = "rsb_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "Başka Firma", ""
	if err := s.SaveBinding(n); err != nil {
		t.Fatal(err)
	}
	d, _ := s.Load()
	if d.Binding == nil || *d.Binding != n {
		t.Fatalf("tek kayıt üzerine yazılmalı: %+v", d.Binding)
	}
}

func TestAC181V1FileUpgradedInMemoryWrittenAsV2(t *testing.T) {
	s := store(t)
	writePlain(t, s, `{"v":1,"name":"Ayşe Yılmaz","phone":"+905321234567","email":"ayse@example.com","deviceKey":"Ab0_-Ab0_-Ab0_-Ab0_-Ab"}`)
	d, ok := s.Load()
	if !ok || d.Binding != nil || d.Personal == nil || *d.Personal != samplePersonal() {
		t.Fatalf("v1 okunup yükseltilmeli: %+v %v", d, ok)
	}
	if !bytes.HasPrefix(readPlain(t, s), []byte(`{"v":1,`)) {
		t.Fatal("yalnız okumada dosya yeniden yazılmamalı")
	}
	if err := s.SaveBinding(sampleBinding()); err != nil {
		t.Fatal(err)
	}
	plain := readPlain(t, s)
	if !bytes.HasPrefix(plain, []byte(`{"v":2,`)) {
		t.Fatalf("ilk yazımda v2 olmalı: %s", plain)
	}
	d, _ = s.Load()
	if d.Personal == nil || *d.Personal != samplePersonal() || d.Binding == nil {
		t.Fatalf("yükseltmede kişisel bilgi korunmalı: %+v", d)
	}
}

func TestAC186ClearPersonalKeepsBindingAndRenewsDeviceKey(t *testing.T) {
	s := store(t)
	_ = s.SaveBinding(sampleBinding())
	_ = s.SavePersonal(samplePersonal())
	if err := s.ClearPersonal(); err != nil {
		t.Fatal(err)
	}
	d, ok := s.Load()
	if !ok || d.Personal != nil || d.Binding == nil {
		t.Fatalf("Bilgilerimi unut kaydı korumalı: %+v %v", d, ok)
	}
	if strings.Contains(string(readPlain(t, s)), "deviceKey") {
		t.Fatal("G-E10-5: cihaz anahtarı kişisel bilgiyle silinmeli (sonraki hatırlamada yenisi)")
	}
	if err := s.ClearBinding(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("iki alan da boşsa dosya ve boş klasör silinmeli")
	}
}

func TestAC185ClearBindingKeepsPersonal(t *testing.T) {
	s := store(t)
	_ = s.SavePersonal(samplePersonal())
	_ = s.SaveBinding(sampleBinding())
	if err := s.ClearBinding(); err != nil {
		t.Fatal(err)
	}
	d, ok := s.Load()
	if !ok || d.Binding != nil || d.Personal == nil {
		t.Fatalf("geçersiz kayıt silinmeli, kişisel bilgi kalmalı: %+v", d)
	}
}

func TestAC186ForgetAllRemovesFileTmpAndEmptyDir(t *testing.T) {
	s := store(t)
	_ = s.SavePersonal(samplePersonal())
	_ = s.SaveBinding(sampleBinding())
	if err := os.WriteFile(filepath.Join(s.Dir, "hatirla.bin.tmp"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.ForgetAll(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("boş klasör silinmeli")
	}
	if err := s.ForgetAll(); err != nil {
		t.Fatal("dosya yokken unut hata vermemeli (idempotent)")
	}
}

// TestAC186ForgetAllRemovesDiagnosticsLog 0.10.2: "Bu bilgisayarı unut" tanılama logunu (ve dönen kopyasını) da siler;
// yalnız log varken (hatırlama yok) de klasör boşalıp silinir.
func TestAC186ForgetAllRemovesDiagnosticsLog(t *testing.T) {
	for _, withData := range []bool{true, false} {
		s := store(t)
		if withData {
			_ = s.SaveBinding(sampleBinding())
		}
		l := &diag.Log{Dir: s.Dir, Max: 200}
		for i := 0; i < 4; i++ { // dönmeye zorlar: tanilama.log + tanilama.log.1
			if err := l.Write(diag.Report{Event: diag.EventOpenFail, Reason: "DXGI_UNSUPPORTED"}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := os.Stat(filepath.Join(s.Dir, diag.OldName)); err != nil {
			t.Fatal("dönen log oluşmalı:", err)
		}
		if err := s.ForgetAll(); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("withData=%v: log ve kayıt silinip boş klasör kaldırılmalı", withData)
		}
	}
}

// QA#2 (kabul edilen davranış): veri boşaltan her yol (forgetAll) — "Bilgilerimi unut" kayıt yokken (ClearPersonal)
// ve geçersiz kayıt (ClearBinding, AC-185) kişisel bilgi yokken — tanılama logunu da siler. Veri kalıyorsa log kalır.
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
	_ = s.SaveBinding(sampleBinding())
	writeLog(s)
	if err := s.ClearBinding(); err != nil || !gone(s) {
		t.Fatal("ClearBinding (kişisel bilgi yok) logu silmeli")
	}
	s = store(t)
	_ = s.SavePersonal(samplePersonal())
	_ = s.SaveBinding(sampleBinding())
	writeLog(s)
	if err := s.ClearBinding(); err != nil || gone(s) {
		t.Fatal("kişisel bilgi kalıyorsa log kalmalı")
	}
}

// 0.10.2: kalıcı mod = kayıt veya hatırlanan kişisel bilgi var (tanılama logu yalnız bu durumda yazılır).
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
	_ = s.SaveBinding(sampleBinding())
	if !s.Persistent() {
		t.Fatal("kayıt varken kalıcı")
	}
	_ = s.ForgetAll()
	if s.Persistent() {
		t.Fatal("unut sonrası kalıcı değil")
	}
}

// TestAC137ForgetRemovesFileAndEmptyDir P8b-2 testinin eşdeğeri: "Bilgilerimi unut" (kayıt yokken) dosyayı, tmp'yi
// ve boş klasörü siler; dosya yokken hata vermez. API v2'de Forget → ClearPersonal (AC-186: kayıt varsa korur).
func TestAC137ForgetRemovesFileAndEmptyDir(t *testing.T) {
	s := store(t)
	if err := s.SavePersonal(samplePersonal()); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, "hatirla.bin.tmp"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.ClearPersonal(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("boş klasör silinmeli")
	}
	if err := s.ClearPersonal(); err != nil {
		t.Fatal("dosya yokken unut hata vermemeli")
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
	if err := os.WriteFile(filepath.Join(s.Dir, "hatirla.bin.tmp"), []byte("eski"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.SavePersonal(samplePersonal()); err != nil {
		t.Fatalf("kalan tmp silinip yeniden denenmeli: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "hatirla.bin.tmp")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("tmp kalmamalı")
	}
	if _, ok := s.Load(); !ok {
		t.Fatal("yeni dosya okunmalı")
	}
}

func TestAC136CorruptOrForeignFileDeletedSilently(t *testing.T) {
	const pv1 = `"name":"A","phone":"+905321234567","deviceKey":"AAAAAAAAAAAAAAAAAAAAAA"`
	const bind = `"binding":{"server":"https://a.example:443","key":"` + testKey + `","tenantName":"F","issuedAt":"2026-11-12T10:00:00Z"}`
	for name, content := range map[string]string{
		"çözülemez":                  "",
		"bozuk json":                 "{",
		"v1 bilinmeyen alan":         `{"v":1,` + pv1 + `,"description":"x"}`,
		"yanlış sürüm":               `{"v":2,` + pv1 + `}`,
		"bilinmeyen sürüm":           `{"v":3,` + bind + `}`,
		"v2 boş":                     `{"v":2}`,
		"v2 anahtarsız kişi":         `{"v":2,"personal":{"name":"A","phone":"+905321234567"}}`,
		"v2 kişisiz anahtar":         `{"v":2,` + bind + `,"deviceKey":"AAAAAAAAAAAAAAAAAAAAAA"}`,
		"v2 kayıt biçimsiz anahtar":  `{"v":2,"binding":{"server":"https://a.example:443","key":"rsb_x","tenantName":"F","issuedAt":"2026-11-12T10:00:00Z"}}`,
		"v2 kayıt kanonik değil":     `{"v":2,"binding":{"server":"https://A.example","key":"` + testKey + `","tenantName":"F","issuedAt":"2026-11-12T10:00:00Z"}}`,
		"v2 kayıt bilinmeyen alan":   `{"v":2,"binding":{"server":"https://a.example:443","key":"` + testKey + `","tenantName":"F","issuedAt":"2026-11-12T10:00:00Z","x":1}}`,
		"v2 kayıt kontrol karakteri": `{"v":2,"binding":{"server":"https://a.example:443","key":"` + testKey + `","tenantName":"F‮","issuedAt":"2026-11-12T10:00:00Z"}}`,
	} {
		s := store(t)
		if content == "" {
			s.Unprotect = func([]byte) ([]byte, error) { return nil, errors.New("başka kullanıcı") }
			content = "x"
		}
		writePlain(t, s, content)
		if _, ok := s.Load(); ok {
			t.Errorf("%s: geçersiz sayılmalı", name)
		}
		if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s: dosya ve boş klasör silinmeli", name)
		}
	}
	s := store(t)
	writePlain(t, s, `{"v":2,`+bind+`}`)
	if d, ok := s.Load(); !ok || d.Binding == nil || d.Binding.CustomerName != "" {
		t.Fatalf("geçerli Genel kayıt okunmalı: %+v %v", d, ok)
	}
}

func TestSaveRejectsInvalidData(t *testing.T) {
	s := store(t)
	if err := s.SavePersonal(Personal{Name: "A", Phone: "0532", DeviceKey: "x"}); err == nil {
		t.Fatal("geçersiz kişisel bilgi yazılmamalı")
	}
	b := sampleBinding()
	b.Server = "https://remote.noktabilisim.net" // kanonik değil (port yok)
	if err := s.SaveBinding(b); err == nil {
		t.Fatal("kanonik olmayan köken yazılmamalı")
	}
	b = sampleBinding()
	b.Key = "rsb_short"
	if err := s.SaveBinding(b); err == nil {
		t.Fatal("biçimsiz anahtar yazılmamalı")
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("geçersiz veride klasör oluşmamalı")
	}
}

func TestPlainTextLimit(t *testing.T) {
	s := store(t)
	b := sampleBinding()
	b.TenantName = strings.Repeat("ş", 121)
	if err := s.SaveBinding(b); err == nil {
		t.Fatal("firma adı 120 karakteri aşmamalı")
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
