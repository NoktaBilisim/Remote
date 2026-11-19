//go:build linux

package glib

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/darwin/objc"
)

// ErrNotLoaded Load başarıyla çağrılmadı (fail-closed: gönderim/bağlama yapılmaz).
var ErrNotLoaded = errors.New("glib: GLib yüklenmedi")

var (
	libMu  sync.Mutex
	loaded = map[string]uintptr{}
)

// Open izin listesindeki kitaplığı bir kez açar (RTLD_NOW | RTLD_GLOBAL) ve tutamacını döner (FFI kuralı 1).
func Open(path string) (uintptr, error) {
	if !Allowed(path) {
		return 0, fmt.Errorf("%w: %q", ErrNotAllowed, path)
	}
	libMu.Lock()
	defer libMu.Unlock()
	if h, ok := loaded[path]; ok {
		return h, nil
	}
	h, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err != nil {
		return 0, fmt.Errorf("glib: %s açılamadı: %w", path, err)
	}
	loaded[path] = h
	return h, nil
}

// Func h kitaplığındaki C işlevini fptr'ye bağlar; sembol yoksa hata (FFI kuralı 4).
func Func(fptr any, h uintptr, name string) error {
	sym, err := purego.Dlsym(h, name)
	if err != nil || sym == 0 {
		return fmt.Errorf("glib: %s sembolü yok: %w", name, err)
	}
	purego.RegisterFunc(fptr, sym)
	return nil
}

var (
	loadOnce sync.Once
	loadErr  error

	gIdleAdd           func(fn, data uintptr) uint32
	gFree              func(p uintptr)
	gObjectUnref       func(obj uintptr)
	gSignalConnectData func(instance uintptr, signal *byte, handler, data, destroy uintptr, flags int32) uint64

	// idleAdd Post'un kullandığı g_idle_add (Load sonrası; testte sahtesi konur). Post her goroutine'den okur.
	idleAdd atomic.Pointer[func(fn, data uintptr) uint32]
	// pending ana döngüde çalışacak işler; C'ye yalnız tutamaç verilir (FFI kuralı 2).
	pending objc.Handles[func()]
	// idleTrampoline tek kayıtlı g_idle_add geri çağrısı (FFI kuralı 3: init'te, bir kez).
	idleTrampoline uintptr
)

func init() {
	idleTrampoline = purego.NewCallback(runIdle)
}

// runIdle ana döngüde (GTK ana iş parçacığı) tutamacın işini çalıştırır. 0 = G_SOURCE_REMOVE (bir kez).
func runIdle(data uintptr) uintptr {
	if fn, ok := pending.Take(data); ok {
		fn()
	}
	return 0
}

// Load GLib ve GObject'i izin listeli mutlak yoldan yükler ve temel işlevleri bağlar (bir kez). Hata kalıcıdır.
func Load() error {
	loadOnce.Do(func() {
		g, err := Open(Path(LibGLib))
		if err != nil {
			loadErr = err
			return
		}
		o, err := Open(Path(LibGObject))
		if err != nil {
			loadErr = err
			return
		}
		loadErr = errors.Join(Func(&gIdleAdd, g, "g_idle_add"), Func(&gFree, g, "g_free"),
			Func(&gObjectUnref, o, "g_object_unref"), Func(&gSignalConnectData, o, "g_signal_connect_data"))
		if loadErr == nil {
			f := gIdleAdd
			idleAdd.Store(&f)
		}
	})
	return loadErr
}

// Post fn'i GLib ana döngüsünde (ana iş parçacığı) çalıştırılmak üzere sıraya koyar; herhangi bir goroutine'den
// çağrılabilir (g_idle_add iş parçacığı güvenlidir). Load başarısızsa ErrNotLoaded.
func Post(fn func()) error {
	add := idleAdd.Load()
	if add == nil {
		return ErrNotLoaded
	}
	(*add)(idleTrampoline, pending.Put(fn))
	return nil
}

// Free g_free (0 güvenli). Load sonrası çağrılır.
func Free(p uintptr) {
	if p != 0 && gFree != nil {
		gFree(p)
	}
}

// Unref g_object_unref (0 güvenli). Load sonrası çağrılır.
func Unref(obj uintptr) {
	if obj != 0 && gObjectUnref != nil {
		gObjectUnref(obj)
	}
}

// SignalConnect g_signal_connect_data(instance, signal, handler, 0, 0, 0). handler init'te kaydedilmiş bir
// purego geri çağrısıdır (FFI kuralı 3); bağlam verilmez (0). Bağlanamazsa hata (fail-closed).
func SignalConnect(instance uintptr, signal string, handler uintptr) (uint64, error) {
	if gSignalConnectData == nil {
		return 0, ErrNotLoaded
	}
	cs, err := CString(signal)
	if err != nil {
		return 0, err
	}
	id := gSignalConnectData(instance, cs, handler, 0, 0, 0)
	if id == 0 {
		return 0, fmt.Errorf("glib: %q sinyali bağlanamadı", signal)
	}
	return id, nil
}
