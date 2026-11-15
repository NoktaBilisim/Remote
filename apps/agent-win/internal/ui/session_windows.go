//go:build windows

package ui

import (
	"fmt"
	"strings"
	"time"

	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/win"
)

// Active oturum penceresi + her monitörde gösterge (AC-103) + işaretleme katmanı (AC-37/56).
func (u *UI) Active(techName string, mon signal.Monitor) {
	u.t.Do(func() {
		u.closeLobby()
		watchText := "Ekranınız izleniyor — " + techName
		if u.windowShare {
			watchText = "Paylaştığınız pencere izleniyor — " + techName // AC-248
		}
		u.techName = techName
		s := u.newSessionWin(watchText)
		f := s.f
		f.command = func(id, _ int) { u.sessionCommand(s, id) }
		f.close = func() { u.confirmEnd(s) }
		f.activate = func(on bool) {
			s.active = on
			if on && s.unread > 0 {
				s.unread = 0
				win.SetText(f.h, appTitle+" — Oturum")
			}
		}
		f.show(primaryWork(), false, s.input)
		u.sess = s

		u.ind = newIndicator(u.t, watchText)
		// AC-248: pencere modunda işaretleme katmanı yok (koordinatlar pencereye göredir; monitör katmanı yanlış yere
		// çizerdi). Gösterge her monitörde kalır.
		if r, ok := capture.MonitorRect(mon.ID); ok && !u.windowShare {
			u.ov = newOverlay(u.t, r)
		}
	})
}

// newSessionWin oturum penceresinin denetimleri (gösterilmeden önce).
func (u *UI) newSessionWin(watchText string) *sessionWin {
	height, endY := int32(500), int32(456)
	if u.elevated {
		height, endY = 552, 508
	}
	f := u.t.newForm(appTitle+" — Oturum", 440, height, false)
	s := &sessionWin{f: f}
	s.watch = f.danger(watchText, 16, 14, 408, 22, fontBold)
	s.status = f.label("Bağlantı kuruluyor…", 16, 40, 408, 36, fontNormal)
	f.label("Sohbet", 16, 80, 408, 20, fontBold)
	s.history = f.edit(0, 16, 102, 408, 196, win.ES_MULTILINE|win.ES_READONLY|win.ES_AUTOVSCROLL|win.WS_VSCROLL, 0)
	s.input = f.edit(idChatInput, 16, 306, 316, 28, win.ES_AUTOHSCROLL, 2000)
	s.sendBtn = f.button("Gönder", idOK, 338, 305, 86, true)
	s.fileLbl = f.label("", 16, 344, 260, 20, fontNormal)
	s.fileBtn = f.button("Aktarımı iptal et", idFileCancel, 284, 340, 140, false)
	// AC-100: "Erişime izin ver", "Kontrolü kapat", "Oturumu bitir" her zaman görünür, klavyeyle erişilir.
	// S7-6: "Erişime izin ver" izin vermez; bekleyen kontrol diyaloğunu imleç dışında, 1,5 sn kilitle öne getirir.
	s.grantBtn = f.button("Erişime &izin ver", idGrant, 16, 380, 200, false)
	s.closeBtn = f.button("&Kontrolü kapat", idCtlClose, 224, 380, 200, false)
	s.hotkey = f.label(hotkeyText(u.hotkeyLabel), 16, 416, 408, 36, fontNormal)
	if u.elevated {
		f.danger(elevatedText, 16, 456, 408, 48, fontNormal)
	}
	s.endBtn = f.button("Oturumu bitir", idEndSession, 16, endY, 160, false)
	win.EnableWindow(s.grantBtn.h, false)
	win.EnableWindow(s.closeBtn.h, false)
	f.noKey = s.grantBtn.h // G-03: Enter/Space bu düğmeyi de tetiklemez
	win.ShowWindow(s.fileBtn.h, win.SW_HIDE)
	return s
}

// sessionCommand oturum penceresi düğmeleri: sohbet gönder, aktarımı iptal, izin diyaloğunu öne getir, kontrolü
// kapat, oturumu bitir.
func (u *UI) sessionCommand(s *sessionWin, id int) {
	switch id {
	case idOK:
		text := strings.TrimSpace(win.GetText(s.input.h))
		if text != "" && !s.finished {
			u.emit(flow.Event{Kind: flow.EvChat, Text: text})
			appendLine(s.history, "Siz", text)
			win.SetText(s.input.h, "")
		}
	case idFileCancel:
		u.emit(flow.Event{Kind: flow.EvFileCancel})
	case idGrant:
		if u.ctlDlg != nil {
			u.ctlDlg.present()
		}
	case idCtlClose:
		u.closeControlNow()
	case idEndSession:
		if !s.finished {
			u.emit(flow.Event{Kind: flow.EvEnd})
		}
	}
}

// confirmEnd pencere kapatma: oturum sürüyorsa onaydan sonra biter.
func (u *UI) confirmEnd(s *sessionWin) {
	if s.finished {
		return
	}
	if win.MessageBox(s.f.h, "Oturumu bitirmek istiyor musunuz? Teknisyen ekranınızı artık göremez.", appTitle,
		win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2) == win.IDYES {
		u.emit(flow.Event{Kind: flow.EvEnd})
	}
}

func appendLine(edit *ctrl, who, text string) {
	line := fmt.Sprintf("[%s] %s: %s\r\n", time.Now().Format("15:04"), who, crlf(text))
	n := win.SendMessage(edit.h, 0x000E /*WM_GETTEXTLENGTH*/, 0, 0)
	win.SendMessage(edit.h, win.EM_SETSEL, n, n)
	win.SendMessageStr(edit.h, win.EM_REPLACESEL, 0, line)
	win.SendMessage(edit.h, win.EM_SCROLLCARET, 0, 0)
}

// Status oturum durum satırı.
func (u *UI) Status(msg string) {
	u.t.Do(func() {
		if u.sess != nil && !u.sess.finished {
			win.SetText(u.sess.status.h, msg)
		}
	})
}

// Chat AC-52: zaman damgalı; pencere arka plandaysa okunmamış sayacı başlıkta.
func (u *UI) Chat(text string) {
	u.t.Do(func() {
		s := u.sess
		if s == nil {
			return
		}
		appendLine(s.history, "Teknisyen", text)
		if !s.active {
			s.unread++
			win.SetText(s.f.h, fmt.Sprintf("(%d yeni) %s — Oturum", s.unread, appTitle))
			win.FlashWindow(s.f.h)
		}
	})
}

// Annot işaretleme katmanına uygulanır.
func (u *UI) Annot(m dc.Ctl) {
	u.t.Do(func() {
		if u.ov != nil {
			u.ov.apply(m)
		}
	})
}
