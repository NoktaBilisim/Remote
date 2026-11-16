//go:build windows

package helper

import (
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/win"
)

// Onay diyaloğunun girdi kaynağı süzgeci ve "İzin ver" kararı (consent_windows.go'dan ayrık; §7.3 ≤ 250 satır).

type inputMark struct {
	msg      uint32
	injected bool
	valid    bool
}

// track S7-5/S7-12 kalıbı (internal/ui thread.track eşi): diyaloğa gelen girdinin kaynağı; yalnız IMO_HARDWARE yerel.
func (c *consentWin) track(m *win.MSG) {
	c.cur = inputMark{}
	if m.Hwnd != c.h && win.Root(m.Hwnd) != c.h {
		return
	}
	origin, ok := win.InputOrigin()
	inj := control.OriginInjected(origin, ok)
	switch m.Message {
	case win.WM_LBUTTONDOWN, win.WM_LBUTTONDBLCLK:
		c.downInj = inj
	case win.WM_LBUTTONUP:
		c.cur = inputMark{msg: m.Message, injected: inj || c.downInj, valid: true}
	case win.WM_KEYDOWN, win.WM_SYSKEYDOWN:
		c.keyInj = inj
		c.cur = inputMark{msg: m.Message, injected: inj, valid: true}
	case win.WM_CHAR, win.WM_SYSCHAR:
		c.cur = inputMark{msg: m.Message, injected: control.CharInjected(c.keyInj, origin, ok), valid: true}
	}
}

// tryGrant tıklama: WindowFromPoint(imleç) = "İzin ver"; erişim tuşu (Alt+V): yalnız fiziksel tuş. Başka sürecin
// gönderdiği BM_CLICK/WM_COMMAND (girdi işaretsiz) enjekte sayılır.
func (c *consentWin) tryGrant() {
	trig, hit := control.TrigAccessKey, true
	if c.cur.msg == win.WM_LBUTTONUP {
		p := win.CursorPos()
		trig, hit = control.TrigClick, win.WindowAt(p.X, p.Y) == c.grant
	}
	now := time.Now()
	switch c.guard.Check(now, trig, !c.cur.valid || c.cur.injected, c.obscured(), hit) {
	case control.ReasonOK:
		c.decide(helperio.DecisionGranted)
	case control.ReasonInjected:
		c.inj = true
		c.guard.Show(now) // uyarı sonrası kilit yeniden (0.8.1 kalıbı)
		c.refresh(now)
	case control.ReasonObscured:
		c.guard.Observe(now, true)
		c.refresh(now)
	}
}

func (c *consentWin) decide(d string) {
	if c.decided {
		return
	}
	c.decided = true
	c.result <- d
	win.KillTimer(c.h, timerConsent)
	win.DestroyWindow(c.h)
	for _, f := range c.fonts {
		win.DeleteObject(f)
	}
	win.PostQuitMessage()
}

func consentProc(h uintptr, msg uint32, wp, lp uintptr) uintptr {
	c := consentCur
	if c == nil || h != c.h || c.decided {
		return win.DefWindowProc(h, msg, wp, lp)
	}
	switch msg {
	case win.WM_COMMAND:
		switch wp & 0xFFFF {
		case win.IDOK, win.IDCANCEL:
			c.decide(helperio.DecisionDenied)
		case idGrant:
			c.tryGrant()
		}
		return 0
	case win.WM_CLOSE:
		c.decide(helperio.DecisionDenied)
		return 0
	case win.WM_TIMER:
		c.tick()
		return 0
	case wmStop:
		c.decide(helperio.DecisionTimeout)
		return 0
	}
	return win.DefWindowProc(h, msg, wp, lp)
}
