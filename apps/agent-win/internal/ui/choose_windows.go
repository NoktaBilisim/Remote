//go:build windows

package ui

import (
	"context"
	"fmt"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/win"
)

// windowsSelfPID kendi sürecimiz (pencere listesinden çıkarılır).
func windowsSelfPID() uint32 { return windows.GetCurrentProcessId() }

// Paylaşım seçim ekranı denetimleri (AC-106, AC-248).
const (
	idMonList    = 50
	idFullScreen = 51
	idOneWindow  = 52
	idWinList    = 53
	idWinRefresh = 54
	lbnSelChange = 1
	lbnDblClk    = 2
)

type shareResult struct {
	c  flow.ShareChoice
	ok bool
}

// shareDlg ekran seçimi penceresi. windows true ise "Tüm ekran / Yalnız bir pencere" (full/one) ve pencere listesi.
type shareDlg struct {
	u       *UI
	f       *form
	ch      chan<- shareResult
	mons    []signal.Monitor
	windows bool
	monLb   *ctrl
	full    *ctrl
	one     *ctrl
	winLb   *ctrl
	list    []shareWindow
}

// ChooseShare AC-106: varsayılan birincil monitör seçili. AC-248: windows true ise "Tüm ekran / Yalnız bir pencere"
// seçimi ve pencere listesi (shareableWindows süzgeci) gösterilir; varsayılan "Tüm ekran".
func (u *UI) ChooseShare(ctx context.Context, mons []signal.Monitor, def int, windows bool) (flow.ShareChoice, bool) {
	ch := make(chan shareResult, 1)
	u.t.Do(func() {
		u.closeLobby()
		s := &shareDlg{u: u, ch: ch, mons: mons, windows: windows}
		s.build(def)
	})
	r := await(ctx, ch, shareResult{})
	return r.c, r.ok
}

func (s *shareDlg) build(def int) {
	height, btnY := int32(252), int32(204)
	if s.windows {
		height, btnY = 492, 444
	}
	s.f = s.u.t.newForm(appTitle+" — Ekran seçimi", 460, height, true)
	s.addMonitors(def)
	if s.windows {
		s.addWindows(btnY)
	}
	s.f.button("Paylaş", idOK, 260, btnY, 90, true)
	s.f.button("Vazgeç", idCancel, 356, btnY, 88, false)
	s.f.command = s.command
	s.f.close = func() { s.done(shareResult{}) }
	focus := s.monLb
	if s.windows {
		focus = s.full
	}
	s.f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
}

// addMonitors başlık, (pencere seçimi varsa "Tüm ekran" düğmesi) ve monitör listesi; def kimlikli monitör seçili.
func (s *shareDlg) addMonitors(def int) {
	f, y := s.f, int32(16)
	if s.windows {
		f.label("Teknisyenle neyi paylaşmak istiyorsunuz?", 16, y, 428, 24, fontBold)
		s.full = f.add("BUTTON", "&Tüm ekran", win.WS_TABSTOP|win.WS_GROUP|win.BS_AUTORADIOBUTTON, 0, idFullScreen, 16, 46, 428, 24, fontNormal)
		y = 74
	} else {
		f.label("Teknisyenle paylaşılacak ekranı seçin", 16, y, 428, 24, fontBold)
		y = 48
	}
	monH := int32(140)
	if s.windows {
		monH = 72
	}
	s.monLb = f.add("LISTBOX", "", win.WS_TABSTOP|win.LBS_NOTIFY|win.WS_VSCROLL, win.WS_EX_CLIENTEDGE, idMonList, 32, y, 412, monH, fontNormal)
	if !s.windows {
		s.monLb.x, s.monLb.w = 16, 428
	}
	sel := 0
	for i, m := range s.mons {
		win.SendMessageStr(s.monLb.h, win.LB_ADDSTRING, 0, monitorLabel(m))
		if m.ID == def {
			sel = i
		}
	}
	win.SendMessage(s.monLb.h, win.LB_SETCURSEL, uintptr(sel), 0)
}

func monitorLabel(m signal.Monitor) string {
	label := fmt.Sprintf("%s — %d×%d", m.Name, m.W, m.H)
	if m.Primary {
		label += " (birincil)"
	}
	return label
}

// addWindows AC-248: "Yalnız bir pencere", pencere listesi, açıklama + S-P17-8 uyarısı, "Listeyi yenile"; varsayılan
// "Tüm ekran".
func (s *shareDlg) addWindows(btnY int32) {
	f := s.f
	s.one = f.add("BUTTON", "&Yalnız bir pencere", win.WS_TABSTOP|win.BS_AUTORADIOBUTTON, 0, idOneWindow, 16, 156, 428, 24, fontNormal)
	s.winLb = f.add("LISTBOX", "", win.WS_TABSTOP|win.LBS_NOTIFY|win.WS_VSCROLL, win.WS_EX_CLIENTEDGE, idWinList, 32, 184, 412, 140, fontNormal)
	f.label("Pencere modunda teknisyen yalnız bu pencereyi görür; uzaktan kontrol yalnız bu pencere öndeyken çalışır.",
		16, 330, 428, 40, fontNormal)
	f.label(windowShareWarning, 16, 374, 428, 40, fontBold) // S-P17-8
	f.button("&Listeyi yenile", idWinRefresh, 16, btnY, 140, false)
	s.fill()
	s.setMode(false)
}

func (s *shareDlg) fill() {
	s.list = shareableWindows(topWindows(), windowsSelfPID())
	win.SendMessage(s.winLb.h, win.LB_RESETCONTENT, 0, 0)
	for _, w := range s.list {
		win.SendMessageStr(s.winLb.h, win.LB_ADDSTRING, 0, w.Label)
	}
}

func (s *shareDlg) setMode(window bool) {
	win.SendMessage(s.full.h, win.BM_SETCHECK, win.B2U(!window), 0)
	win.SendMessage(s.one.h, win.BM_SETCHECK, win.B2U(window), 0)
	win.EnableWindow(s.monLb.h, !window)
	win.EnableWindow(s.winLb.h, window)
}

func (s *shareDlg) done(r shareResult) {
	s.u.windowShare = r.ok && r.c.Window != 0
	s.f.destroy()
	s.ch <- r
}

func (s *shareDlg) pickMonitor() {
	i := int(win.SendMessage(s.monLb.h, win.LB_GETCURSEL, 0, 0))
	if i >= 0 && i < len(s.mons) {
		s.done(shareResult{flow.ShareChoice{Monitor: s.mons[i].ID}, true})
	}
}

func (s *shareDlg) pickWindow() {
	i := int(win.SendMessage(s.winLb.h, win.LB_GETCURSEL, 0, 0))
	if i < 0 || i >= len(s.list) {
		return // seçim yok: ekran açık kalır
	}
	if !win.IsWindow(s.list[i].HWND) { // seçim ile Paylaş arasında kapandı
		s.fill()
		return
	}
	s.done(shareResult{flow.ShareChoice{Window: s.list[i].HWND}, true})
}

func (s *shareDlg) windowMode() bool {
	return s.windows && win.SendMessage(s.one.h, win.BM_GETCHECK, 0, 0) == 1
}

func (s *shareDlg) command(id, code int) {
	switch {
	case id == idFullScreen:
		s.setMode(false)
	case id == idOneWindow:
		s.setMode(true)
	case id == idWinRefresh:
		s.fill()
	case id == idMonList && code == lbnDblClk:
		s.pickMonitor()
	case id == idWinList && code == lbnDblClk:
		s.pickWindow()
	case id == idOK && s.windowMode():
		s.pickWindow()
	case id == idOK:
		s.pickMonitor()
	case id == idCancel:
		s.done(shareResult{})
	}
}

// topWindows EnumWindows sonucu süzgeç girdisine çevrilir.
func topWindows() []windowCandidate {
	ws := win.TopWindows()
	out := make([]windowCandidate, 0, len(ws))
	for _, w := range ws {
		out = append(out, windowCandidate{HWND: w.HWND, Title: w.Title, PID: w.PID, Visible: w.Visible, Tool: w.Tool,
			Cloaked: w.Cloaked, Iconic: w.Iconic, Class: w.Class})
	}
	return out
}
