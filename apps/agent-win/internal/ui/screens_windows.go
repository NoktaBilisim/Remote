//go:build windows

package ui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
	"remote-support/agent-win/internal/win"
)

// windowsSelfPID kendi sürecimiz (pencere listesinden çıkarılır).
func windowsSelfPID() uint32 { return windows.GetCurrentProcessId() }

const appTitle = "Nokta Destek"

// Denetim kimlikleri. IDOK (1) Enter'ın, IDCANCEL (2) Esc'in tetiklediği komuttur.
const (
	idOK         = win.IDOK
	idCancel     = win.IDCANCEL
	idAbuse      = 20
	idConsent    = 21
	idName       = 22
	idChatInput  = 30
	idFileCancel = 31
	idEndSession = 32
	idGrant      = 41
	idCtlClose   = 42
	timerTopmost = 2
)

// UI flow.UI'nin Win32 uygulaması.
type UI struct {
	t      *thread
	events chan flow.Event
	footer string

	lobby *form
	sess  *sessionWin
	// endNote AC-187: oturum sonu ekranında gösterilecek kayıt değişikliği bilgisi (EndedNote).
	endNote  string
	offer    *consentDlg // dosya teklifi (ortak izin diyaloğu, S7-5)
	offerFID string
	ind      *indicator
	ov       *overlay
	ended    *form

	// P7
	gate     *control.Gate
	techName string
	ctlDlg   *consentDlg
	monDlg   *consentDlg
	granted  bool
	// hotkeyLabel kaydedilen kapatma kısayolu; boşsa kontrol izni verilemez (G-21).
	hotkeyLabel string
	// elevated istemci yönetici olarak çalışıyor (S7-9): oturum penceresinde ve kontrol diyaloğunda uyarı.
	elevated bool
	// windowShare AC-248: müşteri "Yalnız bir pencere" seçti (gösterge metni, işaretleme katmanı yok).
	windowShare bool

	// P8b-2 talep modu (request_windows.go)
	reqEvents chan request.UserAction
	reqForm   *reqForm
	reqWait   *reqWait
	reqAccept *consentDlg
	// reqAcceptKey açık onay diyaloğunun teknisyen adı + doğrulama kodu (S8b2-3, S8b2-4).
	reqAcceptKey acceptKey
	// P20 K6 talep sohbeti (chat_windows.go): "Gönder" metinleri ve tepsideyken gövdesiz balon.
	reqChat        chan string
	reqChatBalloon func(text string)
}

type sessionWin struct {
	f        *form
	watch    *ctrl
	status   *ctrl
	history  *ctrl
	input    *ctrl
	fileLbl  *ctrl
	fileBtn  *ctrl
	endBtn   *ctrl
	sendBtn  *ctrl
	grantBtn *ctrl
	closeBtn *ctrl
	hotkey   *ctrl
	unread   int
	active   bool
	finished bool
}

// New UI iş parçacığını başlatır. footer "Hakkında" satırıdır (alan adı + sürüm + parmak izi, AC-128). gate izin
// kapısıdır: "Kontrolü kapat" onu UI iş parçacığında, akışı beklemeden kapatır (AC-101).
func New(host, version, fingerprint string, gate *control.Gate) (*UI, error) {
	t, err := startThread()
	if err != nil {
		return nil, err
	}
	return &UI{t: t, events: make(chan flow.Event, 16), gate: gate, reqEvents: make(chan request.UserAction, 8),
		reqChat: make(chan string, 4),
		footer:  fmt.Sprintf("Sunucu: %s  ·  Sürüm %s  ·  Parmak izi %s", host, version, fingerprint)}, nil
}

// Events kullanıcı olayları (flow.Deps.Events).
func (u *UI) Events() <-chan flow.Event { return u.events }

func (u *UI) emit(e flow.Event) {
	select {
	case u.events <- e:
	default:
	}
}

// Close tüm pencereleri kapatır.
func (u *UI) Close() { u.t.Quit() }

// ShowError başlangıç hatası (UI iş parçacığı gerekmez).
func ShowError(msg string) {
	win.MessageBox(0, msg, appTitle, win.MB_OK|win.MB_ICONERROR|win.MB_TOPMOST)
}

func primaryWork() win.RECT {
	for _, m := range win.Monitors() {
		if m.Primary {
			return m.Work
		}
	}
	return win.WorkAreaAt(win.CursorPos())
}

// AskCode AC-97: dosya adından kod okunamazsa elle giriş.
func (u *UI) AskCode(ctx context.Context, notice string) (string, bool) {
	type res struct {
		code string
		ok   bool
	}
	ch := make(chan res, 1)
	u.t.Do(func() {
		f := u.t.newForm(appTitle, 460, 232, false)
		f.label("Uzaktan destek", 16, 16, 428, 24, fontBold)
		f.label("Teknisyeninizin verdiği 8 haneli destek kodunu girin.", 16, 46, 428, 20, fontNormal)
		e := f.edit(0, 16, 72, 200, 28, win.ES_AUTOHSCROLL, 16)
		f.danger(notice, 16, 108, 428, 40, fontNormal)
		f.button("Devam", idOK, 260, 154, 90, true)
		f.button("Kapat", idCancel, 356, 154, 88, false)
		f.label(u.footer, 16, 200, 428, 20, fontNormal)
		done := func(r res) { f.destroy(); ch <- r }
		f.command = func(id, _ int) {
			switch id {
			case idOK:
				done(res{win.GetText(e.h), true})
			case idCancel:
				done(res{})
			}
		}
		f.close = func() { done(res{}) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, e)
	})
	select {
	case r := <-ch:
		return r.code, r.ok
	case <-ctx.Done():
		return "", false
	}
}

// Welcome AC-98/125/128: teknisyen, doğrulama kodu, sunucu, dolandırıcılık uyarısı, KVKK onayı.
func (u *UI) Welcome(ctx context.Context, w flow.Welcome) (string, bool) {
	type res struct {
		name string
		ok   bool
	}
	ch := make(chan res, 1)
	u.t.Do(func() {
		f := u.t.newForm(appTitle+" — Karşılama", 520, 652, false)
		f.label("Uzaktan destek bağlantısı", 16, 14, 488, 30, fontBig)
		f.label(w.Tenant+" teknisyeni sizinle uzaktan destek oturumu başlatmak istiyor.", 16, 50, 488, 20, fontNormal)
		f.label("Teknisyen: "+w.TechName, 16, 74, 352, 20, fontBold)
		f.label("Teknisyen doğrulama kodu: "+w.TechVerifyCode, 16, 98, 352, 20, fontBold)
		f.label("Telefondaki teknisyen de bu kodu söylemeli.", 16, 120, 352, 20, fontNormal)
		// AC-98: firma logosu (flow yalnız gömülü sunucu kökeninden indirir); yoksa sistem logosu (Nokta).
		logo := w.Logo
		if logo == nil {
			logo = systemLogo()
		}
		f.picture(logo, 376, 72, 128, 68)
		f.label("Bağlanılan sunucu: "+w.Host, 16, 144, 488, 20, fontNormal)
		f.danger("Sizi biz aramadıysak devam etmeyin", 16, 172, 488, 20, fontBold)
		f.danger("Sizi kendiliğinden arayan biri bunu istediyse kapatın; banka veya şifre işlemi yapmayın. "+
			"Teknisyenimiz şifrenizi hiçbir zaman sormaz.", 16, 194, 488, 38, fontNormal)
		if w.AbuseEmail != "" {
			f.button("Kötüye kullanımı bildir", idAbuse, 16, 236, 200, false)
		}
		f.danger(w.Notice, 224, 236, 280, 30, fontNormal)
		f.label(fmt.Sprintf("Aydınlatma metni (sürüm %d)", w.ConsentVersion), 16, 272, 488, 20, fontBold)
		consent := f.edit(0, 16, 294, 488, 120, win.ES_MULTILINE|win.ES_READONLY|win.ES_AUTOVSCROLL|win.WS_VSCROLL, 0)
		win.SetText(consent.h, crlf(w.ConsentBody))
		f.label(w.RememberNote, 16, 420, 488, 36, fontNormal) // AC-188 (kayıt kapalıysa boş)
		f.label("Adınız ve soyadınız (teknisyeniniz sizi bu adla görür)", 16, 462, 488, 20, fontNormal)
		name := f.edit(idName, 16, 484, 300, 28, win.ES_AUTOHSCROLL, 100)
		chk := f.add("BUTTON", "Aydınlatma metnini okudum; ekran görüntümün bu oturum boyunca teknisyenle "+
			"paylaşılmasını kabul ediyorum. Uzaktan kontrol için ayrıca onay istenir.",
			win.WS_TABSTOP|win.BS_AUTOCHECKBOX|win.BS_MULTILINE, 0, idConsent, 16, 520, 488, 52, fontNormal)
		connect := f.button("Bağlan", idOK, 318, 584, 90, true)
		f.button("Vazgeç", idCancel, 414, 584, 90, false)
		f.label(u.footer, 16, 626, 488, 20, fontNormal)
		win.EnableWindow(connect.h, false)
		valid := func() bool {
			return win.SendMessage(chk.h, win.BM_GETCHECK, 0, 0) == 1 && strings.TrimSpace(win.GetText(name.h)) != ""
		}
		done := func(r res) { f.destroy(); ch <- r }
		f.command = func(id, code int) {
			switch {
			case id == idConsent || (id == idName && code == win.EN_CHANGE):
				win.EnableWindow(connect.h, valid())
			case id == idAbuse:
				win.OpenMailto(w.AbuseEmail)
			case id == idOK && valid(): // AC-98: onaysız bağlantı başlamaz
				done(res{strings.TrimSpace(win.GetText(name.h)), true})
			case id == idCancel:
				done(res{})
			}
		}
		f.close = func() { done(res{}) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, name)
	})
	select {
	case r := <-ch:
		return r.name, r.ok
	case <-ctx.Done():
		return "", false
	}
}

func crlf(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\n", "\r\n")
}

// Lobby AC-112: kabul kodu, teknisyene telefonda okunur.
func (u *UI) Lobby(admitCode, techName string) {
	u.t.Do(func() {
		f := u.t.newForm(appTitle+" — Bekleme odası", 420, 290, false)
		f.label("Teknisyen onayı bekleniyor", 16, 16, 388, 24, fontBold)
		f.label("Kabul kodunuz", 16, 48, 388, 20, fontNormal)
		f.add("STATIC", admitCode, win.SS_CENTER|win.SS_NOPREFIX, 0, 0, 16, 70, 388, 44, fontBig)
		f.label("Bu kodu telefonda teknisyeninize okuyun. Teknisyen kodu girdiğinde bağlantı başlar.", 16, 122, 388, 40, fontNormal)
		f.danger("Kodu yalnız sizi aradığını bildiğiniz teknisyene söyleyin.", 16, 166, 388, 36, fontNormal)
		f.label("Teknisyen: "+techName, 16, 206, 388, 20, fontNormal)
		f.button("Vazgeç ve çık", idCancel, 16, 242, 150, false)
		f.command = func(id, _ int) {
			if id == idCancel {
				u.emit(flow.Event{Kind: flow.EvEnd})
			}
		}
		f.close = func() { u.emit(flow.Event{Kind: flow.EvEnd}) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, nil)
		u.lobby = f
	})
}

// Connecting P8b-2 (mimari-e9 §13.2): talepten doğan oturumda lobi yok; teknisyenin bağlanması beklenir.
func (u *UI) Connecting(techName string) {
	u.t.Do(func() {
		f := u.t.newForm(appTitle+" — Bağlanıyor", 420, 170, false)
		f.label("Teknisyen bağlanıyor…", 16, 16, 388, 24, fontBold)
		f.label("Teknisyen: "+techName, 16, 48, 388, 20, fontNormal)
		f.label("Ekranınız teknisyen bağlandığında paylaşılmaya başlar.", 16, 74, 388, 40, fontNormal)
		f.button("Vazgeç ve çık", idCancel, 16, 122, 150, false)
		f.command = func(id, _ int) {
			if id == idCancel {
				u.emit(flow.Event{Kind: flow.EvEnd})
			}
		}
		f.close = func() { u.emit(flow.Event{Kind: flow.EvEnd}) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, nil)
		u.lobby = f
	})
}

// Paylaşım seçim ekranı denetimleri (AC-106, AC-248).
const (
	idMonList    = 50
	idFullScreen = 51
	idOneWindow  = 52
	idWinList    = 53
	idWinRefresh = 54
	lbnDblClk    = 2
)

// ChooseShare AC-106: varsayılan birincil monitör seçili. AC-248: windows true ise "Tüm ekran / Yalnız bir pencere"
// seçimi ve pencere listesi (shareableWindows süzgeci) gösterilir; varsayılan "Tüm ekran".
func (u *UI) ChooseShare(ctx context.Context, mons []signal.Monitor, def int, windows bool) (flow.ShareChoice, bool) {
	type res struct {
		c  flow.ShareChoice
		ok bool
	}
	ch := make(chan res, 1)
	u.t.Do(func() {
		if u.lobby != nil {
			u.lobby.destroy()
			u.lobby = nil
		}
		height, btnY := int32(252), int32(204)
		if windows {
			height, btnY = 492, 444
		}
		f := u.t.newForm(appTitle+" — Ekran seçimi", 460, height, true)
		y := int32(16)
		var full, one, winLb *ctrl
		if windows {
			f.label("Teknisyenle neyi paylaşmak istiyorsunuz?", 16, y, 428, 24, fontBold)
			full = f.add("BUTTON", "&Tüm ekran", win.WS_TABSTOP|win.WS_GROUP|win.BS_AUTORADIOBUTTON, 0, idFullScreen, 16, 46, 428, 24, fontNormal)
			y = 74
		} else {
			f.label("Teknisyenle paylaşılacak ekranı seçin", 16, y, 428, 24, fontBold)
			y = 48
		}
		monH := int32(140)
		if windows {
			monH = 72
		}
		monLb := f.add("LISTBOX", "", win.WS_TABSTOP|win.LBS_NOTIFY|win.WS_VSCROLL, win.WS_EX_CLIENTEDGE, idMonList, 32, y, 412, monH, fontNormal)
		if !windows {
			monLb.x, monLb.w = 16, 428
		}
		sel := 0
		for i, m := range mons {
			label := fmt.Sprintf("%s — %d×%d", m.Name, m.W, m.H)
			if m.Primary {
				label += " (birincil)"
			}
			win.SendMessageStr(monLb.h, win.LB_ADDSTRING, 0, label)
			if m.ID == def {
				sel = i
			}
		}
		win.SendMessage(monLb.h, win.LB_SETCURSEL, uintptr(sel), 0)
		var list []shareWindow
		fill := func() {
			list = shareableWindows(topWindows(), windowsSelfPID())
			win.SendMessage(winLb.h, win.LB_RESETCONTENT, 0, 0)
			for _, w := range list {
				win.SendMessageStr(winLb.h, win.LB_ADDSTRING, 0, w.Label)
			}
		}
		setMode := func(window bool) {
			win.SendMessage(full.h, win.BM_SETCHECK, win.B2U(!window), 0)
			win.SendMessage(one.h, win.BM_SETCHECK, win.B2U(window), 0)
			win.EnableWindow(monLb.h, !window)
			win.EnableWindow(winLb.h, window)
		}
		if windows {
			one = f.add("BUTTON", "&Yalnız bir pencere", win.WS_TABSTOP|win.BS_AUTORADIOBUTTON, 0, idOneWindow, 16, 156, 428, 24, fontNormal)
			winLb = f.add("LISTBOX", "", win.WS_TABSTOP|win.LBS_NOTIFY|win.WS_VSCROLL, win.WS_EX_CLIENTEDGE, idWinList, 32, 184, 412, 140, fontNormal)
			f.label("Pencere modunda teknisyen yalnız bu pencereyi görür; uzaktan kontrol yalnız bu pencere öndeyken çalışır.",
				16, 330, 428, 40, fontNormal)
			f.label(windowShareWarning, 16, 374, 428, 40, fontBold) // S-P17-8
			f.button("&Listeyi yenile", idWinRefresh, 16, btnY, 140, false)
			fill()
			setMode(false)
		}
		f.button("Paylaş", idOK, 260, btnY, 90, true)
		f.button("Vazgeç", idCancel, 356, btnY, 88, false)
		done := func(r res) {
			u.windowShare = r.ok && r.c.Window != 0
			f.destroy()
			ch <- r
		}
		pickMonitor := func() {
			i := int(win.SendMessage(monLb.h, win.LB_GETCURSEL, 0, 0))
			if i >= 0 && i < len(mons) {
				done(res{flow.ShareChoice{Monitor: mons[i].ID}, true})
			}
		}
		pickWindow := func() {
			i := int(win.SendMessage(winLb.h, win.LB_GETCURSEL, 0, 0))
			if i < 0 || i >= len(list) {
				return // seçim yok: ekran açık kalır
			}
			if !win.IsWindow(list[i].HWND) { // seçim ile Paylaş arasında kapandı
				fill()
				return
			}
			done(res{flow.ShareChoice{Window: list[i].HWND}, true})
		}
		windowMode := func() bool { return windows && win.SendMessage(one.h, win.BM_GETCHECK, 0, 0) == 1 }
		f.command = func(id, code int) {
			switch {
			case id == idFullScreen:
				setMode(false)
			case id == idOneWindow:
				setMode(true)
			case id == idWinRefresh:
				fill()
			case id == idMonList && code == lbnDblClk:
				pickMonitor()
			case id == idWinList && code == lbnDblClk:
				pickWindow()
			case id == idOK && windowMode():
				pickWindow()
			case id == idOK:
				pickMonitor()
			case id == idCancel:
				done(res{})
			}
		}
		f.close = func() { done(res{}) }
		focus := monLb
		if windows {
			focus = full
		}
		f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
	})
	select {
	case r := <-ch:
		return r.c, r.ok
	case <-ctx.Done():
		return flow.ShareChoice{}, false
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

// Active oturum penceresi + her monitörde gösterge (AC-103) + işaretleme katmanı (AC-37/56).
func (u *UI) Active(techName string, mon signal.Monitor) {
	u.t.Do(func() {
		if u.lobby != nil {
			u.lobby.destroy()
			u.lobby = nil
		}
		watchText := "Ekranınız izleniyor — " + techName
		if u.windowShare {
			watchText = "Paylaştığınız pencere izleniyor — " + techName // AC-248
		}
		u.techName = techName
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
		f.command = func(id, _ int) {
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
		f.close = func() {
			if s.finished {
				return
			}
			if win.MessageBox(f.h, "Oturumu bitirmek istiyor musunuz? Teknisyen ekranınızı artık göremez.", appTitle,
				win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2) == win.IDYES {
				u.emit(flow.Event{Kind: flow.EvEnd})
			}
		}
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

func humanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return strings.Replace(fmt.Sprintf("%.1f MB", float64(n)/(1<<20)), ".", ",", 1)
	case n >= 1<<10:
		return strings.Replace(fmt.Sprintf("%.1f KB", float64(n)/(1<<10)), ".", ",", 1)
	}
	return fmt.Sprintf("%d bayt", n)
}

// FileOffer AC-36 + G-03 (ortak izin diyaloğu, S7-5): "Reddet" varsayılan ve odakta; "Kabul et" 1,5 sn kilitli,
// Enter/Space ile ve enjekte tıklamayla tetiklenmez (teknisyen kendi gönderdiği dosyayı kabul edemez); diyalog
// imlecin altında açılmaz.
func (u *UI) FileOffer(p transfer.Prompt) {
	u.t.Do(func() {
		closeDlg(u.offer) // transfer.Manager aynı anda tek bekleyen teklif tutar
		var warns []string
		switch p.Warning {
		case files.WarnDoubleExtension:
			warns = append(warns, "Dikkat: Dosya adı çift uzantılı; gerçek türü gizleniyor olabilir. Beklemediğiniz bir dosyaysa reddedin.")
		case files.WarnDangerous:
			warns = append(warns, "Dikkat: Bu dosya türü bilgisayarınızda program çalıştırabilir. Yalnız beklediğiniz bir dosyaysa kabul edin.")
		}
		body := "Teknisyen size bir dosya göndermek istiyor:\r\n" + p.Name + "\r\nBoyut: " + humanSize(p.Size) +
			"  ·  İndirilenler klasörüne kaydedilir"
		fid := p.FID
		decide := func(kind flow.EventKind) func() {
			return func() {
				u.offerFID = ""
				u.emit(flow.Event{Kind: kind, FID: fid})
			}
		}
		u.offer = u.newConsent(consentSpec{title: "Dosya teklifi", heading: "Dosya teklifi", body: body,
			grantText: "&Kabul et", warns: warns, hotkeyOK: true, slot: &u.offer,
			onGrant: decide(flow.EvFileAccept), onDeny: decide(flow.EvFileReject)})
		u.offerFID = fid
	})
}

// FileOfferWithdrawn gönderen teklifi geri çekti: diyalog karar verilmeden kapanır.
func (u *UI) FileOfferWithdrawn(fid string) {
	u.t.Do(func() {
		if u.offer != nil && u.offerFID == fid {
			closeDlg(u.offer)
			u.offerFID = ""
		}
	})
}

// FileProgress AC-53: yüzde + iptal düğmesi.
func (u *UI) FileProgress(done, total int64) {
	u.t.Do(func() {
		if u.sess == nil || total <= 0 {
			return
		}
		win.SetText(u.sess.fileLbl.h, fmt.Sprintf("Dosya alınıyor: %%%d", done*100/total))
		win.ShowWindow(u.sess.fileBtn.h, win.SW_SHOWNORMAL)
	})
}

// FileResult AC-54: "Dosya bozuk" vb.
func (u *UI) FileResult(r transfer.Result) {
	u.t.Do(func() {
		if u.sess == nil {
			return
		}
		var msg string
		switch r.Status {
		case "OK":
			msg = "Dosya kaydedildi: " + r.Path
			if r.MOTWFailed {
				msg += " (Uyarı: güvenlik işareti yazılamadı; dosyayı açmadan önce dikkatli olun.)"
			}
		case "CORRUPT":
			msg = "Dosya bozuk; silindi: " + r.Name
		case "CANCELLED":
			msg = "Dosya aktarımı iptal edildi: " + r.Name
		case "REJECTED":
			msg = "Dosya reddedildi: " + r.Name
			if r.MOTWFailed {
				msg = "Dosya kaydedilmedi: " + r.Name + " (Bu klasöre güvenlik işareti yazılamıyor; " +
					"program çalıştırabilen dosyalar işaretsiz bırakılmaz.)"
			}
		default:
			msg = "Dosya reddedildi: " + r.Name
		}
		appendLine(u.sess.history, "Sistem", msg)
		win.SetText(u.sess.fileLbl.h, "")
		win.ShowWindow(u.sess.fileBtn.h, win.SW_HIDE)
	})
}

// EndedNote AC-187: Ended'dan önce çağrılır; "Bu bilgisayar artık … için kayıtlı" son ekrana eklenir.
func (u *UI) EndedNote(note string) {
	u.t.Do(func() { u.endNote = note })
}

// Ended son ekran; göstergeler ve işaretleme katmanı hemen kalkar (AC-107: çağıran 3 sn içinde kapatır).
func (u *UI) Ended(m flow.Message) {
	u.t.Do(func() {
		u.teardownSession()
		if s := u.sess; s != nil {
			s.finished = true
			win.SetText(s.watch.h, m.Title)
			win.SetText(s.status.h, m.Body)
			if u.endNote != "" {
				appendLine(s.history, "Sistem", u.endNote)
			}
			for _, c := range []*ctrl{s.input, s.sendBtn, s.endBtn, s.fileBtn, s.grantBtn, s.closeBtn} {
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
	if u.lobby != nil {
		u.lobby.destroy()
		u.lobby = nil
	}
	if u.ind != nil {
		u.ind.close()
		u.ind = nil
	}
	if u.ov != nil {
		u.ov.close()
		u.ov = nil
	}
}
