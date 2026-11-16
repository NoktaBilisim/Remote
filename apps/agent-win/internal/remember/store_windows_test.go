//go:build windows && (amd64 || arm64)

package remember

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// G-P20-2/16 (CI test-windows): iki süreç × 100 tur eşzamanlı oku-değiştir-yaz `kayitlar.lock` + LockFileEx altında;
// kayıp güncelleme yok. Yardımcı süreç aynı test ikilisidir (envWorker).
const (
	envWorker = "NOKTA_REMEMBER_WORKER_DIR"
	rounds    = 100
)

func TestGP2016HelperWorker(t *testing.T) {
	dir := os.Getenv(envWorker)
	if dir == "" {
		t.Skip("yalnız yardımcı süreç")
	}
	// Test kayıp güncellemeyi ölçer, 2 sn bekleme sınırını değil: paylaşılan CI koşucusunda iki süreç × 200 DPAPI'li
	// kilitli işlemde adil olmayan yoklama 2 sn'yi aşabiliyordu (yük altı kararsızlık). Zaman aşımı ayrıca
	// remember_test.go'da kısa sürelerle sınanır.
	lockWait = 60 * time.Second
	s := &Store{Dir: dir, Protect: Protect, Unprotect: Unprotect}
	for i := 0; i < rounds; i++ {
		if err := s.update(incr); err != nil {
			t.Fatal(err)
		}
		if err := s.TouchBinding(key('A'), day(1+i%20)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAC254GP2016TwoProcessesNoLostUpdate(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NoktaDestek")
	s := &Store{Dir: dir, Protect: Protect, Unprotect: Unprotect}
	if err := s.SaveBinding(bindingAt(home, 'A', day(1)), ""); err != nil {
		t.Fatal(err)
	}
	var cmds []*exec.Cmd
	var outs []*bytes.Buffer
	for w := 0; w < 2; w++ {
		c := exec.Command(os.Args[0], "-test.run=^TestGP2016HelperWorker$", "-test.count=1")
		c.Env = append(os.Environ(), envWorker+"="+dir)
		out := new(bytes.Buffer)
		c.Stdout, c.Stderr = out, out
		if err := c.Start(); err != nil {
			t.Fatal(err)
		}
		cmds, outs = append(cmds, c), append(outs, out)
	}
	for i, c := range cmds {
		if err := c.Wait(); err != nil {
			t.Errorf("yardımcı süreç %d: %v\n%s", i, err, outs[i])
		}
	}
	if t.Failed() {
		t.FailNow()
	}
	d, ok := s.Load()
	if !ok || d.Bindings[0].CustomerName != strconv.Itoa(2*rounds) {
		t.Fatalf("kayıp güncelleme: %+v", d.Bindings)
	}
}

// DPAPI gidiş-dönüş, yeni entropi ile alan ayrımı ve hata sınıfları (G-P20-3/18).
func TestAC254DPAPIRoundTripAndClasses(t *testing.T) {
	sealed, err := Protect([]byte("veri"))
	if err != nil {
		t.Fatal(err)
	}
	if p, err := Unprotect(sealed); err != nil || string(p) != "veri" {
		t.Fatal(p, err)
	}
	if _, err := UnprotectLegacy(sealed); err == nil {
		t.Fatal("v3 mührü eski entropiyle açılmamalı")
	}
	if _, err := Unprotect([]byte("bozuk")); classify(err) != ClassFormat {
		t.Fatalf("bozuk mühür sınıf 1: %v", err)
	}
	for code, want := range map[uint32]string{
		uint32(windows.ERROR_INVALID_DATA): ClassFormat, nteBadData: ClassFormat, nteBadKeyState: ClassKeyState,
		uint32(windows.ERROR_INVALID_PARAMETER): ClassFormat, uint32(windows.ERROR_ACCESS_DENIED): ClassDPAPI,
	} {
		if got := classify(dpapiClass(syscall.Errno(code))); got != want {
			t.Errorf("0x%08X → %s, beklenen %s", code, got, want)
		}
	}
	if !isSharing(&os.PathError{Err: windows.ERROR_SHARING_VIOLATION}) {
		t.Fatal("paylaşım ihlali sınıf 2")
	}
}

// Göç gerçek dosyalarla: eski entropiyle mühürlü hatirla.bin → kayitlar.bin.
func TestAC254MigrateRealDPAPI(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NoktaDestek")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	sealed, err := protect([]byte(legacyV2), legacyEntropy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, legacyName), sealed, 0o600); err != nil {
		t.Fatal(err)
	}
	s := &Store{Dir: dir, Protect: Protect, Unprotect: Unprotect, UnprotectLegacy: UnprotectLegacy}
	r := s.Migrate()
	if r.Status != StatusOK || len(r.Data.Bindings) != 1 || r.Data.Personal == nil || r.Failed {
		t.Fatalf("%+v", r)
	}
	if _, err := os.Stat(filepath.Join(dir, legacyName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("hatirla.bin silinmeli")
	}
	if err := s.ForgetAll(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unut sonrası klasör kalmamalı (kayitlar.lock dahil)")
	}
}
