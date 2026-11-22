//go:build darwin

package sandbox

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// Çocuk kipi: test ikilisi kendini yeniden çalıştırır (sandbox geri alınamaz; ana test sürecine uygulanmaz).
func TestMain(m *testing.M) {
	if mode := os.Getenv("NOKTA_SB_CHILD"); mode != "" {
		os.Exit(child(mode, os.Getenv("NOKTA_SB_PROBE")))
	}
	os.Exit(m.Run())
}

func child(mode, probe string) int {
	if mode == "enter" {
		if err := Enter(); err != nil {
			fmt.Println("enter:", err)
			return 3
		}
	}
	in, _ := Check(os.Getpid())
	fmt.Printf("check=%v\n", in)
	fmt.Printf("selftest=%v\n", SelfTest() == nil)
	fmt.Printf("read=%v\n", errors.Is(ReadProbe(probe), syscall.EPERM))
	fmt.Printf("write=%v\n", errors.Is(WriteProbe(), syscall.EPERM))
	fmt.Printf("net=%v\n", errors.Is(ConnectProbe(), syscall.EPERM))
	err := exec.Command("/usr/bin/true").Run()
	fmt.Printf("exec=%v\n", errors.Is(err, syscall.EPERM))
	return 0
}

func runChild(t *testing.T, mode, probe string) string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^$")
	cmd.Env = []string{"NOKTA_SB_CHILD=" + mode, "NOKTA_SB_PROBE=" + probe}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("çocuk: %v\n%s", err, out)
	}
	return string(out)
}

// S-P33-T2-1 m.4 + T2-2: sandbox'a giren süreç ev dizinindeki dosyayı okuyamaz, /tmp'ye yazamaz, ağa bağlanamaz, süreç başlatamaz
// (hepsi EPERM; socket() SBPL ile engellenemediğinden ağ connect/sendto düzeyinde sınanır); sandbox_check 1 döner.
func TestP33K1SandboxDeniesHomeTmpAndNetwork(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("ev dizini yok")
	}
	probe := filepath.Join(home, ".noktatest")
	if _, err := os.Stat(probe); err != nil {
		if err := os.WriteFile(probe, []byte("x"), 0o600); err != nil {
			t.Skip("ev dizinine yazılamadı")
		}
		t.Cleanup(func() { _ = os.Remove(probe) })
	}
	out := runChild(t, "enter", probe)
	for _, want := range []string{"check=true", "selftest=true", "read=true", "write=true", "net=true", "exec=true"} {
		if !strings.Contains(out, want) {
			t.Fatalf("%q yok:\n%s", want, out)
		}
	}
}

// T2-2 negatif denetim: sandbox'a girmeyen süreçte sandbox_check 0, öz-test başarısız, okuma serbest.
func TestP33K1SandboxCheckNegativeControl(t *testing.T) {
	home, _ := os.UserHomeDir()
	out := runChild(t, "none", home)
	for _, want := range []string{"check=false", "selftest=false", "read=false", "write=false", "net=false", "exec=false"} {
		if !strings.Contains(out, want) {
			t.Fatalf("%q yok:\n%s", want, out)
		}
	}
}

// Profil tam metin: yalnız deny default (izin satırı eklenirse güvenlik incelemesi gerekir).
func TestP33K1SandboxProfileIsDenyDefaultOnly(t *testing.T) {
	if Profile != "(version 1)\n(deny default)\n" || strings.Contains(Profile, "allow") {
		t.Fatalf("profil değişti: %q", Profile)
	}
}
