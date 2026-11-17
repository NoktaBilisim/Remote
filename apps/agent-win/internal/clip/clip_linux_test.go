//go:build linux

package clip

import (
	"errors"
	"os"
	"runtime"
	"strings"
	"testing"

	"remote-support/agent-win/internal/linux/glib"
)

// P28g K5 (AC-402/P28a, K0s-8, S-P28f-12 Linux eşi). Saf karar işlevleri her Linux'ta; gerçek GTK gidiş-dönüşü yalnız
// DISPLAY ve sistem GTK'sı varsa (spike/GUI imajı; yoksa görünür SKIP). GTK ana döngüsü test ikilisinin ana iş
// parçacığında döner (init kilidi), testler goroutine'de koşar.

func init() { runtime.LockOSThread() }

var gtkReady bool

func TestMain(m *testing.M) {
	if os.Getenv("DISPLAY") == "" || bind() != nil {
		os.Exit(m.Run())
	}
	gtk, err := glib.Open(glib.Path(glib.LibGTK))
	var initCheck func(argc, argv uintptr) bool
	var gtkMain, gtkMainQuit func()
	gdk, err2 := glib.Open(glib.Path(glib.LibGDK))
	var allowed func(*byte)
	if err != nil || err2 != nil || glib.Func(&initCheck, gtk, "gtk_init_check") != nil ||
		glib.Func(&gtkMain, gtk, "gtk_main") != nil || glib.Func(&gtkMainQuit, gtk, "gtk_main_quit") != nil ||
		glib.Func(&allowed, gdk, "gdk_set_allowed_backends") != nil {
		os.Exit(m.Run())
	}
	x11, _ := glib.CString("x11")
	allowed(x11)
	if !initCheck(0, 0) {
		os.Exit(m.Run())
	}
	gtkReady = true
	code := make(chan int, 1)
	go func() {
		c := m.Run()
		code <- c
		_ = glib.Post(gtkMainQuit)
	}()
	gtkMain()
	os.Exit(<-code)
}

func TestAC402P28gSensitiveTargets(t *testing.T) {
	if !sensitiveTargets([]string{"TARGETS", "UTF8_STRING", "x-kde-passwordManagerHint"}) ||
		sensitiveTargets([]string{"TARGETS", "UTF8_STRING", "text/plain"}) || sensitiveTargets(nil) {
		t.Fatal("ipucu kararı")
	}
	for _, c := range []struct {
		names []string
		i     int
		ok    bool
	}{
		{[]string{"TARGETS", "text/plain;charset=utf-8", "UTF8_STRING"}, 2, true},
		{[]string{"TARGETS", "text/plain;charset=UTF-8"}, 1, true},
		{[]string{"TARGETS", "STRING", "TEXT", "text/plain"}, 0, false},
		{nil, 0, false},
	} {
		if i, ok := textTarget(c.names); i != c.i || ok != c.ok {
			t.Errorf("%v → %d %v", c.names, i, ok)
		}
	}
}

func TestAC402P28gGTKClipRoundTrip(t *testing.T) {
	if !gtkReady {
		t.Skip("DISPLAY ya da sistem GTK3 yok (gerçek gidiş-dönüş spike/GUI imajında)")
	}
	c, err := New()
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	for _, s := range []string{"merhaba", "ç ğ ı ö ş ü İ\r\nikinci satır 😀", strings.Repeat("é", MaxBytes/2)} {
		if err := c.WriteText(s); err != nil {
			t.Fatal(err)
		}
		got, err := c.ReadText()
		if err != nil || got != s {
			t.Fatalf("gidiş-dönüş %d bayt: %v (eşit=%v)", len(s), err, got == s)
		}
	}
	if err := c.WriteText(strings.Repeat("a", MaxBytes+1)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("büyük: %v", err)
	}
	if err := c.WriteText("a\x00b"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("NUL: %v", err)
	}
}
