//go:build windows

package tray

import (
	"runtime"
	"testing"
	"unsafe"
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
