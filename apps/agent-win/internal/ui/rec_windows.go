//go:build windows

package ui

import (
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/win"
)

// recRow oturum penceresinde kayıt satırının yüksekliği (gösterge + "Kaydı durdur" + bilgi satırı).
const recRow = 56

// recStrip S-P28e-12: kayıt açıkken her monitörde üst-ortada (gösterge etiketi ve bildirim satırının altında) küçük,
// her zaman üstte şerit. Oturum penceresi küçültülse de görünür; tıklanınca "Kaydı durdur" (onaysız; yanlış tıklama
// yalnız kaydı durdurur — güvenli yön). Odak almaz, yakalamadan hariçtir (indicator kalıbı).
type recStrip struct {
	bars []*form
	text string
}

func newRecStrip(t *thread, text string, onClick func()) *recStrip {
	st := &recStrip{text: text}
	for _, m := range win.Monitors() {
		r := m.Rect
		const w, h = 420, 30
		b := newBarOpt(t, r.Left+(r.Right-r.Left-w)/2, r.Top+68, w, h, &st.text, false)
		b.click = onClick
		st.bars = append(st.bars, b)
	}
	if len(st.bars) > 0 {
		first := st.bars[0]
		first.timer = func(uintptr) { st.raise() }
		win.SetTimer(first.h, timerTopmost, 1000)
	}
	return st
}

func (st *recStrip) setText(text string) {
	st.text = text
	for _, b := range st.bars {
		win.Invalidate(b.h)
	}
}

func (st *recStrip) raise() {
	for _, b := range st.bars {
		win.SetWindowPos(b.h, win.HWND_TOPMOST, 0, 0, 0, 0, win.SWP_NOMOVE|win.SWP_NOSIZE|win.SWP_NOACTIVATE|win.SWP_SHOWWINDOW)
	}
}

func (st *recStrip) close() {
	for _, b := range st.bars {
		b.destroy()
	}
	st.bars = nil
}

func (u *UI) dropStrip() {
	if u.strip != nil {
		u.strip.close()
		u.strip = nil
	}
}

// RecState flow.RecUI: gösterge, şerit ve "Kaydı durdur" yalnız sunucunun rec.state'ine göre çizilir (§6.2).
func (u *UI) RecState(v flow.RecView) {
	u.t.Do(func() {
		s := u.sess
		if s != nil && s.finished {
			return // son ekran: teardownSession şeridi kaldırdı
		}
		if !v.On {
			u.dropStrip()
			if s != nil {
				win.ShowWindow(s.recLbl.h, win.SW_HIDE)
				win.ShowWindow(s.recBtn.h, win.SW_HIDE)
				setShown(s.recNote, v.Note)
			}
			return
		}
		strip, note := flow.RecTexts.Strip, flow.RecTexts.StopNote
		if v.Stopping {
			strip, note = flow.RecTexts.StripBusy, flow.RecTexts.Stopping
		}
		if u.strip == nil {
			u.strip = newRecStrip(u.t, strip, func() { u.emit(flow.Event{Kind: flow.EvRecStop}) })
		} else {
			u.strip.setText(strip)
		}
		if s != nil {
			win.ShowWindow(s.recLbl.h, win.SW_SHOWNOACTIVATE)
			win.ShowWindow(s.recBtn.h, win.SW_SHOWNOACTIVATE)
			win.EnableWindow(s.recBtn.h, !v.Stopping)
			setShown(s.recNote, note)
		}
	})
}

// setShown metni yazar; boşsa denetimi gizler.
func setShown(c *ctrl, text string) {
	win.SetText(c.h, text)
	show := win.SW_HIDE
	if text != "" {
		show = win.SW_SHOWNOACTIVATE
	}
	win.ShowWindow(c.h, show)
}

var _ flow.RecUI = (*UI)(nil)
