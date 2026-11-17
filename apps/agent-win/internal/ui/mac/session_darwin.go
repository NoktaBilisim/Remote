//go:build darwin

package mac

import (
	"fmt"
	"strings"
	"time"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
	"remote-support/agent-win/internal/ui/uicore"
)

// Tek oturum penceresi (mimari-p28f §2.1 session/chat/transfer/roster/rec): gösterge metni, durum, sohbet (düz metin),
// dosya satırı, pano anahtarı, "Erişime izin ver" / "Kontrolü kapat", kısayol satırı, teknisyen listesi + "Çıkar",
// kayıt satırı, "Oturumu bitir". Pencere küçültülemez (§5.2b); kapatma onaylı bitirmedir.

const rosterRows = 3 // signal.MaxTechs

type rosterRow struct {
	lbl, btn  objc.ID
	tid, name string
}

type sessionWin struct {
	f                                     *form
	watch, status, history, input         objc.ID
	fileLbl, fileBtn, sendBtn, endBtn     objc.ID
	grantBtn, closeBtn, hotkey, clipChk   objc.ID
	recLbl, recBtn, recNote               objc.ID
	techs                                 [rosterRows]rosterRow
	hist                                  string
	clipOn, clipEnabled, finished, active bool
	unread                                int
}

// Active oturum penceresi + her ekranda gösterge (AC-103) + paylaşılan ekranda işaretleme (AC-37/56).
func (u *UI) Active(techName string, mon signal.Monitor) {
	u.do(func() {
		u.closeLobby()
		u.techName = techName
		u.sess = u.newSessionWin(uicore.WatchText(false, techName))
		u.ind = newIndicator(u, uicore.WatchText(false, techName), mon.ID)
		u.restoreQuit()
	})
}

func (u *UI) newSessionWin(watch string) *sessionWin {
	shift := 0.0
	if u.fileServer {
		shift = 40
	}
	const rosterH, recH = rosterRows * 32, 56
	h := 488 + shift + rosterH + recH + 46 // son satır: "Oturumu bitir"
	f := u.newForm(uicore.AppTitle+" — Oturum", 440, h)
	s := &sessionWin{f: f, active: true}
	s.watch = f.danger(watch, 16, 14, 408, 22, fontBold)
	s.status = f.label("Bağlantı kuruluyor…", 16, 40, 408, 36, fontNormal)
	f.label("Sohbet", 16, 80, 408, 20, fontBold)
	s.history = f.textView(16, 102, 408, 196, "")
	s.input = f.field(16, 306, 316, 26, func() { u.sendChat(s) }, nil)
	s.sendBtn = f.button("Gönder", 338, 304, 86, 30, func(objc.ID) { u.sendChat(s) })
	if u.fileServer {
		f.label(flow.TextFileServerMode, 16, 342, 408, 36, fontNormal)
	}
	s.fileLbl = f.label("", 16, 346+shift, 260, 20, fontNormal)
	s.fileBtn = f.button("Aktarımı iptal et", 284, 340+shift, 140, 30, func(objc.ID) {
		u.emit(flow.Event{Kind: flow.EvFileCancel})
	})
	show(s.fileBtn, false)
	s.clipChk = f.check(flow.ClipPrintTexts.ClipSwitch, 16, 380+shift, 408, 24, func(objc.ID) {})
	actions[s.clipChk] = func(sender objc.ID) { u.clipClicked(s, sender) }
	enable(s.clipChk, false)
	show(s.clipChk, false)
	// AC-100: üç düğme her zaman görünür. S7-6: "Erişime izin ver" izin vermez, bekleyen diyaloğu öne getirir
	// (korunan denetim: yalnız yerel tıklama).
	s.grantBtn = f.button("Erişime izin ver", 16, 410+shift, 200, 30, func(sender objc.ID) {
		if u.ctlDlg != nil && clickOf(sender) == clickLocal {
			u.ctlDlg.present()
		}
	})
	s.closeBtn = f.button("Kontrolü kapat", 224, 410+shift, 200, 30, func(objc.ID) { u.closeControlNow() })
	enable(s.grantBtn, false)
	enable(s.closeBtn, false)
	s.hotkey = f.label(uicore.HotkeyText(u.hotkeyLabel), 16, 446+shift, 408, 36, fontNormal)
	y := 488 + shift
	for i := range s.techs {
		ry := y + float64(i)*32
		idx := i
		s.techs[i].lbl = f.label("", 16, ry+6, 300, 22, fontNormal)
		s.techs[i].btn = f.button(flow.MultiTexts.Remove, 324, ry, 100, 30, func(sender objc.ID) {
			u.confirmRemove(s, idx, sender)
		})
		show(s.techs[i].lbl, false)
		show(s.techs[i].btn, false)
	}
	y += rosterH
	s.recLbl = f.danger(flow.RecTexts.Indicator, 16, y+4, 250, 22, fontBold)
	s.recBtn = f.button(flow.RecTexts.Stop, 284, y, 140, 30, func(objc.ID) {
		if !s.finished {
			u.emit(flow.Event{Kind: flow.EvRecStop})
		}
	})
	s.recNote = f.label("", 16, y+32, 408, 20, fontNormal)
	for _, c := range []objc.ID{s.recLbl, s.recBtn, s.recNote} {
		show(c, false)
	}
	s.endBtn = f.button("Oturumu bitir", 16, y+recH, 160, 30, func(objc.ID) {
		if !s.finished {
			u.emit(flow.Event{Kind: flow.EvEnd})
		}
	})
	f.onClose(u.confirmEnd)
	becameKey[f.win] = func() {
		if s.unread > 0 {
			s.unread = 0
			f.win.Send(selSetTitle, nsstr(uicore.UnreadTitle(0)))
		}
	}
	f.win.Send(objc.Sel("setAutorecalculatesKeyViewLoop:"), true)
	f.show(s.input, false, 0)
	return s
}

// confirmEnd pencere kapatma / Cmd+Q: onaydan sonra oturum biter (güvenli yön; kilit yok).
func (u *UI) confirmEnd() {
	s := u.sess
	if s == nil || s.finished {
		return
	}
	if u.endDlg != nil {
		u.endDlg.present()
		return
	}
	u.endDlg = u.newPrompt(promptSpec{title: "Oturumu bitir", body: "Oturumu bitirmek istiyor musunuz? Teknisyen " +
		"ekranınızı artık göremez.", grantText: "Oturumu bitir", denyText: "Vazgeç", open: true, slot: &u.endDlg,
		onGrant: func() { u.emit(flow.Event{Kind: flow.EvEnd}) }})
}

func (u *UI) sendChat(s *sessionWin) {
	text := uicore.TrimRunes(strings.TrimSpace(getText(s.input)), uicore.ChatInputLimit)
	if text == "" || s.finished {
		return
	}
	u.emit(flow.Event{Kind: flow.EvChat, Text: text})
	u.appendLine(s, "Siz", text)
	setText(s.input, "")
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

// Chat AC-52 (zaman damgalı; pencere arka plandaysa başlıkta okunmamış sayısı).
func (u *UI) Chat(text string) { u.chatLine("Teknisyen", text) }

// TechChat flow.RosterUI: multi kipinde teknisyen adıyla satır.
func (u *UI) TechChat(name, text string) { u.chatLine(name, text) }

func (u *UI) chatLine(who, text string) {
	u.do(func() {
		s := u.sess
		if s == nil {
			return
		}
		u.appendLine(s, who, text)
		if !sendBool(s.f.win, objc.Sel("isKeyWindow")) {
			s.unread++
			s.f.win.Send(selSetTitle, nsstr(uicore.UnreadTitle(s.unread)))
			u.app.Send(objc.Sel("requestUserAttention:"), 10) // NSInformationalRequest
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

// FileOfferWithdrawn teklif geri çekildi: diyalog karar verilmeden kapanır.
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

// FileServerMode P28b (AC-363): oturum penceresi bu bayrakla kurulur (hello pencereden önce gelir).
func (u *UI) FileServerMode(server bool) { u.do(func() { u.fileServer = server }) }

// FileServerStatus P28b dosya alanı durumu; final metin sohbete "Sistem" satırı olarak düşer.
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

// ControlRequest AC-99/116: kontrol izni diyaloğu (gösterge sağlıksızsa izin verilmez, §5.2b).
func (u *UI) ControlRequest(p flow.ControlPrompt) {
	u.do(func() {
		if u.ctlDlg != nil || u.sess == nil || u.sess.finished {
			return
		}
		var warns []string
		if p.Hotkey == "" {
			warns = append(warns, uicore.HotkeyText(""))
		}
		u.ctlDlg = u.newPrompt(promptSpec{title: "Uzaktan kontrol isteği", body: uicore.ControlBody(p.TechName, p.Hotkey),
			grantText: "İzin ver", warns: warns, hotkeyOK: p.Hotkey != "", slot: &u.ctlDlg,
			guard:   func() bool { return !u.health.Failed },
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

// ControlPromptClosed / MonitorPromptClosed: diyalog karar verilmeden kapanır.
func (u *UI) ControlPromptClosed() { u.do(func() { closePrompt(u.ctlDlg) }) }

// MonitorPromptClosed bkz. ControlPromptClosed.
func (u *UI) MonitorPromptClosed() { u.do(func() { closePrompt(u.monDlg) }) }

func (u *UI) closePrompts() {
	for _, d := range []*prompt{u.ctlDlg, u.monDlg, u.offer, u.printDlg, u.removeDlg, u.endDlg, u.accessDlg} {
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
			setText(s.hotkey, uicore.HotkeyText(hotkey))
			enable(s.closeBtn, granted)
			if granted {
				s.f.win.Send(objc.Sel("makeFirstResponder:"), s.closeBtn)
			}
		}
	})
}

// MonitorChanged işaretleme katmanı yeni ekrana taşınır.
func (u *UI) MonitorChanged(mon signal.Monitor) {
	u.do(func() {
		if u.ind != nil {
			u.ind.setShared(mon.ID)
		}
	})
}

// clipClicked D-P28a-1 + §5.2a: mantık yalnız yerel tıklamayla çevrilir; görünüm her zaman mantıktan yazılır.
func (u *UI) clipClicked(s *sessionWin, sender objc.ID) {
	if s.clipEnabled && !s.finished && clickOf(sender) == clickLocal {
		s.clipOn = !s.clipOn
		u.emit(flow.Event{Kind: flow.EvClipConsent, On: s.clipOn})
	}
	setChecked(s.clipChk, s.clipOn)
}

// ClipSwitch flow.ClipPrintUI.
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
			show(r.lbl, false)
			show(r.btn, false)
			continue
		}
		t := v.Techs[i]
		line := uicore.RosterLine(t)
		r.tid, r.name = t.TID, t.Name
		setText(r.lbl, line)
		show(r.lbl, true)
		show(r.btn, t.Removable)
		ok = ok && getText(r.lbl) == clampText(line, textLimit)
	}
	return ok
}

// confirmRemove "Çıkar" (korunan): yalnız yerel tıklamayla, onay da korunan diyalogla (varsayılan Vazgeç).
func (u *UI) confirmRemove(s *sessionWin, i int, sender objc.ID) {
	if i < 0 || i >= len(s.techs) || s.finished || u.removeDlg != nil || clickOf(sender) != clickLocal {
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

// RecState flow.RecUI: göstergedeki "Kayıt" etiketi ve oturum penceresindeki satır yalnız sunucunun rec.state'inden.
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
		show(s.recLbl, v.On)
		show(s.recBtn, v.On)
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

// showEnded son ekran (ana iş parçacığı): göstergeler ve diyaloglar kalkar; oturum penceresi varsa metinleri yazılır
// ve denetimleri kapatılır, yoksa küçük pencere. "İzinleri kaldırma" Sistem Ayarları'nın Ekran Kaydı bölmesini açar.
func (u *UI) showEnded(m flow.Message) {
	u.closePrompts()
	u.closeLobby()
	if u.ind != nil {
		u.ind.close()
		u.ind = nil
	}
	if m.Title == "" {
		return
	}
	perms := flow.MacTexts.RemovePerms
	if s := u.sess; s != nil {
		s.finished, s.clipOn = true, false
		setChecked(s.clipChk, false)
		setText(s.watch, m.Title)
		setText(s.status, m.Body)
		if u.endNote != "" {
			u.appendLine(s, "Sistem", u.endNote)
		}
		for _, c := range []objc.ID{s.input, s.sendBtn, s.endBtn, s.fileBtn, s.grantBtn, s.closeBtn, s.clipChk, s.recBtn} {
			enable(c, false)
		}
		for _, r := range s.techs {
			enable(r.btn, false)
		}
		for _, c := range []objc.ID{s.recLbl, s.recBtn, s.recNote} {
			show(c, false)
		}
		s.f.button(perms, 264, sendRect(s.endBtn, objc.Sel("frame")).Origin.Y, 160, 30,
			func(objc.ID) { openURL(SettingsScreen) })
		u.quit = nil
		return
	}
	f := u.newForm(uicore.AppTitle, 420, 140)
	f.label(m.Title, 16, 16, 388, 24, fontBold)
	f.label(m.Body, 16, 48, 388, 50, fontNormal)
	f.button(perms, 16, 100, 160, 30, func(objc.ID) { openURL(SettingsScreen) })
	f.onClose(func() {})
	u.quit = nil
	f.show(0, false, 0)
	u.ended = f
}

var (
	_ flow.ClipPrintUI  = (*UI)(nil)
	_ flow.FileServerUI = (*UI)(nil)
	_ flow.RosterUI     = (*UI)(nil)
	_ flow.RecUI        = (*UI)(nil)
)
