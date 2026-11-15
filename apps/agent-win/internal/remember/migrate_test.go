package remember

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

const (
	legacyV1 = `{"v":1,"name":"Ayşe Yılmaz","phone":"+905321234567","email":"ayse@example.com","deviceKey":"Ab0_-Ab0_-Ab0_-Ab0_-Ab"}`
	legacyV2 = `{"v":2,"personal":{"name":"Ayşe Yılmaz","phone":"+905321234567","email":"ayse@example.com"},` +
		`"binding":{"server":"https://remote.noktabilisim.net:443","key":"` + testKey + `","tenantName":"Nokta Bilişim",` +
		`"customerName":"Örnek Müşteri A.Ş.","issuedAt":"2026-11-12T10:00:00Z"},"deviceKey":"Ab0_-Ab0_-Ab0_-Ab0_-Ab"}`
)

func exists(t *testing.T, s *Store, name string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(s.Dir, name))
	return err == nil
}

// AC-254 göç v1/v2 → v3 alan alan eşit ("kayıpsız"); hatirla.bin silinir; idempotent.
func TestAC254MigrateV1V2Lossless(t *testing.T) {
	want := sampleBinding()
	want.LastUsedAt = want.IssuedAt
	for name, content := range map[string]string{"v1": legacyV1, "v2": legacyV2} {
		s := store(t)
		writeNamed(t, s, legacyName, content)
		writeNamed(t, s, legacyTmpName, "x")
		r := s.Migrate()
		if r.Status != StatusOK || r.Failed || r.Blocked != "" {
			t.Fatalf("%s: %+v", name, r)
		}
		if r.Data.Personal == nil || *r.Data.Personal != samplePersonal() {
			t.Fatalf("%s: kişisel bilgi eşit olmalı: %+v", name, r.Data.Personal)
		}
		if name == "v2" && (len(r.Data.Bindings) != 1 || r.Data.Bindings[0] != want) {
			t.Fatalf("v2: kayıt eşit olmalı (lastUsedAt = issuedAt): %+v", r.Data.Bindings)
		}
		if name == "v1" && len(r.Data.Bindings) != 0 {
			t.Fatal("v1'de kayıt yok")
		}
		if exists(t, s, legacyName) || exists(t, s, legacyTmpName) {
			t.Fatalf("%s: hatirla.bin (+tmp) silinmeli", name)
		}
		again := s.Migrate()
		if again.Status != StatusOK || !exists(t, s, fileName) {
			t.Fatalf("%s: idempotent: %+v", name, again)
		}
	}
}

// Geri okuma tutmazsa kayitlar.bin silinir, hatirla.bin dokunulmadan kalır (sonraki açılışta yeniden denenir).
func TestAC254MigrateReadBackFailureKeepsLegacy(t *testing.T) {
	s := store(t)
	writeNamed(t, s, legacyName, legacyV2)
	s.Protect = func(b []byte) ([]byte, error) { out, _ := xorSeal(b); return append(out, 0), nil } // bozuk mühür
	r := s.Migrate()
	if !r.Failed || r.Status != StatusAbsent {
		t.Fatalf("%+v", r)
	}
	if exists(t, s, fileName) || !exists(t, s, legacyName) {
		t.Fatal("kayitlar.bin silinmeli, hatirla.bin kalmalı")
	}
	s.Protect = xorSeal
	if r := s.Migrate(); r.Failed || r.Status != StatusOK || exists(t, s, legacyName) {
		t.Fatalf("sonraki açılışta göç tamamlanmalı: %+v", r)
	}
}

// Yarım göç / eski sürümün sonradan yazdığı hatirla.bin birleştirilir: personal yalnız v3'te yoksa; anahtar yoksa
// ve yer varsa eklenir.
func TestAC254MigrateMergesLegacyWrittenLater(t *testing.T) {
	s := store(t)
	other := Personal{Name: "Mehmet", Phone: "+905551112233", DeviceKey: "Zz0_-Zz0_-Zz0_-Zz0_-Zz"}
	_ = s.SavePersonal(other)
	_ = s.SaveBinding(bindingAt(home, 'B', day(1)), "")
	writeNamed(t, s, legacyName, legacyV2)
	r := s.Migrate()
	if r.Status != StatusOK || r.Blocked != "" || len(r.Data.Bindings) != 2 || !hasKey(r.Data.Bindings, testKey) {
		t.Fatalf("eski kayıt eklenmeli: %+v", r)
	}
	if *r.Data.Personal != other {
		t.Fatal("v3'teki kişisel bilgi korunmalı")
	}
	if exists(t, s, legacyName) {
		t.Fatal("birleştirme sonrası hatirla.bin silinmeli")
	}
	// Anahtar zaten varsa yalnız eski dosya silinir.
	writeNamed(t, s, legacyName, legacyV2)
	if r := s.Migrate(); len(r.Data.Bindings) != 2 || exists(t, s, legacyName) {
		t.Fatalf("aynı anahtar eklenmez: %+v", r.Data.Bindings)
	}
	// v3'te kişisel bilgi yoksa eskiden alınır.
	s2 := store(t)
	_ = s2.SaveBinding(bindingAt(home, 'B', day(1)), "")
	writeNamed(t, s2, legacyName, legacyV1)
	if r := s2.Migrate(); r.Data.Personal == nil || *r.Data.Personal != samplePersonal() {
		t.Fatalf("kişisel bilgi alınmalı: %+v", r.Data)
	}
}

// K-P20-5: köken 5 doluyken eski kayıt eklenmez, hatirla.bin dokunulmadan kalır ve bilgi döner.
func TestAC254MigrateFullKeepsLegacyAndNotifies(t *testing.T) {
	s := store(t)
	for i, c := range []byte("BCDEF") {
		_ = s.SaveBinding(bindingAt(home, c, day(i+1)), "")
	}
	writeNamed(t, s, legacyName, legacyV2)
	before, _ := os.ReadFile(filepath.Join(s.Dir, legacyName))
	r := s.Migrate()
	if r.Blocked != "Nokta Bilişim" || len(r.Data.Bindings) != 5 || hasKey(r.Data.Bindings, testKey) {
		t.Fatalf("%+v", r)
	}
	if r.Data.Personal == nil {
		t.Fatal("kişisel bilgi yine birleştirilir")
	}
	after, _ := os.ReadFile(filepath.Join(s.Dir, legacyName))
	if string(before) != string(after) {
		t.Fatal("hatirla.bin dokunulmadan kalmalı")
	}
	_ = s.RemoveBinding(key('B'))
	if r := s.Migrate(); r.Blocked != "" || !hasKey(r.Data.Bindings, testKey) || exists(t, s, legacyName) {
		t.Fatalf("yer açılınca eklenmeli: %+v", r)
	}
}

// G-P20-3: hatirla.bin kesin biçim hatası → silinir; geçici hata → dokunulmaz; kayitlar.bin okunamıyorsa hiçbir
// dosyaya dokunulmaz.
func TestAC254MigrateLegacyErrorClasses(t *testing.T) {
	s := store(t)
	writeNamed(t, s, legacyName, `{"v":9}`)
	if r := s.Migrate(); r.Status != StatusAbsent || exists(t, s, legacyName) {
		t.Fatalf("biçim hatalı eski dosya silinmeli: %+v", r)
	}
	s = store(t)
	writeNamed(t, s, legacyName, legacyV2)
	s.UnprotectLegacy = func([]byte) ([]byte, error) { return nil, errKeyState }
	if r := s.Migrate(); r.Status != StatusAbsent || !exists(t, s, legacyName) || exists(t, s, fileName) {
		t.Fatalf("geçici hatada eski dosya kalmalı: %+v", r)
	}
	s = store(t)
	_ = s.SaveBinding(sampleBinding(), "")
	writeNamed(t, s, legacyName, legacyV1)
	s.Unprotect = func([]byte) ([]byte, error) { return nil, errors.New("G/Ç") }
	if r := s.Migrate(); r.Status != StatusUnreadable || !exists(t, s, legacyName) {
		t.Fatalf("v3 okunamıyorsa göç yok: %+v", r)
	}
	s.UnprotectLegacy = nil
	s.Unprotect = xorSeal
	if r := s.Migrate(); !exists(t, s, legacyName) || r.Status != StatusOK {
		t.Fatal("eski çözücü yoksa göç yapılmaz")
	}
}

// Migrate klasör yoksa iz bırakmaz (AC-108).
func TestAC254MigrateNoDirNoTrace(t *testing.T) {
	s := store(t)
	if r := s.Migrate(); r.Status != StatusAbsent {
		t.Fatal(r)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("klasör oluşmamalı")
	}

}
