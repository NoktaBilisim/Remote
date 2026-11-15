package autorun

import (
	"errors"
	"os"
	"strings"
	"testing"
)

type regValue struct {
	val  string
	kind Kind
}

type fakeReg struct {
	vals     map[string]regValue
	approved map[string][]byte
	writes   int
	deletes  int
	readErr  error
}

func newReg() *fakeReg {
	return &fakeReg{vals: map[string]regValue{}, approved: map[string][]byte{}}
}

func (r *fakeReg) Read(name string) (string, Kind, error) {
	if r.readErr != nil {
		return "", 0, r.readErr
	}
	v, ok := r.vals[name]
	if !ok {
		return "", 0, ErrNotFound
	}
	if v.kind != KindString {
		return "", KindOther, nil
	}
	return v.val, KindString, nil
}

func (r *fakeReg) WriteString(name, val string) error {
	if v, ok := r.vals[name]; ok && v.kind != KindString {
		return errors.New("tür değiştirilmeden yazılmamalı (sahte: önce silinmeli)")
	}
	r.writes++
	r.vals[name] = regValue{val, KindString}
	return nil
}

func (r *fakeReg) Delete(name string) error {
	r.deletes++
	delete(r.vals, name)
	return nil
}

func (r *fakeReg) Approved(name string) ([]byte, error) {
	if d, ok := r.approved[name]; ok {
		return d, nil
	}
	return nil, ErrNotFound
}

type fakeProbe struct {
	elevated bool
	self     string
	targets  map[string]Target // anahtar: Inspect'e verilen yol
	inspects int
	envErr   error
}

func (p *fakeProbe) Elevated() bool        { return p.elevated }
func (p *fakeProbe) Self() (string, error) { return p.self, nil }
func (p *fakeProbe) Env() (Env, error)     { return testEnv, p.envErr }
func (p *fakeProbe) Inspect(path string) (Target, error) {
	p.inspects++
	t, ok := p.targets[path]
	if !ok {
		return Target{}, os.ErrNotExist
	}
	return t, nil
}

const dl = `C:\Users\u\Downloads\x.exe`

func newManager(self string, targets ...Target) (*Manager, *fakeReg, *fakeProbe) {
	pr := &fakeProbe{self: self, targets: map[string]Target{}}
	for _, t := range targets {
		pr.targets[t.Path] = t
	}
	reg := newReg()
	return &Manager{Reg: reg, Probe: pr}, reg, pr
}

func weakDownloads() Target {
	t := downloadsTarget()
	t.Chain[3].ACEs = append(t.Chain[3].ACEs, allow(sidUsers, maskM, 0))
	return t
}

func TestAC253CommandFormat(t *testing.T) {
	for _, p := range []string{dl, `C:\Program Files\Nokta %USERNAME%\Destek-1.exe`, `D:\a b\%PATH%\x.exe`} {
		c := Command(p)
		if c != `"`+p+`" --tray` {
			t.Fatalf("biçim: %s", c)
		}
		got, ok := ParseCommand(c)
		if !ok || got != p {
			t.Fatalf("geri ayrıştırma: %q %v", got, ok)
		}
	}
	for _, bad := range []string{
		dl, `"` + dl + `"`, `"` + dl + `" --tray `, `"` + dl + `" /tray`, `"` + dl + `" --tray=1`,
		`"` + dl + `" --tray x`, `"` + dl + `"--tray`, `""` + ` --tray`, `"C:\a"b.exe" --tray`,
	} {
		if _, ok := ParseCommand(bad); ok {
			t.Errorf("kabul edilmemeli: %s", bad)
		}
	}
}

func TestAC253NormalizePath(t *testing.T) {
	ok := map[string]string{
		`\\?\C:\Users\u\Downloads\x.exe`: dl,
		dl:                               dl,
		`\\?\D:\a b\%x%\y.exe`:           `D:\a b\%x%\y.exe`,
	}
	for in, want := range ok {
		got, err := NormalizePath(in)
		if err != nil || got != want {
			t.Errorf("%s → %q %v", in, got, err)
		}
	}
	for _, bad := range []string{
		`\\?\UNC\srv\share\x.exe`, `\\srv\share\x.exe`, `\\.\C:\x.exe`, `C:\a"b\x.exe`, `C:x.exe`, `x.exe`,
		`\\?\Volume{1234}\x.exe`, `C:\a\`, `C:\a\\b.exe`, "C:\\a\nb.exe", `C:/a/b.exe`, `1:\a.exe`, ``,
	} {
		if _, err := NormalizePath(bad); !errors.Is(err, ErrBadPath) {
			t.Errorf("reddedilmeli: %q", bad)
		}
	}
	if got := Components(dl); strings.Join(got, "|") != `C:\|C:\Users|C:\Users\u|C:\Users\u\Downloads|`+dl {
		t.Fatalf("bileşenler %v", got)
	}
}

func TestAC253EnableWritesRegSZ(t *testing.T) {
	m, reg, _ := newManager(`\\?\`+dl, downloadsTarget())
	r, err := m.Enable()
	if err != nil || r != ReasonOK {
		t.Fatalf("Enable: %v %v", r, err)
	}
	if v := reg.vals[ValueName]; v.kind != KindString || v.val != `"`+dl+`" --tray` {
		t.Fatalf("değer %+v", v)
	}
	st, err := m.State()
	if err != nil || !st.On || st.Other || st.Blocked != ReasonOK || st.DisabledInWindows {
		t.Fatalf("State %+v %v", st, err)
	}
}

func TestAC253EnableRejections(t *testing.T) {
	t.Run("yükseltilmiş süreç yazmaz ve dokunmaz", func(t *testing.T) {
		m, reg, pr := newManager(dl, downloadsTarget())
		pr.elevated = true
		reg.vals[ValueName] = regValue{Command(dl), KindString}
		r, err := m.Enable()
		if err != nil || r != ReasonElevated || reg.writes != 0 || reg.deletes != 0 {
			t.Fatalf("%v %v w=%d d=%d", r, err, reg.writes, reg.deletes)
		}
		st, _ := m.State()
		if st.Blocked != ReasonElevated || !st.On {
			t.Fatalf("State %+v", st)
		}
	})
	t.Run("UNC yolu", func(t *testing.T) {
		m, reg, pr := newManager(`\\?\UNC\srv\paylasim\x.exe`)
		r, _ := m.Enable()
		if r != ReasonBadPath || reg.writes != 0 || pr.inspects != 0 {
			t.Fatalf("%v w=%d i=%d", r, reg.writes, pr.inspects)
		}
	})
	t.Run("tırnaklı yol", func(t *testing.T) {
		m, reg, _ := newManager(`C:\a"b\x.exe`)
		if r, _ := m.Enable(); r != ReasonBadPath || reg.writes != 0 {
			t.Fatalf("%v", r)
		}
	})
	t.Run("zayıf ACL: ret ve bu exe'nin mevcut değeri silinir", func(t *testing.T) {
		m, reg, _ := newManager(dl, weakDownloads())
		reg.vals[ValueName] = regValue{Command(dl), KindString}
		r, err := m.Enable()
		if err != nil || r != ReasonWeakACL || reg.writes != 0 {
			t.Fatalf("%v %v", r, err)
		}
		if _, ok := reg.vals[ValueName]; ok {
			t.Fatal("mevcut değer silinmeliydi")
		}
		if !strings.Contains(r.Message(), "başka kullanıcılar yazabiliyor") {
			t.Fatalf("mesaj %q", r.Message())
		}
	})
	t.Run("ret başka geçerli yolu gösteren değere dokunmaz", func(t *testing.T) {
		m, reg, _ := newManager(dl, weakDownloads())
		other := Command(`C:\Users\u\Araclar\x.exe`)
		reg.vals[ValueName] = regValue{other, KindString}
		if r, _ := m.Enable(); r != ReasonWeakACL || reg.vals[ValueName].val != other {
			t.Fatalf("%v %+v", r, reg.vals)
		}
	})
	t.Run("geçici konum", func(t *testing.T) {
		p := `C:\Users\u\AppData\Local\Temp\Temp1_d.zip\x.exe`
		m, reg, _ := newManager(p, Target{Path: p, DriveFixed: true})
		if r, _ := m.Enable(); r != ReasonTempLocation || reg.writes != 0 {
			t.Fatalf("%v", r)
		}
	})
	t.Run("denetlenemeyen hedef", func(t *testing.T) {
		m, reg, pr := newManager(dl, downloadsTarget())
		pr.envErr = errors.New("belirteç okunamadı")
		if r, err := m.Enable(); r != ReasonCheckFailed || err == nil || reg.writes != 0 {
			t.Fatalf("%v %v", r, err)
		}
	})
}

func TestAC253EnableLastLauncherWins(t *testing.T) {
	m, reg, _ := newManager(dl, downloadsTarget())
	reg.vals[ValueName] = regValue{Command(`C:\Users\u\Eski\Destek-0.11.exe`), KindString}
	st, _ := m.State()
	if st.On || !st.Other {
		t.Fatalf("başka yol: %+v", st)
	}
	if r, err := m.Enable(); r != ReasonOK || err != nil || reg.vals[ValueName].val != Command(dl) {
		t.Fatalf("%v %v %+v", r, err, reg.vals)
	}
	// REG_EXPAND_SZ (veya başka tür) silinip REG_SZ olarak yeniden yazılır.
	reg.vals[ValueName] = regValue{Command(dl), KindOther}
	if r, err := m.Enable(); r != ReasonOK || err != nil {
		t.Fatalf("%v %v", r, err)
	}
	if v := reg.vals[ValueName]; v.kind != KindString || v.val != Command(dl) {
		t.Fatalf("%+v", v)
	}
}

func TestAC253StartupApprovedReadOnly(t *testing.T) {
	m, reg, _ := newManager(dl, downloadsTarget())
	reg.vals[ValueName] = regValue{Command(dl), KindString}
	for data, want := range map[string]bool{"\x03\x00": true, "\x07": true, "\x02\x00": false, "\x06": false, "": false} {
		reg.approved[ValueName] = []byte(data)
		st, err := m.State()
		if err != nil || st.DisabledInWindows != want {
			t.Errorf("%x: %+v %v", data, st, err)
		}
	}
	if reg.writes != 0 || reg.deletes != 0 {
		t.Fatal("State yazmamalı")
	}
}

func TestAC253DisableIdempotent(t *testing.T) {
	m, reg, _ := newManager(dl, downloadsTarget())
	reg.vals[ValueName] = regValue{Command(dl), KindString}
	if err := m.Disable(); err != nil {
		t.Fatal(err)
	}
	if err := m.Disable(); err != nil {
		t.Fatal(err)
	}
	if st, _ := m.State(); st.On || st.Other {
		t.Fatalf("%+v", st)
	}
}

// G-P20-1/15: normal açılış, `--tray` açılışı ve tepsiden pencere açılışı aynı Verify'ı çağırır.
func TestAC253VerifyRemovesWeak(t *testing.T) {
	t.Run("değer yok", func(t *testing.T) {
		m, reg, pr := newManager(dl, downloadsTarget())
		c, err := m.Verify()
		if err != nil || c.Present || reg.deletes != 0 || pr.inspects != 0 {
			t.Fatalf("%+v %v", c, err)
		}
	})
	t.Run("sağlam hedef kalır", func(t *testing.T) {
		m, reg, _ := newManager(dl, downloadsTarget())
		reg.vals[ValueName] = regValue{Command(dl), KindString}
		c, err := m.Verify()
		if err != nil || !c.Present || c.Removed || reg.deletes != 0 {
			t.Fatalf("%+v %v", c, err)
		}
	})
	t.Run("izinler sonradan zayıfladı: silinir", func(t *testing.T) {
		m, reg, _ := newManager(dl, weakDownloads())
		reg.vals[ValueName] = regValue{Command(dl), KindString}
		c, err := m.Verify()
		if err != nil || !c.Removed || c.Reason != ReasonWeakACL {
			t.Fatalf("%+v %v", c, err)
		}
		if _, ok := reg.vals[ValueName]; ok {
			t.Fatal("değer silinmeliydi")
		}
	})
	t.Run("başka konumdaki hedef de denetlenir", func(t *testing.T) {
		at := araclarTarget()
		m, reg, _ := newManager(dl, downloadsTarget(), at)
		reg.vals[ValueName] = regValue{Command(at.Path), KindString}
		if c, _ := m.Verify(); !c.Removed || c.Reason != ReasonWeakACL {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("Public altı silinir", func(t *testing.T) {
		p := `C:\Users\Public\x.exe`
		m, reg, _ := newManager(dl, Target{Path: p, DriveFixed: true})
		reg.vals[ValueName] = regValue{Command(p), KindString}
		if c, _ := m.Verify(); !c.Removed || c.Reason != ReasonSharedLocation {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("bozuk biçim silinir", func(t *testing.T) {
		for _, v := range []regValue{
			{dl + " --tray", KindString}, {Command(dl) + " --x", KindString}, {Command(dl), KindOther},
			{Command(`\\?\` + dl), KindString}, {Command(`\\srv\s\x.exe`), KindString},
		} {
			m, reg, pr := newManager(dl, downloadsTarget())
			reg.vals[ValueName] = v
			c, err := m.Verify()
			if err != nil || !c.Removed || c.Reason != ReasonBadPath || pr.inspects != 0 {
				t.Fatalf("%+v: %+v %v", v, c, err)
			}
		}
	})
	t.Run("S-P20-K1 exe taşınmış: değer silinir", func(t *testing.T) {
		m, reg, _ := newManager(dl)
		reg.vals[ValueName] = regValue{Command(dl), KindString}
		c, err := m.Verify()
		if err != nil || !c.Removed || c.Reason != ReasonMissing || reg.deletes != 1 {
			t.Fatalf("%+v %v", c, err)
		}
		if _, ok := reg.vals[ValueName]; ok {
			t.Fatal("değer kalmamalı")
		}
	})
	t.Run("S-P20-K1 yol bileşeni yok (C:\\ AD atası): değer silinir", func(t *testing.T) {
		p := `C:\NoktaDestek\NoktaDestek.exe`
		m, reg, pr := newManager(dl, downloadsTarget())
		reg.vals[ValueName] = regValue{Command(p), KindString}
		c, err := m.Verify()
		if err != nil || !c.Present || !c.Removed || c.Reason != ReasonMissing || pr.inspects != 1 {
			t.Fatalf("%+v %v", c, err)
		}
		if _, ok := reg.vals[ValueName]; ok {
			t.Fatal("değer kalmamalı")
		}
		if msg := c.Reason.Message(); !strings.Contains(msg, "program bulunamadı") {
			t.Fatalf("metin: %q", msg)
		}
	})
	t.Run("denetlenemedi: silinir, hata döner", func(t *testing.T) {
		m, reg, pr := newManager(dl, downloadsTarget())
		pr.envErr = errors.New("belirteç")
		reg.vals[ValueName] = regValue{Command(dl), KindString}
		c, err := m.Verify()
		if err == nil || !c.Removed || c.Reason != ReasonCheckFailed {
			t.Fatalf("%+v %v", c, err)
		}
	})
	t.Run("yükseltilmiş süreçte de denetler", func(t *testing.T) {
		m, reg, pr := newManager(dl, weakDownloads())
		pr.elevated = true
		reg.vals[ValueName] = regValue{Command(dl), KindString}
		if c, _ := m.Verify(); !c.Removed {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("kayıt defteri okunamadı: dokunulmaz", func(t *testing.T) {
		m, reg, _ := newManager(dl, weakDownloads())
		reg.readErr = errors.New("erişim")
		if c, err := m.Verify(); err == nil || c.Removed || reg.deletes != 0 {
			t.Fatalf("%+v %v", c, err)
		}
	})
}

func TestAC253ReasonMessages(t *testing.T) {
	if ReasonOK.Message() != "" {
		t.Fatal("OK mesajsız")
	}
	for r := ReasonElevated; r <= ReasonCheckFailed; r++ {
		if r.Message() == "" {
			t.Errorf("%d mesajsız", r)
		}
	}
	want := "Bu klasöre başka kullanıcılar yazabiliyor; programı İndirilenler'e veya kendi klasörünüze taşıyın"
	if ReasonWeakACL.Message() != want || ReasonSharedLocation.Message() != want {
		t.Fatal("ret metni mimari-e11 §8d.3 ile aynı olmalı")
	}
}
