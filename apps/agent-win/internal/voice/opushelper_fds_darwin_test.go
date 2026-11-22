//go:build darwin

package voice

import (
	"os/exec"
	"slices"
	"syscall"
	"testing"

	"remote-support/agent-win/internal/darwin/sandbox"
)

// S-P33-K-1: ana süreçte CLOEXEC'siz açık bir fd (purego ile yüklenen çerçevelerin bırakabileceği türden) yardımcıya
// geçmez — yardımcı sandbox'tan önce 0/1/2 dışındaki devralınmış fd'leri kapatır. Pozitif denetim: aynı fd sıradan bir
// çocuğa (/bin/sleep) geçer; yani liste boş diye test boşuna geçmez.
func TestP33K1HelperClosesInheritedFDs(t *testing.T) {
	const leaked = 100 // yardımcının ısıtmada kendi açacağı fd'lerle çakışmayacak kadar yüksek
	var p [2]int
	if err := syscall.Pipe(p[:]); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Dup2(p[1], leaked); err != nil { // dup2: yeni fd CLOEXEC'siz
		t.Fatal(err)
	}
	_ = syscall.Close(p[1])
	t.Cleanup(func() { _ = syscall.Close(leaked); _ = syscall.Close(p[0]) })

	has := func(fds []sandbox.FD, n int) bool {
		return slices.ContainsFunc(fds, func(f sandbox.FD) bool { return f.Num == n })
	}
	ctl := exec.Command("/bin/sleep", "5")
	if err := ctl.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ctl.Process.Kill(); _ = ctl.Wait() }()
	cfds, err := sandbox.ListFDs(ctl.Process.Pid)
	if err != nil || !has(cfds, leaked) {
		t.Fatalf("pozitif denetim: sıradan çocukta fd %d görünmeli (%v, %v)", leaked, cfds, err)
	}

	hc, err := spawnHelper()
	if err != nil {
		t.Fatal(err)
	}
	defer hc.kill()
	fds, err := sandbox.ListFDs(hc.cmd.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("yardımcı fd'leri (hazır sonrası): %v", fds)
	if has(fds, leaked) {
		t.Fatalf("devralınmış fd %d yardımcıda açık: %v", leaked, fds)
	}
	// Isıtma (AudioToolbox çözücüleri) sonrası da yalnız IPC + Go yoklayıcısının kqueue'su kalır (K1 ölçümü: 0/1/2).
	for _, f := range fds {
		if f.Num > 2 && f.Type != sandbox.FDTypeKqueue {
			t.Fatalf("beklenmeyen fd %d (tür %d): %v", f.Num, f.Type, fds)
		}
	}
	for _, n := range []int{0, 1, 2} {
		if !has(fds, n) {
			t.Fatalf("IPC fd %d yok: %v", n, fds)
		}
	}
}
