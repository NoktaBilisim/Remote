//go:build linux

package glib

import (
	"errors"
	"os"
	"sync"
	"testing"
)

// FFI kuralı 2/3: Post yalnız tutamaç verir; tek kayıtlı geri çağrı işi bir kez çalıştırır ve kaydı siler. Load
// yoksa ErrNotLoaded (fail-closed).
func TestP28gK1PostHandleTable(t *testing.T) {
	prev := idleAdd.Load()
	t.Cleanup(func() { idleAdd.Store(prev) })
	idleAdd.Store(nil)
	if err := Post(func() {}); !errors.Is(err, ErrNotLoaded) {
		t.Fatalf("Load'suz Post: %v", err)
	}
	var mu sync.Mutex
	var queued []uintptr
	fake := func(fn, data uintptr) uint32 {
		if fn != idleTrampoline {
			t.Error("tek kayıtlı geri çağrı kullanılmalı")
		}
		mu.Lock()
		queued = append(queued, data)
		mu.Unlock()
		return 1
	}
	idleAdd.Store(&fake)
	var wg sync.WaitGroup
	ran := make(chan int, 100)
	for g := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range 25 {
				if err := Post(func() { ran <- g*25 + i }); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	wg.Wait()
	if len(queued) != 100 || pending.Len() != 100 {
		t.Fatalf("sıradaki %d, tablo %d", len(queued), pending.Len())
	}
	for _, id := range queued {
		if id == 0 {
			t.Fatal("tutamaç 0 verilmemeli")
		}
		if r := runIdle(id); r != 0 {
			t.Fatal("G_SOURCE_REMOVE (0) dönmeli")
		}
		runIdle(id) // ikinci çağrı etkisiz
	}
	if len(ran) != 100 || pending.Len() != 0 {
		t.Fatalf("çalışan %d, kalan %d", len(ran), pending.Len())
	}
	runIdle(0)
}

// Load gerçek kitaplıkla (yalnız Ubuntu x86_64 test imajında; yoksa görünür SKIP).
func TestP28gK1LoadSystemGLib(t *testing.T) {
	if _, err := os.Stat(Path(LibGLib)); err != nil {
		t.Skipf("SKIP: %s yok (CI test-linux-gui imajında koşar)", Path(LibGLib))
	}
	if err := Load(); err != nil {
		t.Fatal(err)
	}
	if _, err := Open("/usr/lib/x86_64-linux-gnu/libc.so.6"); !errors.Is(err, ErrNotAllowed) {
		t.Fatalf("izin dışı yol açılmamalı: %v", err)
	}
	if _, err := SignalConnect(0, "a\x00b", 0); !errors.Is(err, ErrBadString) {
		t.Fatalf("gömülü NUL: %v", err)
	}
}
