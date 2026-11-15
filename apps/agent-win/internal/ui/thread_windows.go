//go:build windows

package ui

import (
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/win"
)

// inputMark şu an işlenen girdi mesajı ve kaynağı (S7-5). İzin düğmesinin BN_CLICKED'i bu mesajın işlenmesi
// sırasında gelir; böylece karar sistem genelindeki "son basış"a değil, tıklamayı üreten olayın kendisine dayanır.
type inputMark struct {
	f        *form
	msg      uint32
	injected bool
}

type thread struct {
	cur    inputMark // yalnız UI iş parçacığında
	mu     sync.Mutex
	queue  []func()
	msgWnd uintptr
	forms  map[uintptr]*form
	done   chan struct{}
	theme  themeState // AC-247; yalnız UI iş parçacığında
}

var (
	theThread *thread
	procOnce  sync.Once
	wndProc   uintptr
)

// startThread UI iş parçacığını başlatır ve hazır olmasını bekler.
func startThread() (*thread, error) {
	t := &thread{forms: map[uintptr]*form{}, done: make(chan struct{})}
	theThread = t
	ready := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer close(t.done)
		procOnce.Do(func() { wndProc = windows.NewCallback(dispatch) })
		t.loadTheme()
		bg := win.SysColorBrush(win.COLOR_WINDOW)
		for _, c := range []string{classForm, classBar, classOverlay} {
			if err := win.RegisterClass(c, wndProc, bg); err != nil {
				ready <- err
				return
			}
		}
		t.msgWnd = win.CreateWindow(0, classForm, "", 0, 0, 0, 0, 0, hwndMessage, 0)
		ready <- nil
		t.loop()
	}()
	if err := <-ready; err != nil {
		return nil, err
	}
	return t, nil
}

func (t *thread) loop() {
	var m win.MSG
	for win.GetMessage(&m) > 0 {
		t.track(&m)
		t.handle(&m)
		// S7-14: işaret yalnız bu mesajın işlenmesi süresince geçerli. Sonraki GetMessage içinde teslim edilen
		// gönderilmiş (sent) bir BM_CLICK önceki yerel tıklamanın işaretini görmemeli.
		t.cur = inputMark{}
	}
}

func (t *thread) handle(m *win.MSG) {
	if m.Message == win.WM_KEYDOWN || m.Message == win.WM_KEYUP || m.Message == win.WM_CHAR {
		if (m.WParam == win.VK_RETURN || m.WParam == win.VK_SPACE) && t.isNoKey(m.Hwnd) {
			return
		}
	}
	if f := t.forms[win.Root(m.Hwnd)]; f != nil && f.ctrls != nil && win.IsDialogMessage(f.h, m) {
		return
	}
	win.TranslateDispatch(m)
}

// track S7-5/S7-12: form penceresine gelen girdi mesajının kaynağını (GetCurrentInputMessageSource) kaydeder; karar
// control.OriginInjected'dadır (yalnız IMO_HARDWARE yerel, gerisi enjekte — fail-closed). Fare tıklaması = basış +
// bırakma; ikisinden biri enjekteyse tıklama enjekte sayılır. Erişim tuşu (Alt+İ) WM_SYSCHAR ile gelir; kaynağı
// bilinmiyorsa onu üreten tuş basışının kararı kullanılır (control.CharInjected).
func (t *thread) track(m *win.MSG) {
	t.cur = inputMark{}
	f := t.forms[win.Root(m.Hwnd)]
	if f == nil {
		return
	}
	origin, ok := win.InputOrigin()
	inj := control.OriginInjected(origin, ok)
	switch m.Message {
	case win.WM_LBUTTONDOWN, win.WM_LBUTTONDBLCLK:
		f.downInjected = inj
	case win.WM_LBUTTONUP:
		t.cur = inputMark{f: f, msg: m.Message, injected: inj || f.downInjected}
	case win.WM_KEYDOWN, win.WM_SYSKEYDOWN:
		f.keyInjected = inj
		t.cur = inputMark{f: f, msg: m.Message, injected: f.keyInjected}
	case win.WM_CHAR, win.WM_SYSCHAR:
		t.cur = inputMark{f: f, msg: m.Message, injected: control.CharInjected(f.keyInjected, origin, ok)}
	}
}

// userInput S7-5: şu an işlenen mesaj f formuna gelen, enjekte olmayan yerel bir tıklama/tuş mu. Girdi mesajı
// işlenmiyorsa (ör. başka bir sürecin gönderdiği WM_COMMAND/BM_CLICK) false.
func (t *thread) userInput(f *form) bool { return t.cur.f == f && !t.cur.injected }

func (t *thread) isNoKey(h uintptr) bool {
	for _, f := range t.forms {
		if f.noKey != 0 && f.noKey == h {
			return true
		}
	}
	return false
}

// Do işi UI iş parçacığında çalıştırır (beklemez).
func (t *thread) Do(fn func()) {
	t.mu.Lock()
	t.queue = append(t.queue, fn)
	t.mu.Unlock()
	win.PostMessage(t.msgWnd, win.WM_APP, 0, 0)
}

// Quit tüm pencereleri kapatır ve döngüyü bitirir.
func (t *thread) Quit() {
	t.Do(func() {
		for _, f := range t.forms {
			f.destroy()
		}
		win.PostQuitMessage()
	})
	<-t.done
}

func (t *thread) runQueue() {
	t.mu.Lock()
	q := t.queue
	t.queue = nil
	t.mu.Unlock()
	for _, fn := range q {
		fn()
	}
}

func loword(v uintptr) int { return int(v & 0xFFFF) }
func hiword(v uintptr) int { return int((v >> 16) & 0xFFFF) }

// dispatch tüm pencerelerin pencere yordamı: UI kuyruğu (msgWnd), form geri çağrıları, AC-247 tema mesajları ve
// pencere mesajları (DPI, boyama). İşlenmeyen mesaj DefWindowProc'a gider.
func dispatch(h uintptr, msg uint32, wp, lp uintptr) uintptr {
	t := theThread
	if h == t.msgWnd && msg == win.WM_APP {
		t.runQueue()
		return 0
	}
	f := t.forms[h]
	if f == nil {
		return win.DefWindowProc(h, msg, wp, lp)
	}
	if r, ok := f.callbackMsg(msg, wp); ok {
		return r
	}
	if r, ok := f.themeMsg(t, msg, wp, lp); ok {
		return r
	}
	if r, ok := f.windowMsg(h, msg, wp, lp); ok {
		return r
	}
	return win.DefWindowProc(h, msg, wp, lp)
}

// callbackMsg formun komut/kapatma/zamanlayıcı/etkinleşme geri çağrıları. WM_ACTIVATE işlenmiş sayılmaz
// (DefWindowProc'a da gider).
func (f *form) callbackMsg(msg uint32, wp uintptr) (uintptr, bool) {
	switch msg {
	case win.WM_COMMAND:
		if f.command != nil {
			f.command(loword(wp), hiword(wp))
		}
		return 0, true
	case win.WM_CLOSE:
		if f.close != nil {
			f.close()
		}
		return 0, true
	case win.WM_TIMER:
		if f.timer != nil {
			f.timer(wp)
		}
		return 0, true
	case win.WM_ACTIVATE:
		if f.activate != nil {
			f.activate(loword(wp) != 0)
		}
	}
	return 0, false
}

// themeMsg AC-247 denetim renkleri, zemin silme ve sistem tema değişikliği.
func (f *form) themeMsg(t *thread, msg uint32, wp, lp uintptr) (uintptr, bool) {
	switch msg {
	case win.WM_CTLCOLORSTATIC:
		return f.ctlColorStatic(wp, lp), true
	case win.WM_CTLCOLOREDIT, win.WM_CTLCOLORLISTBOX:
		return f.ctlColorField(wp)
	case win.WM_CTLCOLORBTN:
		if f.themed && t.theme.dark {
			return t.bgBrush(), true
		}
	case win.WM_SETTINGCHANGE:
		if wp == win.SPI_SETHIGHCONTRAST || win.SettingName(lp) == "ImmersiveColorSet" {
			t.refreshTheme()
		}
	case win.WM_ERASEBKGND:
		if f.paint != nil || f.eraseThemed(wp) {
			return 1, true
		}
	}
	return 0, false
}

// windowMsg DPI değişikliği (yeniden yerleşim + önerilen dikdörtgen) ve boyama geri çağrısı.
func (f *form) windowMsg(h uintptr, msg uint32, wp, lp uintptr) (uintptr, bool) {
	switch msg {
	case win.WM_DPICHANGED:
		f.dpi = loword(wp)
		r := *(**win.RECT)(unsafe.Pointer(&lp)) // lParam: önerilen pencere dikdörtgeni
		f.layout()
		win.SetWindowPos(h, 0, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top, win.SWP_NOZORDER|win.SWP_NOACTIVATE)
		return 0, true
	case win.WM_PAINT:
		if f.paint != nil {
			var ps win.PAINTSTRUCT
			dc := win.BeginPaint(h, &ps)
			f.paint(dc, win.ClientRect(h))
			win.EndPaint(h, &ps)
			return 0, true
		}
	}
	return 0, false
}
