//go:build darwin

package objc

import (
	"errors"
	"sync"

	"github.com/ebitengine/purego"
)

// Queue bir dispatch kuyruğu (dispatch_queue_t).
type Queue uintptr

// ErrNoDispatch libdispatch işlevleri bağlanamadı (fail-closed: gönderim yapılmaz).
var ErrNoDispatch = errors.New("objc: libdispatch bağlanamadı")

var (
	dispatchOnce    sync.Once
	dispatchErr     error
	dispatchAsyncF  func(q, ctx, fn uintptr)
	dispatchCreate  func(label *byte, attr uintptr) uintptr
	mainQueue       Queue
	pending         Handles[func()]
	dispatchTrampol uintptr
)

// FFI kuralı 2: geri çağrı yuvası yalnız init'te bir kez ayrılır. Bağlam yalnız tutamaçtır (kural 1).
func init() {
	dispatchTrampol = purego.NewCallback(func(ctx uintptr) {
		if fn, ok := pending.Take(ctx); ok {
			fn()
		}
	})
}

func bindDispatch() error {
	dispatchOnce.Do(func() {
		h, err := Open(LibSystem)
		if err != nil {
			dispatchErr = errors.Join(ErrNoDispatch, err)
			return
		}
		mq, err := purego.Dlsym(h, "_dispatch_main_q") // dispatch_get_main_queue() başlık içi; dışa açık sembol bu
		if err != nil {
			dispatchErr = errors.Join(ErrNoDispatch, err)
			return
		}
		mainQueue = Queue(mq)
		dispatchErr = errors.Join(Func(&dispatchAsyncF, h, "dispatch_async_f"), Func(&dispatchCreate, h, "dispatch_queue_create"))
		if dispatchErr != nil {
			dispatchErr = errors.Join(ErrNoDispatch, dispatchErr)
		}
	})
	return dispatchErr
}

// MainQueue ana iş parçacığı kuyruğu (AppKit çağrıları yalnız burada).
func MainQueue() (Queue, error) {
	if err := bindDispatch(); err != nil {
		return 0, err
	}
	return mainQueue, nil
}

// NewQueue seri dispatch kuyruğu (süreç ömrü; serbest bırakılmaz).
func NewQueue(label string) (Queue, error) {
	if err := bindDispatch(); err != nil {
		return 0, err
	}
	b := append([]byte(label), 0)
	q := dispatchCreate(&b[0], 0)
	if q == 0 {
		return 0, ErrNoDispatch
	}
	return Queue(q), nil
}

// Async fn'i q kuyruğunda eşzamansız çalıştırır; C'ye yalnız tutamaç gider (FFI kuralı 1).
func Async(q Queue, fn func()) error {
	if err := bindDispatch(); err != nil {
		return err
	}
	if q == 0 {
		return ErrNoDispatch
	}
	dispatchAsyncF(uintptr(q), pending.Put(fn), dispatchTrampol)
	return nil
}
