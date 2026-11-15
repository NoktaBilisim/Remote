//go:build windows

package tray

import (
	"runtime"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestAC253NotifyIconDataSize(t *testing.T) {
	want := map[string]uintptr{"amd64": 976, "386": 956, "arm64": 976}[runtime.GOARCH]
	if got := unsafe.Sizeof(notifyIconData{}); got != want {
		t.Fatalf("NOTIFYICONDATAW boyu %d, beklenen %d", got, want)
	}
}

// G-P20-13/16: aynı kullanıcının ikinci örneği mutex'i alamaz (sahip geçerli kullanıcı → LockTaken).
func TestAC253GP216SingleInstanceMutex(t *testing.T) {
	l, r := Acquire()
	if r != LockAcquired {
		t.Skipf("tepsi mutex'i bu oturumda zaten var (%v); CI'da temiz oturum beklenir", r)
	}
	defer l.Release()
	if _, r2 := Acquire(); r2 != LockTaken {
		t.Fatalf("ikinci örnek: %v, beklenen LockTaken", r2)
	}
	l.Release()
	l3, r3 := Acquire()
	if r3 != LockAcquired {
		t.Fatalf("bırakıldıktan sonra yeniden alınmalı: %v", r3)
	}
	l3.Release()
}

// S-P20-K2: pencere sahibi denetimi — kendi sürecimiz geçerli kullanıcıya ait; SYSTEM süreci (pid 4) değil; var
// olmayan pid false.
func TestAC253SPK2ProcessUserIs(t *testing.T) {
	tu, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if !processUserIs(windows.GetCurrentProcessId(), tu.User.Sid) {
		t.Fatal("kendi süreç geçerli kullanıcıya ait olmalı")
	}
	if processUserIs(4, tu.User.Sid) {
		t.Fatal("System süreci geçerli kullanıcı sayılmamalı")
	}
	if processUserIs(0xFFFFFFF0, tu.User.Sid) {
		t.Fatal("var olmayan süreç false olmalı")
	}
}
