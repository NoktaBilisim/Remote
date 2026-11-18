//go:build linux

package gtk

import (
	"fmt"
	"strings"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
	"remote-support/agent-win/internal/ui/uicore"
)

// Tek oturum penceresi (§2.1 session/chat/transfer): gösterge metni, durum, sohbet (düz metin), dosya satırı, pano
// anahtarı, "Erişime izin ver" / "Kontrolü kapat" / "Oturumu bitir" (her zaman görünür, Tab ile erişilir; AC-100),
// kısayol satırı (Wayland'de "Durdur" yolu + §5.2b uyarısı), teknisyen listesi + "Çıkar", ses satırı, kayıt satırı.
// S-P28g-8: üstte tutulur, tüm çalışma alanlarında; küçültülürse tikte geri getirilir, 3 tikte getirilemezse kapı
// kapanır; ✕ = "Oturumu bitir?" onayı (sessiz gizleme yok).

const rosterRows = 3 // signal.MaxTechs

type rosterRow struct {
	box, lbl, btn uintptr
	tid, name     string
}

type sessionWin struct {
	f                                   *form
	watch, status, history, input       uintptr
	fileLbl, fileBtn, sendBtn, endBtn   uintptr
	grantBtn, closeBtn, hotkey, clipChk uintptr
	recBox, recLbl, recBtn, recNote     uintptr
	voiceBox, voiceLbl, voiceMute, vEnd uintptr
	techs                               [rosterRows]rosterRow
	hist                                string
	clipOn, clipEnabled, finished       bool
	unread                              int
}

// Active oturum penceresi + gösterge (AC-103) + paylaşılan ekranda işaretleme (AC-37/56).
func (u *UI) Active(techName string, mon signal.Monitor) {
	u.do(func() {
		u.closeLobby()
		u.closePortal()
		u.techName = techName
		u.sess = u.newSessionWin(uicore.WatchText(false, techName))
		u.ind = newIndicator(u, uicore.WatchText(false, techName), mon)
	})
}

func (u *UI) newSessionWin(watch string) *sessionWin {
	f := u.newForm(uicore.AppTitle+" — Oturum", 460)
	s := &sessionWin{f: f}
	s.watch = f.danger(watch)
	setBold(s.watch)
	s.status = f.label("Bağlantı kuruluyor…")
	f.heading("Sohbet")
	s.history = f.textView(180, "")
	r := f.row()
	s.input = f.field(r, uicore.ChatInputLimit, func() { u.sendChat(s) }, nil)
	s.sendBtn = f.button(r, "Gönder", func() { u.sendChat(s) })
	if u.fileServer {
		f.label(flow.TextFileServerMode)
	}
	fr := f.row()
	s.fileLbl = newLabel("", clsLabel)
	gtkBoxPackStart(fr, s.fileLbl, true, true, 0)
	s.fileBtn = f.button(fr, "Aktarımı iptal et", func() { u.emit(flow.Event{Kind: flow.EvFileCancel}) })
	show(s.fileBtn, false)
	s.clipChk = f.protectedCheck(flow.ClipPrintTexts.ClipSwitch, func() bool { return s.clipOn }, func(k clickKind) {
		if s.clipEnabled && !s.finished && k == clickLocal {
			s.clipOn = !s.clipOn
			u.emit(flow.Event{Kind: flow.EvClipConsent, On: s.clipOn})
		}
	})
	enable(s.clipChk, false)
	show(s.clipChk, false)
	// AC-100: üç düğme her zaman görünür. "Erişime izin ver" izin vermez, bekleyen diyaloğu öne getirir (S7-6;
	// korunan denetim). "Kontrolü kapat" ve "Oturumu bitir" güvenli yön: klavye ve Orca ile de çalışır.
	cr := f.row()
	s.grantBtn = f.protected(cr, "Erişime izin ver", func(k clickKind) {
		if u.ctlDlg != nil && k == clickLocal {
			u.ctlDlg.present()
		}
	})
	s.closeBtn = f.button(cr, "Kontrolü kapat", u.closeControlNow)
	enable(s.grantBtn, false)
	enable(s.closeBtn, false)
	s.hotkey = f.label(hotkeyLine(u.hotkeyLabel, u.wayland, flow.LinuxTexts.WaylandHotkey))
	if u.wayland {
		f.danger(flow.LinuxTexts.WaylandWarning)
		f.label(flow.LinuxTexts.StopEnds)
	}
	for i := range s.techs {
		idx := i
		row := f.row()
		s.techs[i].box = row
		s.techs[i].lbl = newLabel("", clsLabel)
		gtkBoxPackStart(row, s.techs[i].lbl, true, true, 0)
		s.techs[i].btn = f.protected(row, flow.MultiTexts.Remove, func(k clickKind) { u.confirmRemove(s, idx, k) })
		show(row, false)
	}
	s.voiceBox = f.row()
	s.voiceLbl = newLabel("", clsDanger)
	gtkBoxPackStart(s.voiceBox, s.voiceLbl, true, true, 0)
	s.voiceMute = f.protected(s.voiceBox, flow.VoiceTexts.Mute, func(k clickKind) { u.voiceMuteClicked(s, k) })
	s.vEnd = f.button(s.voiceBox, flow.VoiceTexts.End, func() {
		if !s.finished && u.voiceOn {
			u.emit(flow.Event{Kind: flow.EvVoiceEnd})
		}
	})
	show(s.voiceBox, false)
	s.recBox = f.row()
	s.recLbl = newLabel(flow.RecTexts.Indicator, clsDanger)
	gtkBoxPackStart(s.recBox, s.recLbl, true, true, 0)
	s.recBtn = f.button(s.recBox, flow.RecTexts.Stop, func() {
		if !s.finished {
			u.emit(flow.Event{Kind: flow.EvRecStop})
		}
	})
	show(s.recBox, false)
	s.recNote = f.label("")
	show(s.recNote, false)
	er := f.row()
	s.endBtn = f.button(er, "Oturumu bitir", func() {
		if !s.finished {
			u.emit(flow.Event{Kind: flow.EvEnd})
		}
	})
	f.button(er, "Lisanslar", u.showLicenses)
	f.button(er, "Hakkında", u.showAbout)
	f.onX = u.confirmEnd
	onEvent(f.win, sigState, func(uintptr) bool { return false }) // durum tikte okunur (gdk_window_get_state)
	gtkWindowSetKeepAbove(f.win, true)
	gtkWindowStick(f.win)
	f.show(s.input)
	return s
}

// sessionTick S-P28g-8: küçültülmüş/eşlenmemiş oturum penceresi geri getirilir; 3 ardışık tikte getirilemezse kapı
// kapanır (fail-closed). Okunmamış sayacı pencere etkinse sıfırlanır.
func (u *UI) sessionTick(s *sessionWin) {
	visible := false
	if gw := gtkWidgetGetWindow(s.f.win); gw != 0 && gtkWidgetGetMapped(s.f.win) {
		visible = gdkWindowGetState(gw)&stateIconified == 0 && gdkWindowIsViewable(gw)
	}
	if !visible {
		gtkWindowDeiconify(s.f.win)
		gtkWidgetShowAll(s.f.win)
		gtkWindowPresent(s.f.win)
	}
	if u.sessHealth.Observe(visible) {
		u.failClosed()
	}
	if s.unread > 0 && gtkWindowIsActive(s.f.win) {
		s.unread = 0
		gtkWindowSetTitle(s.f.win, cstr(u.winTitle(uicore.UnreadTitle(0))))
		gtkWindowSetUrgencyHint(s.f.win, false)
	}
}

// failClosed gösterge ya da oturum penceresi görünür kılınamadı: kapı kapanır, kontrol diyaloğu kapanır, akışa
// VIEW{SYSTEM}.
func (u *UI) failClosed() {
	u.gate.Close()
	closePrompt(u.ctlDlg)
	u.emit(flow.Event{Kind: flow.EvControlSystem})
	if s := u.sess; s != nil && !s.finished {
		setText(s.status, flow.MacTexts.IndicatorFail) // platformdan bağımsız metin (P28f tablosu)
	}
}

// confirmEnd ✕: onaydan sonra oturum biter (güvenli yön; kilit yok).
func (u *UI) confirmEnd() {
	s := u.sess
	if s == nil || s.finished {
		return
	}
	if u.endDlg != nil {
		u.endDlg.present()
		return
	}
	u.endDlg = u.newPrompt(promptSpec{title: "Oturumu bitir", heading: flow.LinuxTexts.EndConfirm,
		body: "Teknisyen ekranınızı artık göremez.", grantText: "Oturumu bitir", denyText: "Vazgeç", open: true,
		slot: &u.endDlg, onGrant: func() { u.emit(flow.Event{Kind: flow.EvEnd}) }})
}

func (u *UI) sendChat(s *sessionWin) {
	text := uicore.TrimRunes(strings.TrimSpace(entryText(s.input)), uicore.ChatInputLimit)
	if text == "" || s.finished {
		return
	}
	u.emit(flow.Event{Kind: flow.EvChat, Text: text})
	u.appendLine(s, "Siz", text)
	setEntry(s.input, "")
}

func (u *UI) appendLine(s *sessionWin, who, text string) {
	s.hist = uicore.AppendChat(s.hist, time.Now(), who, text)
	setTextView(s.history, s.hist)
}

// Status oturum durum satırı.
func (u *UI) Status(msg string) {
	u.do(func() {
		if s := u.sess; s != nil && !s.finished {
			setText(s.status, msg)
		}
	})
}

// Chat AC-52.
func (u *UI) Chat(text string) { u.chatLine("Teknisyen", text) }

// TechChat flow.RosterUI.
func (u *UI) TechChat(name, text string) { u.chatLine(name, text) }

func (u *UI) chatLine(who, text string) {
	u.do(func() {
		s := u.sess
		if s == nil {
			return
		}
		u.appendLine(s, who, text)
		if !gtkWindowIsActive(s.f.win) {
			s.unread++
			gtkWindowSetTitle(s.f.win, cstr(u.winTitle(uicore.UnreadTitle(s.unread))))
			gtkWindowSetUrgencyHint(s.f.win, true)
		}
	})
}

// Annot işaretleme katmanına uygulanır.
func (u *UI) Annot(m dc.Ctl) {
	u.do(func() {
		if u.ind != nil {
			u.ind.annot(u, m)
		}
	})
}

// FileOffer AC-36 + G-03: ortak korunan diyalog.
func (u *UI) FileOffer(p transfer.Prompt) {
	u.do(func() {
		closePrompt(u.offer)
		var warns []string
		switch p.Warning {
		case files.WarnDoubleExtension:
			warns = append(warns, "Dikkat: Dosya adı çift uzantılı; gerçek türü gizleniyor olabilir. Beklemediğiniz bir dosyaysa reddedin.")
		case files.WarnDangerous:
			warns = append(warns, "Dikkat: Bu dosya türü bilgisayarınızda program çalıştırabilir. Yalnız beklediğiniz bir dosyaysa kabul edin.")
		}
		body := "Teknisyen size bir dosya göndermek istiyor:\n" + p.Name + "\nBoyut: " + uicore.HumanSize(p.Size) +
			"  ·  İndirilenler klasörüne kaydedilir"
		fid := p.FID
		decide := func(kind flow.EventKind) func() {
			return func() {
				u.offerFID = ""
				u.emit(flow.Event{Kind: kind, FID: fid})
			}
		}
		u.offer = u.newPrompt(promptSpec{title: "Dosya teklifi", body: body, grantText: "Kabul et", warns: warns,
			hotkeyOK: true, slot: &u.offer, onGrant: decide(flow.EvFileAccept), onDeny: decide(flow.EvFileReject)})
		u.offerFID = fid
	})
}

// FileOfferWithdrawn teklif geri çekildi.
func (u *UI) FileOfferWithdrawn(fid string) {
	u.do(func() {
		if u.offer != nil && u.offerFID == fid {
			closePrompt(u.offer)
			u.offerFID = ""
		}
	})
}

// FileProgress AC-53.
func (u *UI) FileProgress(done, total int64) {
	u.do(func() {
		if u.sess == nil || total <= 0 {
			return
		}
		setText(u.sess.fileLbl, fmt.Sprintf("Dosya alınıyor: %%%d", done*100/total))
		show(u.sess.fileBtn, true)
	})
}

// FileResult AC-54.
func (u *UI) FileResult(r transfer.Result) {
	u.do(func() {
		s := u.sess
		if s == nil {
			return
		}
		u.appendLine(s, "Sistem", uicore.FileResultText(r))
		setText(s.fileLbl, "")
		show(s.fileBtn, false)
	})
}

// FileServerMode P28b (AC-363).
func (u *UI) FileServerMode(server bool) { u.do(func() { u.fileServer = server }) }

// FileServerStatus P28b dosya alanı durumu.
func (u *UI) FileServerStatus(text string, final bool) {
	u.do(func() {
		s := u.sess
		if s == nil {
			return
		}
		if final {
			u.appendLine(s, "Sistem", text)
			text = ""
		}
		setText(s.fileLbl, text)
	})
}

// ControlRequest AC-99/116: kontrol izni diyaloğu (gösterge ya da oturum penceresi sağlıksızsa izin verilmez).
// Wayland'de §5.2b uyarı metni diyalogda da yazılır.
func (u *UI) ControlRequest(p flow.ControlPrompt) {
	u.do(func() {
		if u.ctlDlg != nil || u.sess == nil || u.sess.finished {
			return
		}
		var warns []string
		hotkeyOK := p.Hotkey != ""
		if u.wayland {
			warns = append(warns, flow.LinuxTexts.WaylandWarning)
		} else if !hotkeyOK {
			warns = append(warns, uicore.HotkeyText(""))
		}
		u.ctlDlg = u.newPrompt(promptSpec{title: "Uzaktan kontrol isteği", body: uicore.ControlBody(p.TechName, p.Hotkey),
			grantText: "İzin ver", warns: warns, hotkeyOK: hotkeyOK, slot: &u.ctlDlg,
			guard:   func() bool { return !u.health.Failed && !u.sessHealth.Failed },
			onGrant: func() { u.emit(flow.Event{Kind: flow.EvControlGrant}) },
			onDeny:  func() { u.emit(flow.Event{Kind: flow.EvControlDeny}) }})
		enable(u.sess.grantBtn, true)
	})
}

// MonitorRequest AC-43: monitör değiştirme izni (aynı kurallar).
func (u *UI) MonitorRequest(mon signal.Monitor) {
	u.do(func() {
		if u.monDlg != nil || u.sess == nil || u.sess.finished {
			return
		}
		body := fmt.Sprintf("Teknisyen paylaşılan ekranı \"%s\" (%d×%d) olarak değiştirmek istiyor. "+
			"İzin verirseniz o ekrandaki her şeyi görür.", mon.Name, mon.W, mon.H)
		id := mon.ID
		u.monDlg = u.newPrompt(promptSpec{title: "Ekran değiştirme isteği", body: body, grantText: "İzin ver",
			hotkeyOK: true, slot: &u.monDlg,
			onGrant: func() { u.emit(flow.Event{Kind: flow.EvMonitorAccept, Monitor: id}) },
			onDeny:  func() { u.emit(flow.Event{Kind: flow.EvMonitorDeny}) }})
	})
}

// ControlPromptClosed diyalog karar verilmeden kapanır.
func (u *UI) ControlPromptClosed() { u.do(func() { closePrompt(u.ctlDlg) }) }

// MonitorPromptClosed bkz. ControlPromptClosed.
func (u *UI) MonitorPromptClosed() { u.do(func() { closePrompt(u.monDlg) }) }

func (u *UI) closePrompts() {
	for _, d := range []*prompt{u.ctlDlg, u.monDlg, u.offer, u.printDlg, u.removeDlg, u.endDlg, u.voiceDlg} {
		closePrompt(d)
	}
}

// closeControlNow "Kontrolü kapat": kapı ana iş parçacığında hemen kapanır (AC-101), akış sonra bildirir.
func (u *UI) closeControlNow() {
	u.gate.Close()
	u.emit(flow.Event{Kind: flow.EvControlClose})
}

// ControlState AC-103: gösterge metni ve düğmeler.
func (u *UI) ControlState(granted bool, hotkey string) {
	u.do(func() {
		u.granted = granted
		text := uicore.WatchText(granted, u.techName)
		if u.ind != nil {
			u.ind.setText(text)
		}
		if s := u.sess; s != nil && !s.finished {
			setText(s.watch, text)
			setText(s.hotkey, hotkeyLine(hotkey, u.wayland, flow.LinuxTexts.WaylandHotkey))
			enable(s.closeBtn, granted)
			if granted {
				gtkWidgetGrabFocus(s.closeBtn)
			}
		}
	})
}

// MonitorChanged işaretleme katmanı yeni ekrana taşınır.
func (u *UI) MonitorChanged(mon signal.Monitor) {
	u.do(func() {
		if u.ind != nil {
			u.ind.setShared(mon)
		}
	})
}

// ClipSwitch flow.ClipPrintUI: görünüm yalnız mantıktan yazılır.
func (u *UI) ClipSwitch(st flow.ClipSwitchState) {
	u.do(func() {
		s := u.sess
		if s == nil || s.finished {
			return
		}
		s.clipOn, s.clipEnabled = st.On && st.Visible && st.Enabled, st.Visible && st.Enabled
		setChecked(s.clipChk, s.clipOn)
		enable(s.clipChk, s.clipEnabled)
		show(s.clipChk, st.Visible)
	})
}

// PrintPrompt AC-349: korunan diyalog, saniyede bir kalan süre; son tarihte kararsız kapanır.
func (u *UI) PrintPrompt(p flow.PrintPrompt) {
	u.do(func() {
		if u.printDlg != nil || u.sess == nil || u.sess.finished {
			return
		}
		tx, pid := flow.ClipPrintTexts, p.PID
		u.printPID = pid
		d := u.newPrompt(promptSpec{title: tx.PromptTitle, body: uicore.PrintBody(p, time.Until(p.Deadline), "\n"),
			grantText: tx.PromptPrint, denyText: tx.PromptReject, hotkeyOK: true, slot: &u.printDlg,
			onGrant: func() { u.emit(flow.Event{Kind: flow.EvPrintApprove, PID: pid}) },
			onDeny:  func() { u.emit(flow.Event{Kind: flow.EvPrintReject, PID: pid}) }})
		u.printDlg = d
		var tick func()
		tick = func() {
			time.AfterFunc(time.Second, func() {
				u.do(func() {
					if d.decided {
						return
					}
					left := time.Until(p.Deadline)
					if left <= 0 {
						closePrompt(d)
						return
					}
					setText(d.body, uicore.PrintBody(p, left, "\n"))
					tick()
				})
			})
		}
		tick()
	})
}

// PrintPromptClosed akış diyaloğu kararsız kapatır.
func (u *UI) PrintPromptClosed(pid string) {
	u.do(func() {
		if u.printPID == pid {
			closePrompt(u.printDlg)
		}
	})
}

// Notice 3 sn bildirim satırı (göstergenin altında).
func (u *UI) Notice(text string) {
	u.do(func() {
		if u.ind != nil {
			u.ind.notify(u, text)
		}
	})
}

var (
	_ flow.ClipPrintUI  = (*UI)(nil)
	_ flow.FileServerUI = (*UI)(nil)
)
