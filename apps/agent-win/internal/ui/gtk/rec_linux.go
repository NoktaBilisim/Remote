//go:build linux

package gtk

import "remote-support/agent-win/internal/flow"

// RecState flow.RecUI: göstergedeki "Kayıt" satırı ve oturum penceresindeki satır yalnız sunucunun rec.state'inden.
func (u *UI) RecState(v flow.RecView) {
	u.do(func() {
		s := u.sess
		if s != nil && s.finished {
			return
		}
		u.recView = v
		if u.ind != nil {
			u.ind.setRec(v.On)
		}
		if s == nil {
			return
		}
		show(s.recBox, v.On)
		enable(s.recBtn, v.On && !v.Stopping)
		note := v.Note
		if v.On {
			note = flow.RecTexts.StopNote
			if v.Stopping {
				note = flow.RecTexts.Stopping
			}
		}
		setText(s.recNote, note)
		show(s.recNote, note != "")
	})
}

var _ flow.RecUI = (*UI)(nil)
