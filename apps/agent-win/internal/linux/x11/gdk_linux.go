//go:build linux

package x11

import (
	"errors"
	"sync"

	"remote-support/agent-win/internal/linux/glib"
)

// GDK işlevleri (yalnız ana iş parçacığında çağrılır). GDK X11 arka ucunda (K4: gdk_set_allowed_backends("x11"))
// geometri uygulama pikselidir; fiziksel piksel = geometri × ölçek.
var gdk struct {
	once sync.Once
	err  error

	displayDefault func() uintptr
	nMonitors      func(d uintptr) int32
	monitor        func(d uintptr, i int32) uintptr
	geometry       func(m uintptr, r *Rect)
	scale          func(m uintptr) int32
	isPrimary      func(m uintptr) bool
	xDisplay       func(d uintptr) uintptr
	trapPush       func(d uintptr)
	trapPop        func(d uintptr) int32
	addFilter      func(w, fn, data uintptr)
	removeFilter   func(w, fn, data uintptr)
}

// Rect GdkRectangle (int x, y, width, height). Değerle geçirilmez; işaretçiyle (FFI kuralı).
type Rect struct{ X, Y, W, H int32 }

// errNoDisplay GDK görüntüsü yok (gtk_init yapılmadı).
var errNoDisplay = errors.New("x11: GDK görüntüsü yok")

func bindGDK() error {
	gdk.once.Do(func() {
		h, err := glib.Open(glib.Path(glib.LibGDK))
		if err != nil {
			gdk.err = err
			return
		}
		gdk.err = errors.Join(
			glib.Func(&gdk.displayDefault, h, "gdk_display_get_default"),
			glib.Func(&gdk.nMonitors, h, "gdk_display_get_n_monitors"),
			glib.Func(&gdk.monitor, h, "gdk_display_get_monitor"),
			glib.Func(&gdk.geometry, h, "gdk_monitor_get_geometry"),
			glib.Func(&gdk.scale, h, "gdk_monitor_get_scale_factor"),
			glib.Func(&gdk.isPrimary, h, "gdk_monitor_is_primary"),
			glib.Func(&gdk.xDisplay, h, "gdk_x11_display_get_xdisplay"),
			glib.Func(&gdk.trapPush, h, "gdk_x11_display_error_trap_push"),
			glib.Func(&gdk.trapPop, h, "gdk_x11_display_error_trap_pop"),
			glib.Func(&gdk.addFilter, h, "gdk_window_add_filter"),
			glib.Func(&gdk.removeFilter, h, "gdk_window_remove_filter"),
		)
	})
	return gdk.err
}

// Monitor GDK monitörü (fiziksel piksel, kök pencere koordinatı).
type Monitor struct {
	X, Y, W, H int
	Primary    bool
}

// Monitors GDK monitör listesini ana iş parçacığında okur (sıra GDK sırası). Boş liste ya da hata → yakalama yok.
func Monitors() ([]Monitor, error) {
	if err := bindGDK(); err != nil {
		return nil, err
	}
	var out []Monitor
	var ferr error
	if err := OnMain(func() {
		d := gdk.displayDefault()
		if d == 0 {
			ferr = errNoDisplay
			return
		}
		n := gdk.nMonitors(d)
		for i := int32(0); i < n && i < 16; i++ {
			m := gdk.monitor(d, i)
			if m == 0 {
				continue
			}
			var r Rect
			gdk.geometry(m, &r)
			s := max(1, int(gdk.scale(m)))
			out = append(out, Monitor{X: int(r.X) * s, Y: int(r.Y) * s, W: int(r.W) * s, H: int(r.H) * s, Primary: gdk.isPrimary(m)})
		}
	}); err != nil {
		return nil, err
	}
	if ferr != nil {
		return nil, ferr
	}
	if len(out) == 0 {
		return nil, errNoDisplay
	}
	return out, nil
}

// GDK ana iş parçacığı yardımcıları (çağıran ana iş parçacığındadır; OnMain içinden).

// XDisplay GDK'nın Xlib Display'i (0 = yok). Ana iş parçacığında.
func XDisplay() uintptr {
	if bindGDK() != nil {
		return 0
	}
	d := gdk.displayDefault()
	if d == 0 {
		return 0
	}
	return gdk.xDisplay(d)
}

// Trap fn'i GDK X hata tuzağı içinde çalıştırır ve eşzamanlı hata kodunu döner (0 = hata yok; S-P28g-13 m.2). Ana
// iş parçacığında.
func Trap(fn func()) int32 {
	if bindGDK() != nil {
		return -1
	}
	d := gdk.displayDefault()
	if d == 0 {
		return -1
	}
	gdk.trapPush(d)
	fn()
	return gdk.trapPop(d)
}

// AddRootFilter tüm pencereler için (window=NULL) GDK olay süzgeci ekler; fn init'te kaydedilmiş purego geri çağrısıdır
// (GdkFilterFunc(xevent, event, data) → GdkFilterReturn). Ana iş parçacığında.
func AddRootFilter(fn uintptr) error {
	if err := bindGDK(); err != nil {
		return err
	}
	gdk.addFilter(0, fn, 0)
	return nil
}

// RemoveRootFilter AddRootFilter'ı geri alır. Ana iş parçacığında.
func RemoveRootFilter(fn uintptr) {
	if bindGDK() == nil {
		gdk.removeFilter(0, fn, 0)
	}
}
