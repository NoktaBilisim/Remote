//go:build windows

package helper

import (
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/win"
)

// AC-294 / mimari-p27 §5.5: gösterge kendi UI iş parçacığında çizilir (internal/ui içe aktarılmaz — o paket ileti kutusu
// ve URL açma içerir; AC-341). Her monitörde dört kırmızı kenar + üst-orta etiket; tıklama geçirgen, etkinleşmez,
// yakalamadan hariç (teknisyen görüntüsünde çift çerçeve yok), WM_CLOSE yok sayılır. 1 sn'de bir en üste alınır ve
// yeniden doğrulanır; doğrulama ya da WM_DISPLAYCHANGE sonrası yeniden çizim başarısızsa Failed kapanır.
// K6b: her gösterge kendi iş parçacığında giriş masaüstüne bağlanarak (desktop.Attach) çizilir; masaüstü değişince
// yardımcı yeni masaüstünde yeni gösterge kurar, eskisini kapatır (aynı anda iki gösterge iş parçacığı olabilir).

const (
	indicatorClass = "NoktaDestekGosterge"
	timerVerify    = 1
	wmQuit         = win.WM_APP + 1
	wmDisplay      = 0x007E // WM_DISPLAYCHANGE
	barThickness   = 5
	labelHeight    = 32
	showTimeout    = 2 * time.Second
)

var (
	colorBar     = win.RGB(185, 28, 28)
	indOnce      sync.Once
	indProc      uintptr
	indClassErr  error
	indByThread  sync.Map // iş parçacığı kimliği → *winIndicator (pencere yordamı kendi iş parçacığının göstergesini bulur)
	errIndicator = errors.New("helper: gösterge doğrulanamadı")
)

type winIndicator struct {
	text     string
	host     uintptr // görünmez üst düzey pencere: zamanlayıcı + WM_DISPLAYCHANGE
	wins     map[uintptr]shown
	failed   chan struct{}
	failOnce sync.Once
	done     chan struct{}
	desktop  string      // bağlandığı giriş masaüstü (K6b)
	quit     atomic.Bool // Close: başka masaüstündeki iş parçacığına ileti gitmezse zamanlayıcı görür
}

// showIndicator göstergeyi çizer ve doğrular (≤ 2 sn); doğrulanamazsa hata (bağlantı açılmaz).
func showIndicator(text string) (Indicator, error) {
	ind := &winIndicator{text: text, wins: map[uintptr]shown{}, failed: make(chan struct{}), done: make(chan struct{})}
	ready := make(chan error, 1)
	go ind.loop(ready)
	select {
	case err := <-ready:
		if err != nil {
			return nil, err
		}
		return ind, nil
	case <-time.After(showTimeout):
		return nil, errIndicator // iş parçacığı askıda: süreç zaten indicator_failed ile çıkar
	}
}

func (ind *winIndicator) loop(ready chan<- error) {
	runtime.LockOSThread() // bilerek açılmaz: iş parçacığı masaüstü bağıyla birlikte sonlanır
	defer close(ind.done)
	name, release, err := desktop.Attach() // pencere yokken: SetThreadDesktop pencereli iş parçacığında başarısız olur
	if err != nil {
		ready <- err
		return
	}
	defer release() // pencereler wmQuit/hata yolunda kaldırıldıktan sonra
	ind.desktop = name
	tid := windows.GetCurrentThreadId()
	indByThread.Store(tid, ind)
	defer indByThread.Delete(tid)
	indOnce.Do(func() {
		indProc = windows.NewCallback(indicatorProc)
		indClassErr = win.RegisterClass(indicatorClass, indProc, 0) // sınıf süreç geneli, masaüstünden bağımsız
	})
	if indClassErr != nil {
		ready <- indClassErr
		return
	}
	ind.host = win.CreateWindow(win.WS_EX_TOOLWINDOW, indicatorClass, "", win.WS_POPUP, 0, 0, 0, 0, 0, 0)
	if ind.host == 0 || !ind.rebuild() {
		ind.destroy()
		ready <- errIndicator
		return
	}
	win.SetTimer(ind.host, timerVerify, 1000)
	ready <- nil
	var m win.MSG
	for win.GetMessage(&m) > 0 {
		win.TranslateDispatch(&m)
	}
}

// rebuild tüm pencereleri kaldırıp güncel monitörlere göre yeniden çizer ve doğrular.
func (ind *winIndicator) rebuild() bool {
	ind.destroyBars()
	mons := win.Monitors()
	for i, m := range mons {
		mr := rect(m.Rect)
		bars, _ := layout(mr, barThickness, 0, 0)
		for _, b := range bars {
			ind.create(i, b, false)
		}
		_, lbl := layout(mr, barThickness, labelWidth(ind.text, int32(win.DPI(ind.host))), labelHeight)
		ind.create(i, lbl, true)
	}
	return ind.verify(mons)
}

func (ind *winIndicator) create(mon int, r rect, label bool) {
	ex := uint32(win.WS_EX_TOPMOST | win.WS_EX_TOOLWINDOW | win.WS_EX_NOACTIVATE | win.WS_EX_LAYERED | win.WS_EX_TRANSPARENT)
	h := win.CreateWindow(ex, indicatorClass, "", win.WS_POPUP, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top, 0, 0)
	if h == 0 {
		return // doğrulama eksik pencereyi yakalar
	}
	win.SetLayered(h, 0, 235, win.LWA_ALPHA)
	win.ExcludeFromCapture(h)
	win.ShowWindow(h, win.SW_SHOWNOACTIVATE)
	ind.wins[h] = shown{Monitor: mon, Label: label}
}

// verify her pencerenin varlığını, görünürlüğünü ve konumunu ölçer (§5.5).
func (ind *winIndicator) verify(mons []win.Monitor) bool {
	rs := make([]rect, len(mons))
	for i, m := range mons {
		rs[i] = rect(m.Rect)
	}
	ws := make([]shown, 0, len(ind.wins))
	for h, s := range ind.wins {
		s.Exists = win.IsWindow(h)
		s.Visible = s.Exists && windows.IsWindowVisible(windows.HWND(h))
		if r, ok := win.WindowBounds(h); ok {
			s.Rect = rect(r)
		}
		ws = append(ws, s)
	}
	return verifyLayout(rs, ws)
}

// tick 1 sn: en üste al, doğrula; başarısızsa bir kez yeniden çiz; o da başarısızsa Failed.
func (ind *winIndicator) tick() {
	if ind.quit.Load() {
		ind.destroy()
		win.PostQuitMessage()
		return
	}
	for h := range ind.wins {
		win.SetWindowPos(h, win.HWND_TOPMOST, 0, 0, 0, 0, win.SWP_NOMOVE|win.SWP_NOSIZE|win.SWP_NOACTIVATE|win.SWP_SHOWWINDOW)
	}
	if !ind.verify(win.Monitors()) && !ind.rebuild() {
		ind.fail()
	}
}

func (ind *winIndicator) fail() { ind.failOnce.Do(func() { close(ind.failed) }) }

func (ind *winIndicator) destroyBars() {
	for h := range ind.wins {
		win.DestroyWindow(h)
	}
	clear(ind.wins)
}

func (ind *winIndicator) destroy() {
	ind.destroyBars()
	if ind.host != 0 {
		win.DestroyWindow(ind.host)
		ind.host = 0
	}
}

// Failed Indicator.
func (ind *winIndicator) Failed() <-chan struct{} { return ind.failed }

// Desktop Indicator: göstergenin çizildiği giriş masaüstü.
func (ind *winIndicator) Desktop() string { return ind.desktop }

// Close pencereleri kaldırır ve iş parçacığını bitirir.
func (ind *winIndicator) Close() {
	ind.quit.Store(true)
	win.PostMessage(ind.host, wmQuit, 0, 0)
	select {
	case <-ind.done:
	case <-time.After(showTimeout):
	}
}

// indicatorProc pencere yordamı (yalnız gösterge iş parçacığında çalışır).
func indicatorProc(h uintptr, msg uint32, wp, lp uintptr) uintptr {
	v, ok := indByThread.Load(windows.GetCurrentThreadId())
	if !ok {
		return win.DefWindowProc(h, msg, wp, lp)
	}
	ind := v.(*winIndicator)
	switch {
	case msg == win.WM_PAINT:
		ind.paint(h)
		return 0
	case msg == win.WM_CLOSE:
		return 0 // kapatma yok (AC-294)
	case msg == win.WM_TIMER && h == ind.host:
		ind.tick()
		return 0
	case msg == wmDisplay && h == ind.host:
		if !ind.rebuild() { // §5.5: monitör eklendi/çıktı → aynı doğrulama
			ind.fail()
		}
		return 0
	case msg == wmQuit && h == ind.host:
		ind.destroy()
		win.PostQuitMessage()
		return 0
	}
	return win.DefWindowProc(h, msg, wp, lp)
}

// paint kırmızı zemin; etiket penceresinde beyaz metin (sunucudan gelen indicatorText, TEST öneki dahil).
func (ind *winIndicator) paint(h uintptr) {
	var ps win.PAINTSTRUCT
	dc := win.BeginPaint(h, &ps)
	defer win.EndPaint(h, &ps)
	r := win.ClientRect(h)
	br := win.SolidBrush(colorBar)
	win.FillRect(dc, &r, br)
	win.DeleteObject(br)
	if !ind.wins[h].Label {
		return
	}
	ft := win.Font(int32(-15*win.DPI(h)/96), win.FW_SEMIBOLD)
	old := win.SelectObject(dc, ft)
	win.SetBkMode(dc, win.TRANSPARENT)
	win.SetTextColor(dc, win.RGB(255, 255, 255))
	win.DrawText(dc, ind.text, &r, win.DT_CENTER|win.DT_VCENTER|win.DT_SINGLELINE|win.DT_NOPREFIX)
	win.SelectObject(dc, old)
	win.DeleteObject(ft)
}
