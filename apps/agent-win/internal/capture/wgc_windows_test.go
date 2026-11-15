//go:build windows && (amd64 || arm64)

package capture

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/win"
)

var (
	tUser32           = windows.NewLazySystemDLL("user32.dll")
	tPeekMessageW     = tUser32.NewProc("PeekMessageW")
	tDefWindowProcW   = tUser32.NewProc("DefWindowProcW")
	tOpenInputDesktop = tUser32.NewProc("OpenInputDesktop")
	tCloseDesktop     = tUser32.NewProc("CloseDesktop")
	tUnregisterClassW = tUser32.NewProc("UnregisterClassW")
)

// pumpFor pencere iletilerini d süresince işler (pencerenin boyanması ve DWM'ye ulaşması için).
func pumpFor(d time.Duration) {
	var m win.MSG
	for end := time.Now().Add(d); time.Now().Before(end); {
		for {
			r, _, _ := tPeekMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0, 1) // PM_REMOVE
			if r == 0 {
				break
			}
			win.TranslateDispatch(&m)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// interactiveDesktop etkileşimli giriş masaüstü açılabiliyor mu (hizmet oturumu / kilit ekranı değil).
func interactiveDesktop() bool {
	h, _, _ := tOpenInputDesktop.Call(0, 0, 0x0001) // DESKTOP_READOBJECTS
	if h == 0 {
		return false
	}
	_, _, _ = tCloseDesktop.Call(h)
	return true
}

// P17 I0 / AC-248 (D-WGC duman testi): kendi oluşturduğumuz düz kırmızı pencere WGC ile yakalanır; tek kare gelir,
// boyutu pozitiftir ve istemci alanının ortası kırmızıdır. WGC desteklenmiyorsa ya da etkileşimli masaüstü yoksa
// (CI hizmet oturumu) neden yazılarak atlanır; bu ikisi dışındaki her hata kırmızıdır.
func TestAC248WGCWindowSmoke(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := windows.CoInitializeEx(0, windows.COINIT_MULTITHREADED); err != nil && !errors.Is(err, syscall.Errno(1)) {
		t.Fatalf("CoInitializeEx: %v", err)
	}
	defer windows.CoUninitialize()

	ok, err := wgcSupported()
	if e := (*Error)(nil); errors.As(err, &e) && e.HR == 0x80040154 { // REGDB_E_CLASSNOTREG
		t.Skipf("WGC sınıfı kayıtlı değil (Windows 10 1803 öncesi / Server Core): %v", err)
	}
	if err != nil {
		t.Fatalf("wgcSupported: %v", err)
	}
	if !ok {
		t.Skip("GraphicsCaptureSession.IsSupported=false (oturum WGC desteklemiyor)")
	}
	if !interactiveDesktop() {
		t.Skip("etkileşimli masaüstü yok (OpenInputDesktop başarısız; hizmet oturumu veya kilitli ekran)")
	}

	class := fmt.Sprintf("NoktaWGCSmoke%d", os.Getpid())
	brush := win.SolidBrush(win.RGB(255, 0, 0))
	defer win.DeleteObject(brush)
	if err := win.RegisterClass(class, tDefWindowProcW.Addr(), brush); err != nil {
		t.Fatalf("RegisterClass: %v", err)
	}
	defer func() { _, _, _ = tUnregisterClassW.Call(uintptr(unsafe.Pointer(win.Str(class))), 0) }()
	hwnd := win.CreateWindow(0, class, "WGC smoke", win.WS_OVERLAPPED|win.WS_CAPTION|win.WS_SYSMENU|win.WS_VISIBLE,
		100, 100, 320, 240, 0, 0)
	if hwnd == 0 {
		t.Fatal("CreateWindow başarısız")
	}
	defer win.DestroyWindow(hwnd)
	pumpFor(300 * time.Millisecond)

	start := time.Now()
	c, err := openWGCWindow(hwnd)
	if err != nil {
		t.Fatalf("openWGCWindow: %v", err)
	}
	defer c.close()
	t.Logf("oturum açılışı %v", time.Since(start))

	var got bool
	var w, h int
	var center [4]byte
	for end := time.Now().Add(5 * time.Second); !got && time.Now().Before(end); {
		pumpFor(10 * time.Millisecond)
		got, err = c.acquire(50, func(px []byte, fw, fh, pitch int) error {
			w, h = fw, fh
			copy(center[:], px[(fh/2)*pitch+(fw/2)*4:])
			return nil
		})
		if err != nil {
			t.Fatalf("acquire: %v", err)
		}
	}
	if !got {
		t.Fatal("5 sn içinde WGC karesi gelmedi")
	}
	t.Logf("ilk kare %v sonra, %dx%d, orta piksel BGRA=%v", time.Since(start), w, h, center)
	if w < 100 || h < 100 {
		t.Errorf("kare boyutu %dx%d, beklenen ≥100x100 (pencere 320x240)", w, h)
	}
	if b, g, r := center[0], center[1], center[2]; r < 200 || g > 60 || b > 60 {
		t.Errorf("orta piksel kırmızı değil: B=%d G=%d R=%d", b, g, r)
	}
}
