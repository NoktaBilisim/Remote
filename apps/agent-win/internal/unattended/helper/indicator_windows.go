//go:build windows

package helper

import (
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/annot"
	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/win"
)

// AC-294 / mimari-p27 §5.5: gösterge kendi UI iş parçacığında çizilir (internal/ui içe aktarılmaz — o paket ileti kutusu
// ve URL açma içerir; AC-341). Her monitörde dört kırmızı kenar + üst-orta etiket; tıklama geçirgen, etkinleşmez,
// yakalamadan hariç (teknisyen görüntüsünde çift çerçeve yok), WM_CLOSE yok sayılır. 1 sn'de bir en üste alınır ve
// yeniden doğrulanır; doğrulama ya da WM_DISPLAYCHANGE sonrası yeniden çizim başarısızsa Failed kapanır.
// K6b: her gösterge kendi iş parçacığında giriş masaüstüne bağlanarak (desktop.Attach) çizilir; masaüstü değişince
// yardımcı yeni masaüstünde yeni gösterge kurar, eskisini kapatır (aynı anda iki gösterge iş parçacığı olabilir).
// P30 (mimari-p30 K-P30-1..4): teknisyen çizimleri aynı iş parçacığında, aynı sınıfla kurulan işaretleme katmanında
// (paylaşılan monitörü kaplayan renk anahtarlı pencere) boyanır. Katman göstergenin doğrulama kümesine (wins) girmez,
// gösterge dikdörtgenlerine boyamaz ve her en üste alma turunda göstergenin altında kalır; kurulamazsa yalnız çizim
// görünmez (Failed kapanmaz).

const (
	indicatorClass = "NoktaDestekGosterge"
	timerVerify    = 1
	wmQuit         = win.WM_APP + 1
	wmDisplay      = 0x007E // WM_DISPLAYCHANGE
	wmRelabel      = win.WM_APP + 3
	wmAnnot        = win.WM_APP + 4
	timerLaser     = 2
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

// indicatorExStyle gösterge pencereleri ve işaretleme katmanı: en üstte, görev çubuğunda yok, etkinleşmez, katmanlı,
// tıklama geçirgen (AC-294, AC-495).
const indicatorExStyle = uint32(win.WS_EX_TOPMOST | win.WS_EX_TOOLWINDOW | win.WS_EX_NOACTIVATE | win.WS_EX_LAYERED |
	win.WS_EX_TRANSPARENT)

type winIndicator struct {
	text     string // yalnız gösterge iş parçacığında; SetText next üzerinden iletir
	next     atomic.Pointer[string]
	drawn    atomic.Pointer[string] // P28c: son doğrulanmış çizimin etiketi (Drawn)
	host     uintptr                // görünmez üst düzey pencere: zamanlayıcı + WM_DISPLAYCHANGE
	wins     map[uintptr]shown
	failed   chan struct{}
	failOnce sync.Once
	done     chan struct{}
	desktop  string      // bağlandığı giriş masaüstü (K6b)
	quit     atomic.Bool // Close: başka masaüstündeki iş parçacığına ileti gitmezse zamanlayıcı görür

	// P30 işaretleme katmanı (yalnız gösterge iş parçacığında; layer testte okunur).
	annNext   atomic.Pointer[annotSnap] // Paint → iş parçacığı (ileti başka masaüstünde kaybolursa tick uygular)
	ann       annotSnap
	layer     atomic.Uintptr
	layerRect rect
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
	ind.markDrawn()
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
	if l := ind.layer.Load(); l != 0 {
		win.Invalidate(l) // etiket genişliği değişmiş olabilir (kırpma)
	}
	return ind.verify(mons)
}

func (ind *winIndicator) create(mon int, r rect, label bool) {
	h := win.CreateWindow(indicatorExStyle, indicatorClass, "", win.WS_POPUP, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top, 0, 0)
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
	ind.relabel()
	ind.applyAnnot()
	ind.raise()
	if !ind.verify(win.Monitors()) && !ind.rebuild() {
		ind.fail()
	}
}

// raise K-P30-3: önce katman, sonra gösterge pencereleri en üste (gösterge çizimin üstünde kalır).
func (ind *winIndicator) raise() {
	hs := make([]uintptr, 0, len(ind.wins))
	for h := range ind.wins {
		hs = append(hs, h)
	}
	for _, h := range raiseOrder(ind.layer.Load(), hs) {
		win.SetWindowPos(h, win.HWND_TOPMOST, 0, 0, 0, 0, win.SWP_NOMOVE|win.SWP_NOSIZE|win.SWP_NOACTIVATE|win.SWP_SHOWWINDOW)
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
	if l := ind.layer.Swap(0); l != 0 {
		win.DestroyWindow(l)
	}
	if ind.host != 0 {
		win.DestroyWindow(ind.host)
		ind.host = 0
	}
}

// Failed Indicator.
func (ind *winIndicator) Failed() <-chan struct{} { return ind.failed }

// Desktop Indicator: göstergenin çizildiği giriş masaüstü.
func (ind *winIndicator) Desktop() string { return ind.desktop }

// SetText etiketi (P28c ad eki, P28e kayıt eki) gösterge iş parçacığında değiştirir; genişlik değiştiği için
// pencereler yeniden çizilip doğrulanır, başarısızsa Failed (fail-closed). ≤ 1 sn (en geç sonraki doğrulama tiki).
func (ind *winIndicator) SetText(text string) {
	ind.next.Store(&text)
	win.PostMessage(ind.host, wmRelabel, 0, 0)
}

// relabel bekleyen etiketi uygular (yalnız gösterge iş parçacığında; ileti başka masaüstünde kaybolursa tick uygular).
func (ind *winIndicator) relabel() {
	p := ind.next.Swap(nil)
	if p == nil || *p == ind.text {
		return
	}
	ind.text = *p
	if !ind.rebuild() {
		ind.fail()
		return
	}
	ind.markDrawn()
}

func (ind *winIndicator) markDrawn() {
	t := ind.text
	ind.drawn.Store(&t)
}

// Drawn P28c (Y-PC-4): text çizilip doğrulandı mı; en çok wait bekler (yeniden çizim gösterge iş parçacığında).
func (ind *winIndicator) Drawn(text string, wait time.Duration) bool {
	deadline := time.Now().Add(wait)
	for {
		if p := ind.drawn.Load(); p != nil && *p == text {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		select {
		case <-ind.failed:
			return false
		case <-time.After(20 * time.Millisecond):
		}
	}
}

// Paint P30 (painter): çizim anlık görüntüsünü gösterge iş parçacığına iletir (engellemez).
func (ind *winIndicator) Paint(s annotSnap) {
	ind.annNext.Store(&s)
	win.PostMessage(ind.host, wmAnnot, 0, 0)
}

// applyAnnot bekleyen anlık görüntüyü uygular (yalnız gösterge iş parçacığında).
func (ind *winIndicator) applyAnnot() {
	p := ind.annNext.Swap(nil)
	if p == nil {
		return
	}
	ind.ann = *p
	ind.placeLayer()
	l := ind.layer.Load()
	if l == 0 {
		return
	}
	if ind.ann.Laser != nil {
		win.SetTimer(l, timerLaser, 100)
	}
	win.Invalidate(l)
}

// placeLayer katmanı paylaşılan monitörün dikdörtgenine kurar ya da taşır (K-P30-4). Çizim yoksa yeni katman kurulmaz;
// monitör bilinmiyor/yoksa katman kaldırılır. Hata yalnız çizimi gizler: Failed kapanmaz (K-P30-2).
func (ind *winIndicator) placeLayer() {
	mons := win.Monitors()
	id := ind.ann.Surface
	l := ind.layer.Load()
	if id < 1 || id > len(mons) {
		if l != 0 {
			win.DestroyWindow(ind.layer.Swap(0))
		}
		return
	}
	r := rect(mons[id-1].Rect)
	switch {
	case l == 0:
		if len(ind.ann.Strokes) == 0 && ind.ann.Laser == nil {
			return
		}
		h := win.CreateWindow(indicatorExStyle, indicatorClass, "", win.WS_POPUP, r.Left, r.Top, r.Right-r.Left,
			r.Bottom-r.Top, 0, 0)
		if h == 0 {
			return
		}
		ind.layer.Store(h) // boyama yordamı katmanı tanısın (kırmızı zemin boyanmaz)
		win.SetLayered(h, annot.ColorKey, 0, win.LWA_COLORKEY)
		win.ExcludeFromCapture(h)
		win.ShowWindow(h, win.SW_SHOWNOACTIVATE)
	case r != ind.layerRect:
		win.SetWindowPos(l, win.HWND_TOPMOST, r.Left, r.Top, r.Right-r.Left, r.Bottom-r.Top, win.SWP_NOACTIVATE)
		win.Invalidate(l)
	default:
		return
	}
	ind.layerRect = r
	ind.raise() // yeni/taşınan katman göstergenin üstüne çıkmış olabilir
}

// laserTick lazer son iletiden laserTTL sonra söner.
func (ind *winIndicator) laserTick(l uintptr) {
	if ind.ann.Laser == nil || time.Since(ind.ann.LaserAt) > laserTTL {
		ind.ann.Laser = nil
		win.KillTimer(l, timerLaser)
		win.Invalidate(l)
	}
}

// paintLayer çizimler (internal/annot); gösterge kenar + etiket dikdörtgenleri kırpılır (K-P30-3).
func (ind *winIndicator) paintLayer(h uintptr) {
	var ps win.PAINTSTRUCT
	dc := win.BeginPaint(h, &ps)
	defer win.EndPaint(h, &ps)
	dpi := int32(win.DPI(h))
	var ex []win.RECT
	for _, r := range annotExclude(ind.layerRect, barThickness, labelWidth(ind.text, int32(win.DPI(ind.host))), labelHeight) {
		ex = append(ex, win.RECT(r))
	}
	annot.Paint(dc, win.ClientRect(h), ind.ann.Strokes, ind.ann.Laser, func(v int32) int32 { return v * dpi / 96 }, ex)
}

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
	layer := ind.layer.Load()
	switch {
	case msg == win.WM_PAINT && layer != 0 && h == layer:
		ind.paintLayer(h)
		return 0
	case msg == win.WM_TIMER && layer != 0 && h == layer:
		ind.laserTick(h)
		return 0
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
		ind.placeLayer() // K-P30-4: katman paylaşılan monitörün yeni dikdörtgenine
		return 0
	case msg == wmAnnot && h == ind.host:
		ind.applyAnnot()
		return 0
	case msg == wmRelabel && h == ind.host:
		ind.relabel()
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
	if _, ok := ind.wins[h]; !ok {
		return // görünmez ana pencere; katman paintLayer'da
	}
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
