//go:build windows

package autorun

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Windows CI (test-windows): gerçek HKCU Run değeri (geçici ad) ve gerçek varsayılan `C:\` izinleri (G-P20-1/6/14/15).
// Testler Self ve yükseltilmişliği sabitler (CI koşucusu yönetici olarak çalışır); ACL okuma gerçektir.

type testProbe struct {
	sysProber
	self string
}

func (testProbe) Elevated() bool          { return false }
func (p testProbe) Self() (string, error) { return p.self, nil }

func randName(t *testing.T) string {
	t.Helper()
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return "NoktaDestekTest-" + hex.EncodeToString(b)
}

func mkdirTemp(t *testing.T, parent string) string {
	t.Helper()
	dir := filepath.Join(parent, randName(t))
	if err := os.Mkdir(dir, 0o700); err != nil {
		if errors.Is(err, os.ErrPermission) {
			t.Skipf("%s altında klasör açılamadı (yönetici değil): %v", parent, err)
		}
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func touch(t *testing.T, path string) string {
	t.Helper()
	if err := os.WriteFile(path, []byte("MZ"), 0o600); err != nil {
		if errors.Is(err, os.ErrPermission) {
			t.Skipf("%s yazılamadı: %v", path, err)
		}
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(path) })
	return path
}

func testManager(t *testing.T, exe string) *Manager {
	t.Helper()
	m := &Manager{Reg: sysRegistry{}, Probe: testProbe{self: exe}, Name: randName(t)}
	t.Cleanup(func() { _ = sysRegistry{}.Delete(m.Name) })
	return m
}

func rawValue(t *testing.T, name string) (string, uint32, error) {
	t.Helper()
	k, err := registry.OpenKey(registry.CURRENT_USER, RunKey, registry.QUERY_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = k.Close() }()
	return k.GetStringValue(name)
}

func evaluatePath(t *testing.T, p string) Reason {
	t.Helper()
	env, err := sysProber{}.Env()
	if err != nil {
		t.Fatal(err)
	}
	tg, err := sysProber{}.Inspect(p)
	if err != nil {
		t.Fatalf("Inspect %s: %v", p, err)
	}
	return Evaluate(tg, env)
}

func profileDir(t *testing.T) string {
	t.Helper()
	p := os.Getenv("USERPROFILE")
	if p == "" {
		t.Skip("USERPROFILE yok")
	}
	return p
}

func TestAC253WindowsRegistryRoundTrip(t *testing.T) {
	exe := touch(t, filepath.Join(mkdirTemp(t, profileDir(t)), "Destek %x% 1.exe"))
	m := testManager(t, exe)
	if r, err := m.Enable(); r != ReasonOK || err != nil {
		t.Fatalf("Enable: %v (%s) %v", r, r.Message(), err)
	}
	want, err := canonical(exe)
	if err != nil {
		t.Fatal(err)
	}
	v, typ, err := rawValue(t, m.Name)
	if err != nil || typ != registry.SZ || v != Command(want) {
		t.Fatalf("değer %q tür %d %v", v, typ, err)
	}
	if st, err := m.State(); err != nil || !st.On || st.Blocked != ReasonOK {
		t.Fatalf("State %+v %v", st, err)
	}
	// REG_EXPAND_SZ silinip REG_SZ yazılır.
	k, err := registry.OpenKey(registry.CURRENT_USER, RunKey, registry.SET_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	err = k.SetExpandStringValue(m.Name, Command(want))
	_ = k.Close()
	if err != nil {
		t.Fatal(err)
	}
	if st, _ := m.State(); st.On || !st.Other {
		t.Fatalf("REG_EXPAND_SZ açık sayılmamalı: %+v", st)
	}
	if r, err := m.Enable(); r != ReasonOK || err != nil {
		t.Fatalf("yeniden Enable: %v %v", r, err)
	}
	if _, typ, err := rawValue(t, m.Name); err != nil || typ != registry.SZ {
		t.Fatalf("tür %d %v", typ, err)
	}
	if c, err := m.Verify(); err != nil || !c.Present || c.Removed {
		t.Fatalf("Verify %+v %v", c, err)
	}
	if err := m.Disable(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := rawValue(t, m.Name); !errors.Is(err, registry.ErrNotExist) {
		t.Fatalf("silinmedi: %v", err)
	}
}

// G-P20-1: `icacls` ile Users:M verilen klasör → Verify değeri siler, Enable reddeder.
func TestAC253WindowsUsersModifyFolderRejected(t *testing.T) {
	dir := mkdirTemp(t, profileDir(t))
	exe := touch(t, filepath.Join(dir, "x.exe"))
	m := testManager(t, exe)
	if r, err := m.Enable(); r != ReasonOK || err != nil {
		t.Fatalf("Enable (izinler değişmeden): %v %v", r, err)
	}
	if out, err := exec.Command("icacls", dir, "/grant", "*S-1-5-32-545:(M)").CombinedOutput(); err != nil {
		t.Fatalf("icacls: %v %s", err, out)
	}
	c, err := m.Verify()
	if err != nil || !c.Removed || c.Reason != ReasonWeakACL {
		t.Fatalf("Verify %+v %v", c, err)
	}
	if _, _, err := rawValue(t, m.Name); !errors.Is(err, registry.ErrNotExist) {
		t.Fatalf("zayıf klasörde değer kaldı: %v", err)
	}
	if r, _ := m.Enable(); r != ReasonWeakACL {
		t.Fatalf("Enable reddedilmeli: %v", r)
	}
	if _, _, err := rawValue(t, m.Name); !errors.Is(err, registry.ErrNotExist) {
		t.Fatalf("ret sonrası değer yazıldı: %v", err)
	}
}

// G-P20-14: gerçek varsayılan `C:\` ACL'iyle İndirilenler kabul, `C:\Araclar` (devralınmış Authenticated Users:M) ve
// `C:\Users\Public` ret.
func TestAC253WindowsRealCDriveACL(t *testing.T) {
	t.Run("İndirilenler kabul", func(t *testing.T) {
		dl, err := windows.KnownFolderPath(windows.FOLDERID_Downloads, windows.KF_FLAG_CREATE)
		if err != nil {
			t.Skipf("İndirilenler yok: %v", err)
		}
		exe := touch(t, filepath.Join(dl, randName(t)+".exe"))
		if r := evaluatePath(t, exe); r != ReasonOK {
			t.Fatalf("İndirilenler: %v (%s)", r, r.Message())
		}
	})
	t.Run(`C:\Araclar ret`, func(t *testing.T) {
		root := os.Getenv("SystemDrive")
		if root == "" {
			root = "C:"
		}
		exe := touch(t, filepath.Join(mkdirTemp(t, root+`\`), "x.exe"))
		if r := evaluatePath(t, exe); r != ReasonWeakACL {
			t.Fatalf("kök altı klasör: %v", r)
		}
	})
	t.Run(`C:\Users\Public ret`, func(t *testing.T) {
		pub, err := windows.KnownFolderPath(windows.FOLDERID_Public, 0)
		if err != nil {
			t.Skipf("Public yok: %v", err)
		}
		exe := touch(t, filepath.Join(pub, randName(t)+".exe"))
		if r := evaluatePath(t, exe); r != ReasonSharedLocation {
			t.Fatalf("Public: %v", r)
		}
	})
	t.Run("junction üzerinden başlatma ret", func(t *testing.T) {
		dir := mkdirTemp(t, profileDir(t))
		real := filepath.Join(dir, "gercek")
		if err := os.Mkdir(real, 0o700); err != nil {
			t.Fatal(err)
		}
		touch(t, filepath.Join(real, "x.exe"))
		link := filepath.Join(dir, "bag")
		if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, real).CombinedOutput(); err != nil {
			t.Fatalf("junction: %v %s", err, out)
		}
		if r := evaluatePath(t, filepath.Join(link, "x.exe")); r != ReasonReparse {
			t.Fatalf("junction: %v", r)
		}
	})
}
