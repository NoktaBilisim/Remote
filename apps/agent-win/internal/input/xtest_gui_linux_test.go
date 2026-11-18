//go:build linux && linuxgui

package input

import (
	"os"
	"runtime"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/linux/glib"
	"remote-support/agent-win/internal/linux/x11"
)

// K8a sözleşmesi: test-linux-gui imajında X11 fazı (P28G_GUI=x11, Xvfb :99 1920×1080, XTEST + XInputExtension).
// Süreç başında PR_SET_DUMPABLE=0 uygulanır: X11'de açılışta uygulanma kararının (§5.3 (a)) XTest/XI2'yi bozmadığı
// kanıtı da bu testlerdir.
func needX11GUI(t *testing.T) {
	t.Helper()
	if os.Getenv("P28G_GUI") != "x11" {
		t.Skip("SKIP: P28G_GUI=x11 (test-linux-gui imajı) gerekir")
	}
	if _, _, e := syscall.RawSyscall(syscall.SYS_PRCTL, 4 /* PR_SET_DUMPABLE */, 0, 0); e != 0 {
		t.Fatalf("prctl: %v", e)
	}
	if err := x11.InitThreads(); err != nil {
		t.Fatal(err)
	}
	if err := bindX(); err != nil {
		t.Fatal(err)
	}
}

var xt struct {
	selectInput func(d uintptr, w uint64, mask int64) int32
	changeAttrs func(d uintptr, w uint64, mask uint64, attrs unsafe.Pointer) int32
	mapRaised   func(d uintptr, w uint64) int32
	pending     func(d uintptr) int32
	width       func(d uintptr, screen int32) int32
	height      func(d uintptr, screen int32) int32
}

func bindTestX(t *testing.T) {
	t.Helper()
	h, err := glib.Open(glib.Path(glib.LibX11))
	if err == nil && xt.pending == nil {
		for _, f := range []struct {
			p any
			n string
		}{{&xt.selectInput, "XSelectInput"}, {&xt.changeAttrs, "XChangeWindowAttributes"}, {&xt.mapRaised, "XMapRaised"},
			{&xt.pending, "XPending"}, {&xt.width, "XDisplayWidth"}, {&xt.height, "XDisplayHeight"}} {
			if err = glib.Func(f.p, h, f.n); err != nil {
				break
			}
		}
	}
	if err != nil {
		t.Fatal(err)
	}
}

// AC-49 (K8a zorunlu adı): Applier → LinuxInjector → XTest tıklaması kendi override-redirect penceremize ±2 px düşer.
func TestP28gK3GUIXTestClick(t *testing.T) {
	needX11GUI(t)
	bindTestX(t)
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	d := openXDisplay()
	if d == 0 {
		t.Fatal("XOpenDisplay")
	}
	defer xl.closeDisplay(d)
	W, H := xt.width(d, 0), xt.height(d, 0)
	root := xl.defaultRoot(d)
	win := xl.createSimpleWin(d, root, 200, 150, 400, 300, 0, 0, 0xffffff)
	attrs := make([]byte, 112) // XSetWindowAttributes; override_redirect +88
	*(*int32)(unsafe.Pointer(&attrs[88])) = 1
	xt.changeAttrs(d, win, 1<<9 /* CWOverrideRedirect */, unsafe.Pointer(&attrs[0]))
	xt.selectInput(d, win, 1<<2|1 /* ButtonPressMask | KeyPressMask */)
	xt.mapRaised(d, win)
	xl.sync(d, 0)
	time.Sleep(200 * time.Millisecond)

	sink, err := newXTestSink()
	if err != nil {
		t.Fatal(err)
	}
	defer sink.close()
	g := &control.Gate{}
	inj := newLinuxInjector(sink, false)
	virt := Rect{Right: W, Bottom: H}
	inj.SetVirtual(virt)
	a := NewApplier(g, inj, nil)
	a.SetTarget(virt, virt)
	g.Open()
	const tx, ty = 350, 260
	nx, ny := float64(tx)/float64(W-1), float64(ty)/float64(H-1)
	msg := func(down bool) []byte {
		b := "false"
		if down {
			b = "true"
		}
		return []byte(`{"t":"m.btn","b":"l","down":` + b + `,"x":` + ftoa(nx) + `,"y":` + ftoa(ny) + `}`)
	}
	a.Handle(msg(true))
	a.Handle(msg(false))
	ev := make([]uint64, sizeXEvent/8)
	p := unsafe.Pointer(&ev[0])
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if xt.pending(d) == 0 {
			time.Sleep(10 * time.Millisecond)
			continue
		}
		xl.nextEvent(d, p)
		if *(*int32)(p) != 4 /* ButtonPress */ {
			continue
		}
		xr, yr := *(*int32)(unsafe.Add(p, 72)), *(*int32)(unsafe.Add(p, 76))
		btn := *(*uint32)(unsafe.Add(p, 84))
		t.Logf("ButtonPress kök (%d,%d) düğme %d; hedef (%d,%d)", xr, yr, btn, tx, ty)
		if btn != 1 || abs32(xr-tx) > 2 || abs32(yr-ty) > 2 {
			t.Fatalf("±2 px dışında ya da yanlış düğme")
		}
		checkKeys(t, d, a, p)
		return
	}
	t.Fatal("ButtonPress gelmedi")
}

// checkKeys AC-48 metin yolu (keysym → tuş kodu + XKB düzeyi; Xvfb us düzeni): "a" → 38 değiştiricisiz, teknisyenin
// Shift'iyle "A" → 38 + Shift (Shift bırakılmaz), "@" → 11 ("2" tuşu) + enjektörün kendi bastığı Shift. Odak imlecin
// altındaki penceremizdedir (Xvfb'de pencere yöneticisi yok, PointerRoot).
func checkKeys(t *testing.T, d uintptr, a *Applier, p unsafe.Pointer) {
	t.Helper()
	for _, m := range []string{`{"t":"k","code":"KeyA","key":"a","down":true}`, `{"t":"k","code":"KeyA","key":"a","down":false}`,
		`{"t":"k","code":"ShiftLeft","down":true}`, `{"t":"k","code":"KeyA","key":"A","down":true}`,
		`{"t":"k","code":"KeyA","key":"A","down":false}`, `{"t":"k","code":"ShiftLeft","down":false}`,
		`{"t":"k","code":"Digit2","key":"@","down":true}`, `{"t":"k","code":"Digit2","key":"@","down":false}`} {
		a.Handle([]byte(m))
	}
	type kp struct{ kc, shift uint32 }
	want := []kp{{38, 0}, {50, 0}, {38, 1}, {50, 0}, {11, 1}} // 50 = Shift_L: teknisyenin, sonra enjektörün (@); 11 = "2" tuşu
	var got []kp
	deadline := time.Now().Add(3 * time.Second)
	for len(got) < len(want) && time.Now().Before(deadline) {
		if xt.pending(d) == 0 {
			time.Sleep(10 * time.Millisecond)
			continue
		}
		xl.nextEvent(d, p)
		if *(*int32)(p) != xKeyPress {
			continue
		}
		got = append(got, kp{*(*uint32)(unsafe.Add(p, offKeyKeycode)), *(*uint32)(unsafe.Add(p, offKeyState)) & xShiftMask})
	}
	t.Logf("KeyPress (tuş kodu, Shift): %v", got)
	if len(got) != len(want) {
		t.Fatalf("KeyPress sayısı %d (beklenen %v)", len(got), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%d: %v (beklenen %v)", i, got[i], want[i])
		}
	}
}

func abs32(v int32) int32 {
	if v < 0 {
		return -v
	}
	return v
}

// AC-104 / S-P28g-13 (K8a zorunlu adı): XI2 izleyici XTEST kimliklerini bulur; kendi XTest enjeksiyonumuzun ham
// olayları yerel sayılmaz (kapı askıya alınmaz); izleyici olay görmüştür (boşta değil) ve kapanış ≤ 1 sn.
func TestP28gK3GUIXTestDeviceRejected(t *testing.T) {
	needX11GUI(t)
	g := &control.Gate{}
	w, err := startXI2(g, nil)
	if err != nil {
		t.Fatal(err)
	}
	ids := XTestIDs()
	t.Logf("XTEST alt aygıt kimlikleri %v", ids)
	if len(ids) < 2 {
		t.Fatalf("XTEST işaretçi + klavye kimliği bekleniyordu: %v", ids)
	}
	sink, err := newXTestSink()
	if err != nil {
		t.Fatal(err)
	}
	defer sink.close()
	g.Open()
	before := xi2Raw.Load()
	for i := range 20 {
		if err := sink.apply([]linOp{{kind: opMove, x: float64(100 + i*5), y: 100},
			{kind: opKey, code: evLeftShift, down: true}, {kind: opKey, code: evLeftShift}}); err != nil {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(300 * time.Millisecond)
	seen := xi2Raw.Load() - before
	t.Logf("izleyicinin gördüğü XI2 olayı %d", seen)
	if seen < 20 {
		t.Fatalf("izleyici XTEST olaylarını görmedi (%d)", seen)
	}
	if !g.Allow(time.Now()) {
		t.Fatal("XTEST kaynaklı olay yerel sayıldı (kapı askıya alındı)")
	}
	t0 := time.Now()
	w.close()
	select {
	case <-w.done:
	default:
		t.Fatal("izleyici kapanmadı")
	}
	t.Logf("kapanış %v", time.Since(t0))
}
