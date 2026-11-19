//go:build windows

package ui

import (
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/ui/uicore"
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
		f.command = func(id, code int) { u.sessionCommand(s, id, code) }
		f.close = func() { u.confirmEnd(s) }
		f.activate = func(on bool) {
			s.active = on
			if on && s.unread > 0 {
				s.unread = 0
				win.SetText(f.h, uicore.VersionedTitle(uicore.UnreadTitle(0), u.t.version))
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
	height, endY := int32(532), int32(488)
	if u.elevated {
		height, endY = 584, 540
	}
	// P28b AC-363: SERVER modunda dosya alanının üstünde iki satırlık bilgi; alttaki denetimler kayar.
	shift := int32(0)
	if u.fileServer {
		shift = 40
	}
	height, endY = height+shift, endY+shift
	// P28c: teknisyen listesi (en çok 3 satır), kayıt satırının üstünde.
	techY := endY
	height, endY = height+rosterH, endY+rosterH
	// P28d: teknisyen listesi ile kayıt satırı arasında ses satırı; görüşme yokken gizli.
	voiceY := endY
	height, endY = height+uicore.VoiceRowH, endY+uicore.VoiceRowH
	// P28e: "Oturumu bitir"in üstünde kayıt satırı (gösterge + Kaydı durdur + bilgi); kayıt yokken gizli.
	recY := endY
	height, endY = height+recRow, endY+recRow
	f := u.t.newForm(appTitle+" — Oturum", 440, height, false)
	// P28c: 768 px ekranda sığmazsa sohbet geçmişi kısalır, altındaki her şey yukarı kayar (uicore.ChatSqueeze).
	wa := primaryWork()
	_, winH := f.size()
	sq := uicore.ChatSqueeze(winH, wa.Bottom-wa.Top, int32(f.dpi))
	height, endY, techY, voiceY, recY, shift = height-sq, endY-sq, techY-sq, voiceY-sq, recY-sq, shift-sq
	f.ch = height
	s := &sessionWin{f: f}
	s.watch = f.danger(watchText, 16, 14, 408, 22, fontBold)
	s.status = f.label("Bağlantı kuruluyor…", 16, 40, 408, 36, fontNormal)
	s.newChat(f, sq) // P22-G (chat_windows.go)
	if u.fileServer {
		f.label(flow.TextFileServerMode, 16, 342-sq, 408, 36, fontNormal)
	}
	s.fileLbl = f.label("", 16, 344+shift, 260, 20, fontNormal)
	s.fileBtn = f.button("Aktarımı iptal et", idFileCancel, 284, 340+shift, 140, false)
	// AC-100: "Erişime izin ver", "Kontrolü kapat", "Oturumu bitir" her zaman görünür, klavyeyle erişilir.
	// S7-6: "Erişime izin ver" izin vermez; bekleyen kontrol diyaloğunu imleç dışında, 1,5 sn kilitle öne getirir.
	// P28a D-P28a-1: BS_CHECKBOX (otomatik değil); yetenek gelene kadar gizli, kapı açılana kadar devre dışı, kapalı başlar.
	s.clipChk = f.add("BUTTON", flow.ClipPrintTexts.ClipSwitch, win.WS_TABSTOP|win.BS_CHECKBOX, 0, idClipSwitch,
		16, 380+shift, 408, 24, fontNormal)
	s.grantBtn = f.button("Erişime &izin ver", idGrant, 16, 412+shift, 200, false)
	s.closeBtn = f.button("&Kontrolü kapat", idCtlClose, 224, 412+shift, 200, false)
	s.hotkey = f.label(hotkeyText(u.hotkeyLabel), 16, 448+shift, 408, 36, fontNormal)
	if u.elevated {
		f.danger(elevatedText, 16, 488+shift, 408, 48, fontNormal)
	}
	s.newRoster(f, techY)
	s.newVoiceRow(f, voiceY)
	s.recLbl = f.danger(flow.RecTexts.Indicator, 16, recY+4, 250, 22, fontBold)
	s.recBtn = f.button(flow.RecTexts.Stop, idRecStop, 284, recY, 140, false)
	s.recNote = f.label("", 16, recY+30, 408, 20, fontNormal)
	for _, c := range []*ctrl{s.recLbl, s.recBtn, s.recNote} {
		win.ShowWindow(c.h, win.SW_HIDE)
	}
	s.endBtn = f.button("Oturumu bitir", idEndSession, 16, endY, 160, false)
	win.EnableWindow(s.grantBtn.h, false)
	win.EnableWindow(s.closeBtn.h, false)
	win.EnableWindow(s.clipChk.h, false)
	win.ShowWindow(s.clipChk.h, win.SW_HIDE)
	f.noKey = s.grantBtn.h // G-03: Enter/Space bu düğmeyi de tetiklemez
	win.ShowWindow(s.fileBtn.h, win.SW_HIDE)
	return s
}

// sessionCommand oturum penceresi düğmeleri: sohbet gönder, aktarımı iptal, izin diyaloğunu öne getir, kontrolü
// kapat, pano anahtarı, oturumu bitir.
func (u *UI) sessionCommand(s *sessionWin, id, code int) {
	switch id {
	case idClipSwitch:
		if code == win.BN_CLICKED {
			u.clipClicked(s)
		}
	case idOK:
		u.sessionChatSubmit(s)
	case idFileCancel:
		u.emit(flow.Event{Kind: flow.EvFileCancel})
	case idGrant:
		if u.ctlDlg != nil {
			u.ctlDlg.present()
		}
	case idCtlClose:
		u.closeControlNow()
	case idRecStop:
		if !s.finished {
			u.emit(flow.Event{Kind: flow.EvRecStop})
		}
	case idEndSession:
		if !s.finished {
			u.emit(flow.Event{Kind: flow.EvEnd})
		}
	case idVoiceMute, idVoiceEnd:
		u.voiceCommand(s, id, code)
	case idTechRemove, idTechRemove + 1, idTechRemove + 2:
		if code == win.BN_CLICKED {
			u.confirmRemove(s, id-idTechRemove)
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

// Status oturum durum satırı.
func (u *UI) Status(msg string) {
	u.t.Do(func() {
		if u.sess != nil && !u.sess.finished {
			win.SetText(u.sess.status.h, msg)
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

// clipClicked D-P28a-1: mantık yalnız bu pencereye gelen gerçek yerel tıklama / Space ile çevrilir (thread.userInput,
// S7-5); teknisyenin SendInput'u, BM_CLICK ve UIA Invoke yalnız görünümü mantığa geri çeker. Akış ClipSwitch ile son
// sözü söyler (reddedilen açma isteğinde mantık geri gelir).
func (u *UI) clipClicked(s *sessionWin) {
	if s.clipEnabled && !s.finished && u.t.userInput(s.f) {
		s.clipOn = !s.clipOn
		u.emit(flow.Event{Kind: flow.EvClipConsent, On: s.clipOn})
	}
	setChecked(s.clipChk, s.clipOn)
}

// ClipSwitch flow.ClipPrintUI: görünür/etkin/işaretli durum; görünüm yalnız mantıktan yazılır (BM_SETCHECK).
func (u *UI) ClipSwitch(st flow.ClipSwitchState) {
	u.t.Do(func() {
		s := u.sess
		if s == nil || s.finished {
			return
		}
		s.clipOn, s.clipEnabled = st.On && st.Visible && st.Enabled, st.Visible && st.Enabled
		setChecked(s.clipChk, s.clipOn)
		win.EnableWindow(s.clipChk.h, s.clipEnabled)
		show := win.SW_HIDE
		if st.Visible {
			show = win.SW_SHOWNOACTIVATE
		}
		win.ShowWindow(s.clipChk.h, show)
	})
}
