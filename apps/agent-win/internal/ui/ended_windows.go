//go:build windows

package ui

import (
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/win"
)

// EndedNote AC-187: Ended'dan önce çağrılır; "Bu bilgisayar artık … için kayıtlı" son ekrana eklenir.
func (u *UI) EndedNote(note string) {
	u.t.Do(func() { u.endNote = note })
}

// Ended son ekran; göstergeler ve işaretleme katmanı hemen kalkar (AC-107: çağıran 3 sn içinde kapatır).
func (u *UI) Ended(m flow.Message) {
	u.t.Do(func() {
		u.teardownSession()
		if s := u.sess; s != nil {
			s.finished, s.clipOn = true, false
			setChecked(s.clipChk, false)
			win.SetText(s.watch.h, m.Title)
			win.SetText(s.status.h, m.Body)
			if u.endNote != "" {
				appendLine(s.history, "Sistem", u.endNote)
			}
			for _, c := range []*ctrl{s.input, s.sendBtn, s.endBtn, s.fileBtn, s.grantBtn, s.closeBtn, s.clipChk} {
				win.EnableWindow(c.h, false)
			}
			return
		}
		h := int32(120)
		if u.endNote != "" {
			h = 164
		}
		f := u.t.newForm(appTitle, 420, h, true)
		f.label(m.Title, 16, 16, 388, 24, fontBold)
		f.label(m.Body, 16, 48, 388, 56, fontNormal)
		if u.endNote != "" {
			f.label(u.endNote, 16, 108, 388, 40, fontBold)
		}
		f.close = func() {}
		f.show(win.WorkAreaAt(win.CursorPos()), true, nil)
		u.ended = f
	})
}

func (u *UI) teardownSession() {
	u.closePrompts()
	u.closeLobby()
	if u.ind != nil {
		u.ind.close()
		u.ind = nil
	}
	if u.ov != nil {
		u.ov.close()
		u.ov = nil
	}
}
