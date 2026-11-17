//go:build linux

// Package x11 Linux X11/GDK ortak yardımcıları (mimari-p28g §5.4 X11 FFI kuralları, §14 m.1; ADR-0038 m.6): Xlib
// iş parçacığı desteği (XInitThreads her Xlib çağrısından — GDK'nın XOpenDisplay'i dahil — önce), GDK ana iş
// parçacığına sınırlı beklemeli gönderme ve GDK monitör listesi. Kitaplıklar yalnız izin listeli mutlak yoldan
// (internal/linux/glib) açılır; sembol yoksa hata (fail-closed). Paket init'inde dlopen yoktur.
package x11

import (
	"errors"
	"sync"
	"time"

	"remote-support/agent-win/internal/linux/glib"
)

// ErrMainTimeout ana iş parçacığı (GTK döngüsü) iş süresinde yanıt vermedi.
var ErrMainTimeout = errors.New("x11: ana iş parçacığı yanıt vermedi")

// MainWait ana iş parçacığı çağrılarının üst sınırı (aşılırsa çağıran fail-closed davranır).
const MainWait = 2 * time.Second

var (
	initOnce sync.Once
	initErr  error
	xInit    func() int32
)

// InitThreads libX11'i yükler ve XInitThreads'i bir kez çağırır. GTK'dan (gtk_init) ÖNCE, ana iş parçacığında
// çağrılmalıdır (§5.4 m.5). Hata kalıcıdır; hata varsa XTest/XI2 açılmaz (kontrol yok).
func InitThreads() error {
	initOnce.Do(func() {
		h, err := glib.Open(glib.Path(glib.LibX11))
		if err == nil {
			err = glib.Func(&xInit, h, "XInitThreads")
		}
		if err == nil && xInit() == 0 {
			err = errors.New("x11: XInitThreads başarısız")
		}
		initErr = err
	})
	return initErr
}

// Ready XInitThreads başarıyla çağrıldı mı (Xlib bağlantısı açmadan önce denetlenir).
func Ready() bool {
	initOnce.Do(func() { initErr = errors.New("x11: InitThreads çağrılmadı") })
	return initErr == nil
}

// OnMain fn'i GLib ana döngüsünde çalıştırır ve bitmesini en çok MainWait bekler. Süre aşılırsa ErrMainTimeout (fn
// sonra yine çalışabilir; çağıran sonucu kullanmaz). Ana iş parçacığından çağrılmamalıdır (kilitlenme → zaman aşımı).
func OnMain(fn func()) error {
	done := make(chan struct{})
	if err := glib.Post(func() { fn(); close(done) }); err != nil {
		return err
	}
	t := time.NewTimer(MainWait)
	defer t.Stop()
	select {
	case <-done:
		return nil
	case <-t.C:
		return ErrMainTimeout
	}
}
