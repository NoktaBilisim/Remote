//go:build linux

package gtk

import (
	"fmt"
	"time"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

// ShowRoster flow.RosterUI: listeyi çizer ve geri okuyarak doğrular (≤ 2 sn; yanıt yoksa false → yeni eş yok).
func (u *UI) ShowRoster(v flow.RosterView) bool {
	done := make(chan bool, 1)
	u.do(func() { done <- u.drawRoster(v) })
	select {
	case ok := <-done:
		return ok
	case <-time.After(2 * time.Second):
		return false
	}
}

func (u *UI) drawRoster(v flow.RosterView) bool {
	s := u.sess
	if s == nil || s.finished || len(v.Techs) > rosterRows {
		return false
	}
	u.techName = v.Controller
	text := uicore.WatchText(u.granted, u.techName)
	if u.ind != nil {
		u.ind.setText(text)
	}
	setText(s.watch, text)
	ok := true
	for i := range s.techs {
		r := &s.techs[i]
		if i >= len(v.Techs) {
			r.tid, r.name = "", ""
			show(r.box, false)
			continue
		}
		t := v.Techs[i]
		line := uicore.RosterLine(t)
		r.tid, r.name = t.TID, t.Name
		setText(r.lbl, line)
		show(r.box, true)
		show(r.lbl, true)
		show(r.btn, t.Removable)
		ok = ok && labelText(r.lbl) == clean(line)
	}
	return ok
}

// confirmRemove "Çıkar" (korunan): yalnız yerel tıklamayla, onay da korunan diyalogla (varsayılan Vazgeç).
func (u *UI) confirmRemove(s *sessionWin, i int, k clickKind) {
	if i < 0 || i >= len(s.techs) || s.finished || u.removeDlg != nil || k != clickLocal {
		return
	}
	r := s.techs[i]
	if r.tid == "" {
		return
	}
	u.removeDlg = u.newPrompt(promptSpec{title: flow.MultiTexts.RemoveTitle,
		body: fmt.Sprintf(flow.MultiTexts.RemoveBody, r.name), grantText: flow.MultiTexts.Remove, denyText: "Vazgeç",
		hotkeyOK: true, slot: &u.removeDlg, onGrant: func() {
			if s.techs[i].tid == r.tid {
				u.emit(flow.Event{Kind: flow.EvTechRemove, TID: r.tid})
			}
		}})
}

var _ flow.RosterUI = (*UI)(nil)
