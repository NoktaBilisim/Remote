//go:build windows

package ui

import (
	"fmt"
	"time"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/win"
)

// P28c (mimari-p28c §10–§11, AC-366): oturum penceresinde bağlı teknisyen listesi (ad + rol) ve müşterinin "Çıkar"ı.
// Metinler flow.MultiTexts'ten. Liste yalnız multi1 roster'ı geldiğinde görünür; çizim doğrulanınca akış o tid'lerin
// eşini kurar (Y-PC-4).

const (
	rosterRows   = 3  // signal.MaxTechs
	rosterRowH   = 32 // düğme yüksekliği + boşluk
	rosterH      = rosterRows * rosterRowH
	idTechRemove = 50 // 50..52
	rosterWait   = 2 * time.Second
)

// rosterRow tek satır: etiket + "Çıkar".
type rosterRow struct {
	lbl, btn *ctrl
	tid      string
	name     string
}

// newRoster satırları (gizli) y'den başlayarak ekler.
func (s *sessionWin) newRoster(f *form, y int32) {
	for i := range s.techs {
		ry := y + int32(i)*rosterRowH
		s.techs[i] = rosterRow{
			lbl: f.label("", 16, ry+6, 300, 22, fontNormal),
			btn: f.button(flow.MultiTexts.Remove, idTechRemove+i, 324, ry, 100, false),
		}
		win.ShowWindow(s.techs[i].lbl.h, win.SW_HIDE)
		win.ShowWindow(s.techs[i].btn.h, win.SW_HIDE)
	}
}

// rosterLine satır metni: "Ad — Rol · Oturum sahibi (bağlantı koptu)".
func rosterLine(t flow.RosterTech) string {
	line := t.Name + " — " + t.Role
	if t.Owner {
		line += " · " + flow.MultiTexts.OwnerBadge
	}
	if !t.Connected {
		line += " (" + flow.MultiTexts.Disconnected + ")"
	}
	return line
}

// ShowRoster flow.RosterUI: listeyi çizer ve doğrular (≤ rosterWait; UI iş parçacığı yanıt vermezse false → yeni eş yok).
func (u *UI) ShowRoster(v flow.RosterView) bool {
	done := make(chan bool, 1)
	u.t.Do(func() { done <- u.drawRoster(v) })
	select {
	case ok := <-done:
		return ok
	case <-time.After(rosterWait):
		return false
	}
}

// drawRoster UI iş parçacığında: AC-103 göstergesi ve oturum penceresi adı kontrol sahibinden; satırlar yazılıp
// geri okunarak doğrulanır.
func (u *UI) drawRoster(v flow.RosterView) bool {
	s := u.sess
	if s == nil || s.finished || len(v.Techs) > rosterRows {
		return false
	}
	u.techName = v.Controller
	text := u.watchText(u.granted)
	if u.ind != nil {
		u.ind.setText(text)
	}
	win.SetText(s.watch.h, text)
	ok := true
	for i := range s.techs {
		r := &s.techs[i]
		if i >= len(v.Techs) {
			r.tid, r.name = "", ""
			win.ShowWindow(r.lbl.h, win.SW_HIDE)
			win.ShowWindow(r.btn.h, win.SW_HIDE)
			continue
		}
		t := v.Techs[i]
		line := rosterLine(t)
		r.tid, r.name = t.TID, t.Name
		win.SetText(r.lbl.h, line)
		win.ShowWindow(r.lbl.h, win.SW_SHOWNOACTIVATE)
		btn := win.SW_HIDE
		if t.Removable {
			btn = win.SW_SHOWNOACTIVATE
		}
		win.ShowWindow(r.btn.h, btn)
		ok = ok && win.GetText(r.lbl.h) == line
	}
	return ok
}

// watchText AC-103 metni (kontrol sahibinin adıyla; ControlState ile aynı kural).
func (u *UI) watchText(granted bool) string {
	if granted {
		return "Uzaktan kontrol aktif — " + u.techName
	}
	return "Ekranınız izleniyor — " + u.techName
}

// confirmRemove "Çıkar": yalnız gerçek yerel girdiyle (teknisyenin SendInput'u ile değil), onay diyaloğunda varsayılan
// Vazgeç (MB_DEFBUTTON2).
func (u *UI) confirmRemove(s *sessionWin, i int) {
	if i < 0 || i >= len(s.techs) || s.finished || !u.t.userInput(s.f) {
		return
	}
	r := s.techs[i]
	if r.tid == "" {
		return
	}
	if win.MessageBox(s.f.h, fmt.Sprintf(flow.MultiTexts.RemoveBody, r.name), flow.MultiTexts.RemoveTitle,
		win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2) == win.IDYES && s.techs[i].tid == r.tid {
		u.emit(flow.Event{Kind: flow.EvTechRemove, TID: r.tid})
	}
}

// TechChat flow.RosterUI: teknisyen adıyla sohbet satırı (multi kipinde).
func (u *UI) TechChat(name, text string) { u.chatLine(name, text) }
