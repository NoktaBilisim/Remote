package remember

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
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

// sample deviceKey üretimi request.newKey'dedir (QA-P8b2-1); depo yalnız biçimi denetler.
func sample(t *testing.T) Data {
	t.Helper()
	return Data{Name: "Ayşe Yılmaz", Phone: "+905321234567", Email: "ayse@example.com", DeviceKey: "Ab0_-Ab0_-Ab0_-Ab0_-Ab"}
}

func TestAC136SaveLoadOnlyAllowedFields(t *testing.T) {
	s := store(t)
	if _, ok := s.Load(); ok {
		t.Fatal("dosya yokken veri dönmemeli")
	}
	d := sample(t)
	if err := s.Save(d); err != nil {
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
	plain, _ := xorSeal(raw)
	for _, k := range []string{"description", "requestSecret", "ref", "consent"} {
		if bytes.Contains(plain, []byte(k)) {
			t.Errorf("%s yazılmamalı", k)
		}
	}
	got, ok := s.Load()
	d.V = 1
	if !ok || got != d {
		t.Fatalf("%+v %v", got, ok)
	}
}

func TestAC137ForgetRemovesFileAndEmptyDir(t *testing.T) {
	s := store(t)
	if err := s.Save(sample(t)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.Dir, "hatirla.bin.tmp"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Forget(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("boş klasör silinmeli")
	}
	if err := s.Forget(); err != nil {
		t.Fatal("dosya yokken unut hata vermemeli")
	}
}

func TestAC137ForgetKeepsNonEmptyDir(t *testing.T) {
	s := store(t)
	if err := s.Save(sample(t)); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(s.Dir, "baska.txt")
	if err := os.WriteFile(other, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := s.Forget(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Fatal("klasör boş değilse dokunulmamalı")
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
	if err := s.Save(sample(t)); err != nil {
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
	for name, content := range map[string][]byte{
		"çözülemez":       nil,
		"bozuk json":      []byte("{"),
		"bilinmeyen alan": []byte(`{"v":1,"name":"A","phone":"+905321234567","deviceKey":"AAAAAAAAAAAAAAAAAAAAAA","description":"x"}`),
		"yanlış sürüm":    []byte(`{"v":2,"name":"A","phone":"+905321234567","deviceKey":"AAAAAAAAAAAAAAAAAAAAAA"}`),
	} {
		s := store(t)
		if content == nil {
			s.Unprotect = func([]byte) ([]byte, error) { return nil, errors.New("başka kullanıcı") }
			content = []byte("x")
		}
		sealed, _ := xorSeal(content)
		_ = os.MkdirAll(s.Dir, 0o700)
		_ = os.WriteFile(filepath.Join(s.Dir, "hatirla.bin"), sealed, 0o600)
		if _, ok := s.Load(); ok {
			t.Errorf("%s: geçersiz sayılmalı", name)
		}
		if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s: dosya ve boş klasör silinmeli", name)
		}
	}
}

func TestSaveRejectsInvalidData(t *testing.T) {
	s := store(t)
	if err := s.Save(Data{Name: "A", Phone: "0532", DeviceKey: "x"}); err == nil {
		t.Fatal("geçersiz veri yazılmamalı")
	}
	if _, err := os.Stat(s.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("geçersiz veride klasör oluşmamalı")
	}
}
