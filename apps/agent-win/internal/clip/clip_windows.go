//go:build windows

package clip

import (
	"runtime"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Win32 pano (mimari-p28 §5.3 r2 D-P28a-2): işlemler UI iş parçacığında değil, kendi gizli (yalnız ileti, HWND_MESSAGE)
// penceresi olan ayrı bir kilitli iş parçacığında yürür; çağıran en çok Timeout bekler. Biçim denetimi, GlobalSize ve
// okuma/yazma tek OpenClipboard…CloseClipboard oturumundadır. Go belleğine yapılan kopyalar RtlMoveMemory ile
// (uintptr → unsafe.Pointer dönüşümü yok; S6-1 kuralı: işaretçi dönüşümü yalnız Call argümanında).

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
	wmRun         = 0x8000 + 0x28 // WM_APP + n: bekleyen işi çalıştır
	wmStop        = 0x8000 + 0x29 // WM_APP + n: pencereyi kapat, döngüden çık
	hwndMessage   = ^uintptr(2)   // HWND_MESSAGE (-3)
	openTries     = 10            // §5.3: meşgulse 10 × 50 ms
	openBackoff   = 50 * time.Millisecond
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	pCreateWindowExW            = user32.NewProc("CreateWindowExW")
	pDestroyWindow              = user32.NewProc("DestroyWindow")
	pGetMessageW                = user32.NewProc("GetMessageW")
	pTranslateMessage           = user32.NewProc("TranslateMessage")
	pDispatchMessageW           = user32.NewProc("DispatchMessageW")
	pPostMessageW               = user32.NewProc("PostMessageW")
	pOpenClipboard              = user32.NewProc("OpenClipboard")
	pCloseClipboard             = user32.NewProc("CloseClipboard")
	pEmptyClipboard             = user32.NewProc("EmptyClipboard")
	pGetClipboardData           = user32.NewProc("GetClipboardData")
	pSetClipboardData           = user32.NewProc("SetClipboardData")
	pIsClipboardFormatAvailable = user32.NewProc("IsClipboardFormatAvailable")
	pRegisterClipboardFormatW   = user32.NewProc("RegisterClipboardFormatW")
	pGlobalAlloc                = kernel32.NewProc("GlobalAlloc")
	pGlobalFree                 = kernel32.NewProc("GlobalFree")
	pGlobalLock                 = kernel32.NewProc("GlobalLock")
	pGlobalUnlock               = kernel32.NewProc("GlobalUnlock")
	pGlobalSize                 = kernel32.NewProc("GlobalSize")
	pRtlMoveMemory              = kernel32.NewProc("RtlMoveMemory")
)

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      [2]int32
	private uint32
}

// formats kayıtlı biçim kimlikleri (pano iş parçacığında bir kez).
type formats struct{ exclude, viewerIgnore, history, cloud uintptr }

type winClip struct {
	hwnd    uintptr
	fmts    formats
	reqs    chan func()
	stop    sync.Once
	stopped chan struct{}
}

// New pano iş parçacığını ve gizli penceresini başlatır.
func New() (Clipboard, error) {
	c := &winClip{reqs: make(chan func(), 1), stopped: make(chan struct{})}
	ready := make(chan error, 1)
	go c.loop(ready)
	if err := <-ready; err != nil {
		return nil, err
	}
	return c, nil
}

// loop kilitli iş parçacığı: pencere + ileti döngüsü. Başka süreçlerin pano iletileri (WM_DESTROYCLIPBOARD vb.)
// DispatchMessage ile STATIC sınıfının varsayılan işlemine gider; döngü bunları bekletmez.
func (c *winClip) loop(ready chan<- error) {
	runtime.LockOSThread() // bırakılmaz: goroutine bitince iş parçacığı da biter
	defer close(c.stopped)
	cls, _ := windows.UTF16PtrFromString("STATIC")
	h, _, _ := pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(cls)), 0, 0, 0, 0, 0, 0, hwndMessage, 0, 0, 0)
	if h == 0 {
		ready <- ErrFailed
		return
	}
	c.hwnd = h
	c.fmts = formats{register(FormatExclude), register(FormatViewerIgnore), register(FormatHistory), register(FormatCloud)}
	if c.fmts.exclude == 0 || c.fmts.viewerIgnore == 0 || c.fmts.history == 0 || c.fmts.cloud == 0 {
		_, _, _ = pDestroyWindow.Call(h)
		ready <- ErrFailed
		return
	}
	ready <- nil
	var m msg
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
		switch m.message {
		case wmRun:
			select {
			case f := <-c.reqs:
				f()
			default:
			}
			continue
		case wmStop:
			_, _, _ = pDestroyWindow.Call(c.hwnd)
			return
		}
		_, _, _ = pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		_, _, _ = pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func register(name string) uintptr {
	p, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0
	}
	r, _, _ := pRegisterClipboardFormatW.Call(uintptr(unsafe.Pointer(p)))
	return r
}

// do işi pano iş parçacığına verir ve en çok Timeout bekler. İş parçacığı meşgulse (önceki iş takıldı) hemen
// ErrFailed; geç kalan iş son tarihi geçtiyse panoya dokunmadan döner.
func (c *winClip) do(op func(deadline time.Time) error) error {
	deadline := time.Now().Add(Timeout)
	res := make(chan error, 1)
	select {
	case <-c.stopped:
		return ErrFailed
	case c.reqs <- func() { res <- op(deadline) }:
	default:
		return ErrFailed
	}
	if r, _, _ := pPostMessageW.Call(c.hwnd, wmRun, 0, 0); r == 0 {
		return ErrFailed
	}
	t := time.NewTimer(Timeout)
	defer t.Stop()
	select {
	case err := <-res:
		return err
	case <-t.C:
		return ErrFailed
	}
}

func (c *winClip) Close() {
	c.stop.Do(func() {
		if r, _, _ := pPostMessageW.Call(c.hwnd, wmStop, 0, 0); r != 0 {
			<-c.stopped
		}
	})
}

// open panoyu gizli pencereyle açar; meşgulse 10 × 50 ms (son tarihe kadar) dener.
func (c *winClip) open(deadline time.Time) bool {
	for i := 0; i < openTries; i++ {
		if time.Now().After(deadline) {
			return false
		}
		if r, _, _ := pOpenClipboard.Call(c.hwnd); r != 0 {
			return true
		}
		time.Sleep(openBackoff)
	}
	return false
}

func closeClipboard() { _, _, _ = pCloseClipboard.Call() }

func available(f uintptr) bool {
	r, _, _ := pIsClipboardFormatAvailable.Call(f)
	return r != 0
}

func (c *winClip) ReadText() (string, error) {
	var s string
	err := c.do(func(deadline time.Time) (err error) {
		s, err = c.read(deadline)
		return err
	})
	return s, err
}

// read tek açık oturumda: gizlilik işaretleri → CF_UNICODETEXT → GlobalSize sınırı (kopyalamadan) → kopya.
func (c *winClip) read(deadline time.Time) (string, error) {
	if !c.open(deadline) {
		return "", ErrFailed
	}
	defer closeClipboard()
	if c.marks().sensitive() {
		return "", ErrSensitive
	}
	if !available(cfUnicodeText) {
		return "", ErrEmpty
	}
	h, _, _ := pGetClipboardData.Call(cfUnicodeText)
	if h == 0 {
		return "", ErrEmpty
	}
	size, _, _ := pGlobalSize.Call(h)
	if err := checkGlobalSize(size); err != nil {
		return "", err
	}
	units := make([]uint16, size/2)
	if !copyFrom(h, unsafe.Pointer(&units[0]), uintptr(len(units))*2) {
		return "", ErrFailed
	}
	s, err := decodeUTF16(units)
	clear(units)
	return s, err
}

// marks dört gizlilik biçimini okur (açık oturumda).
func (c *winClip) marks() marks {
	m := marks{exclude: available(c.fmts.exclude), viewerIgnore: available(c.fmts.viewerIgnore)}
	m.historyZero = available(c.fmts.history) && flagZero(readDWORD(c.fmts.history))
	m.cloudZero = available(c.fmts.cloud) && flagZero(readDWORD(c.fmts.cloud))
	return m
}

func readDWORD(f uintptr) ([]byte, bool) {
	h, _, _ := pGetClipboardData.Call(f)
	if h == 0 {
		return nil, false
	}
	if size, _, _ := pGlobalSize.Call(h); size < 4 {
		return nil, false
	}
	b := make([]byte, 4)
	if !copyFrom(h, unsafe.Pointer(&b[0]), 4) {
		return nil, false
	}
	return b, true
}

// copyFrom global bellekten Go belleğine (yığın dilimi) n bayt kopyalar.
func copyFrom(h uintptr, dst unsafe.Pointer, n uintptr) bool {
	p, _, _ := pGlobalLock.Call(h)
	if p == 0 {
		return false
	}
	_, _, _ = pRtlMoveMemory.Call(uintptr(dst), p, n)
	_, _, _ = pGlobalUnlock.Call(h)
	return true
}

func (c *winClip) WriteText(s string) error {
	units, err := encodeUTF16(s)
	if err != nil {
		return err
	}
	defer clear(units)
	return c.do(func(deadline time.Time) error { return c.write(deadline, units) })
}

// write tek açık oturumda: EmptyClipboard + geçmiş/bulut dışı işaretleri (değer 0) + metin. Herhangi biri konamazsa
// pano boşaltılır (metin geçmişe düşebilecek biçimde bırakılmaz).
func (c *winClip) write(deadline time.Time, units []uint16) error {
	text := allocCopy(unsafe.Pointer(&units[0]), uintptr(len(units))*2)
	zero := make([]byte, 4)
	hist := allocCopy(unsafe.Pointer(&zero[0]), 4)
	cloud := allocCopy(unsafe.Pointer(&zero[0]), 4)
	pending := map[uintptr]uintptr{c.fmts.history: hist, c.fmts.cloud: cloud, cfUnicodeText: text}
	defer func() {
		for _, h := range pending {
			if h != 0 {
				_, _, _ = pGlobalFree.Call(h)
			}
		}
	}()
	if text == 0 || hist == 0 || cloud == 0 || !c.open(deadline) {
		return ErrFailed
	}
	defer closeClipboard()
	if time.Now().After(deadline) {
		return ErrFailed
	}
	if r, _, _ := pEmptyClipboard.Call(); r == 0 {
		return ErrFailed
	}
	for _, f := range []uintptr{c.fmts.history, c.fmts.cloud, cfUnicodeText} {
		if r, _, _ := pSetClipboardData.Call(f, pending[f]); r == 0 {
			_, _, _ = pEmptyClipboard.Call()
			return ErrFailed
		}
		delete(pending, f) // sahiplik sistemde
	}
	return nil
}

// allocCopy n baytlık taşınabilir global bellek ayırıp src'yi (yığın dilimi) kopyalar; hata 0.
func allocCopy(src unsafe.Pointer, n uintptr) uintptr {
	h, _, _ := pGlobalAlloc.Call(gmemMoveable, n)
	if h == 0 {
		return 0
	}
	p, _, _ := pGlobalLock.Call(h)
	if p == 0 {
		_, _, _ = pGlobalFree.Call(h)
		return 0
	}
	_, _, _ = pRtlMoveMemory.Call(p, uintptr(src), n)
	_, _, _ = pGlobalUnlock.Call(h)
	return h
}
