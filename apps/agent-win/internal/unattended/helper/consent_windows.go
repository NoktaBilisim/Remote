//go:build windows

package helper

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/win"
)

// P28u onay diyaloğu (mimari-p28u §7.3, ADR-0033; AC-431). P28a ortak izin diyaloğunun (internal/ui newConsent) kuralları
// aynen, internal/ui içe aktarılmadan (AC-341) ham Win32 ile: "Reddet" varsayılan ve odakta; "İzin ver" 1,5 sn kilitli,
// Enter/Space tetiklemez, enjekte tıklama/tuş yok sayılır (uyarı satırı), imleç altında açılmaz; Esc/kapatma = Reddet.
// Yalnız `Default` giriş masaüstünde çizilir; masaüstü değişince gizlenir (sayaç sürer), dönünce kilit yeniden başlar.
// Örtülme (control.Guard): 250 ms + tıklama anı GW_HWNDPREV taraması, WindowFromPoint ek doğrulama (K6s §2a).

const (
	consentClass = "NoktaDestekOnay"
	idGrant      = 100
	timerConsent = 1
	wmStop       = win.WM_APP + 2
	colorBtnFace = 15
	consentPoll  = 250 * time.Millisecond
)

type consentWin struct {
	sp                                    ConsentSpec
	h, remain, warn, deny, grant, rec     uintptr
	guard                                 *control.Guard
	shownAt                               time.Time
	cur                                   inputMark
	downInj, keyInj, hidden, decided, inj bool
	grantOn                               bool
	w, hgt                                int32
	ticks                                 int
	fonts                                 []uintptr
	result                                chan string
}

var (
	// consentLabel sürüm etiketi (flow.VersionLabel(config.Version); 2026-11-18): pencere başlığının sonunda. Main bir
	// kez, diyalog açılmadan önce yazar. ui/uicore bu pakete yasak (AC-341), biçim flow'dan gelir.
	consentLabel  string
	consentProcCB uintptr
	consentCur    *consentWin // yalnız diyalog iş parçacığında (süreç başına tek diyalog)
)

// askConsentWin AskConsent: diyalog kendi iş parçacığında; ctx bitince timeout.
func askConsentWin(ctx context.Context, sp ConsentSpec) (string, time.Time) {
	c := &consentWin{sp: sp, result: make(chan string, 1)}
	done := make(chan struct{})
	go func() { defer close(done); c.loop(ctx) }()
	<-done
	select {
	case d := <-c.result:
		return d, c.shownAt
	default:
	}
	if c.guard == nil && ctx.Err() == nil {
		return decisionFailed, time.Time{} // pencere kurulamadı
	}
	return helperio.DecisionTimeout, c.shownAt
}

func (c *consentWin) loop(ctx context.Context) {
	runtime.LockOSThread() // masaüstü bağı iş parçacığıyla biter
	release := attachDefault(ctx)
	if release == nil {
		return
	}
	defer release()
	if consentProcCB == 0 {
		consentProcCB = windows.NewCallback(consentProc)
		if win.RegisterClass(consentClass, consentProcCB, win.SysColorBrush(colorBtnFace)) != nil {
			return
		}
	}
	consentCur = c
	defer func() { consentCur = nil }()
	if !c.build() {
		return
	}
	stop := context.AfterFunc(ctx, func() { win.PostMessage(c.h, wmStop, 0, 0) })
	defer stop()
	var m win.MSG
	for win.GetMessage(&m) > 0 {
		c.track(&m)
		key := m.Message == win.WM_KEYDOWN || m.Message == win.WM_KEYUP || m.Message == win.WM_CHAR
		if !(key && (m.WParam == win.VK_RETURN || m.WParam == win.VK_SPACE) && m.Hwnd == c.grant) &&
			!win.IsDialogMessage(c.h, &m) {
			win.TranslateDispatch(&m)
		}
		c.cur = inputMark{}
	}
}

// attachDefault iş parçacığını giriş masaüstü `Default` olduğunda ona bağlar (Winlogon/UAC'de asla); ctx bitince nil.
func attachDefault(ctx context.Context) func() {
	for {
		if name, rel, err := desktop.Attach(); err == nil {
			if name == "Default" {
				return rel
			}
			rel()
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(consentPoll):
		}
	}
}

func (c *consentWin) build() bool {
	tx := flow.UnattendedConsentTexts
	style := uint32(win.WS_POPUP | win.WS_CAPTION | win.WS_SYSMENU)
	ex := uint32(win.WS_EX_TOPMOST | win.WS_EX_CONTROLPARENT)
	if c.h = win.CreateWindow(ex, consentClass, consentTitle(tx.Title, consentLabel), style, 0, 0, 10, 10, 0, 0); c.h == 0 {
		return false
	}
	dpi := int32(win.DPI(c.h))
	s := func(v int32) int32 { return v * dpi / 96 }
	c.fonts = []uintptr{win.Font(-s(15), win.FW_NORMAL), win.Font(-s(15), win.FW_SEMIBOLD)}
	label := func(text string, y, hgt int32, bold int) uintptr {
		h := win.CreateWindow(0, "STATIC", text, win.WS_CHILD|win.WS_VISIBLE|win.SS_NOPREFIX, s(16), s(y), s(408), s(hgt), c.h, 0)
		win.SendMessage(h, win.WM_SETFONT, c.fonts[bold], 1)
		return h
	}
	label(tx.Title, 14, 24, 1)
	label(fmt.Sprintf(tx.Body, c.sp.TechName, c.sp.TenantName), 44, 40, 0)
	label(fmt.Sprintf(tx.Company, c.sp.TenantName), 86, 22, 1) // D-P28u-6: firma ayrı, kalın satır
	dy := int32(0)
	if c.sp.RecordingLine { // P28e AC-449: kayıt satırı; okunamazsa diyalog açılmaz (decisionFailed)
		c.rec, dy = label(helperio.RecordingLine, 112, 22, 1), 24
		if c.rec == 0 || win.GetText(c.rec) != helperio.RecordingLine {
			c.destroy()
			return false
		}
	}
	c.remain = label("", 112+dy, 22, 0)
	c.warn = label("", 136+dy, 40, 1)
	button := func(text string, id uintptr, x, w int32, extra uint32) uintptr {
		h := win.CreateWindow(0, "BUTTON", text, win.WS_CHILD|win.WS_VISIBLE|win.WS_TABSTOP|extra, s(x), s(184+dy), s(w), s(30), c.h, id)
		win.SendMessage(h, win.WM_SETFONT, c.fonts[0], 1)
		return h
	}
	c.deny = button(tx.Deny, win.IDOK, 216, 100, win.BS_DEFPUSHBUTTON) // Enter = Reddet
	c.grant = button(tx.Grant, idGrant, 324, 100, 0)
	win.EnableWindow(c.grant, false)
	r := win.RECT{Right: s(440), Bottom: s(226 + dy)}
	win.AdjustRect(&r, style, ex, int(dpi))
	c.w, c.hgt = r.Right-r.Left, r.Bottom-r.Top
	c.present()
	win.SetTimer(c.h, timerConsent, uint32(consentPoll/time.Millisecond))
	return true
}

// present birincil monitörde, imleç dışında, "Reddet" odaklı gösterir; 1,5 sn kilit (yeniden) başlar.
func (c *consentWin) present() {
	wa := win.WorkAreaAt(win.POINT{}) // (0,0) her zaman birincil monitördedir
	cur := win.CursorPos()
	x, y := control.PlaceAway(control.Point{X: cur.X, Y: cur.Y},
		control.Rect{Left: wa.Left, Top: wa.Top, Right: wa.Right, Bottom: wa.Bottom}, c.w, c.hgt, 24)
	win.SetWindowPos(c.h, win.HWND_TOPMOST, x, y, c.w, c.hgt, win.SWP_SHOWWINDOW)
	win.SetForegroundWindow(c.h)
	win.SetFocus(c.deny)
	now := time.Now()
	if c.guard == nil {
		c.guard, c.shownAt = control.NewGuard(now), now
	} else {
		c.guard.Show(now)
	}
	c.refresh(now)
}

// tick 250 ms: masaüstü, örtülme, en üstte (1 sn), kalan süre, düğme durumu.
func (c *consentWin) tick() {
	now := time.Now()
	if name, err := desktop.InputName(); err != nil || name != "Default" {
		if !c.hidden {
			c.hidden = true
			c.guard.Hide()
			win.ShowWindow(c.h, win.SW_HIDE)
		}
		return
	}
	if c.hidden {
		c.hidden = false
		c.present()
	}
	c.guard.Observe(now, c.obscured())
	if c.ticks++; c.ticks%4 == 0 {
		win.SetWindowPos(c.h, win.HWND_TOPMOST, 0, 0, 0, 0, win.SWP_NOMOVE|win.SWP_NOSIZE|win.SWP_NOACTIVATE)
	}
	c.refresh(now)
}

func (c *consentWin) refresh(now time.Time) {
	secs := max(0, int((c.sp.Deadline.Sub(now)+time.Second-1)/time.Second))
	win.SetText(c.remain, fmt.Sprintf(flow.UnattendedConsentTexts.Remaining, secs))
	switch {
	case c.guard.Obscured():
		win.SetText(c.warn, control.ObscuredWarning)
	case c.inj:
		win.SetText(c.warn, control.InjectedWarning)
	default:
		win.SetText(c.warn, "")
	}
	if on := c.guard.Enabled(now) && c.recDrawn(); on != c.grantOn {
		if !on {
			win.SetFocus(c.deny) // devre dışı kalacak düğmede odak kalmasın
		}
		win.EnableWindow(c.grant, on)
		c.grantOn = on
	}
}

// recDrawn P28e kayıt satırı (istenmişse) görünür ve metni doğru mu (AC-449; her tikte ve tıklamada).
func (c *consentWin) recDrawn() bool {
	if !c.sp.RecordingLine {
		return true
	}
	return recordingLineDrawn(c.sp, win.GetText(c.rec), win.Visible(c.rec))
}

// destroy pencereyi ve yazı tiplerini bırakır (build başarısız).
func (c *consentWin) destroy() {
	win.DestroyWindow(c.h)
	for _, f := range c.fonts {
		win.DeleteObject(f)
	}
	c.fonts = nil
}

// obscured GW_HWNDPREV zinciri: diyaloğu kesen görünür pencere (katmanlı/saydam dahil; kendi gösterge HWND'leri hariç).
func (c *consentWin) obscured() bool {
	dr, ok := win.WindowRect(c.h)
	if !ok {
		return true
	}
	dlg := control.Rect{Left: dr.Left, Top: dr.Top, Right: dr.Right, Bottom: dr.Bottom}
	var above []control.ZWindow
	for h := win.PrevWindow(c.h); h != 0 && len(above) < 4096; h = win.PrevWindow(h) {
		zr := dlg // dikdörtgeni okunamayan görünür pencere örtü sayılır (fail-closed)
		if r, ok := win.WindowRect(h); ok {
			zr = control.Rect{Left: r.Left, Top: r.Top, Right: r.Right, Bottom: r.Bottom}
		}
		above = append(above, control.ZWindow{H: h, Visible: win.Visible(h), Rect: zr})
	}
	return control.Obscured(dlg, above, ownWindow)
}
