//go:build windows

package ui

import (
	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// P20 K6 — bekleme penceresindeki talep sohbeti (AC-255 Go ucu; mimari-e11 §8d.3, G-P20-7, K-P20-9) ve (dosya sonunda)
// P22-G oturum sohbeti bölümü. Talep sohbeti geçmişi salt okunur düz EDIT'tir (bağlantı tıklanmaz, HTML yorumu yok); metni request.Chat üretir: gövde süzülmüş, "Teknisyen <ad>:" /
// "Siz:" öneki istemcinin, gövde satırları girintili, `\r\n`, 200 mesaj / 256 K karakter tavanı. EDIT sınırı 512 K.

const idReqChatSend = idOK // Enter "Gönder"i tetikler (bekleme penceresinin varsayılan düğmesi)

// chatPane bekleme penceresinin sohbet denetimleri.
type chatPane struct {
	history, input, send, note *ctrl
	rev                        int
	canSend                    bool // "Gönder" etkin (Enter da yalnız bu durumda gönderir)
}

// newChatPane sohbet alanını y'den başlayarak kurar; bitiş y'sini döner.
func newChatPane(f *form, y int32) (*chatPane, int32) {
	c := &chatPane{}
	f.label("Teknisyenle yazışma", 16, y, 408, 20, fontBold)
	c.history = f.edit(0, 16, y+22, 408, 170, win.ES_MULTILINE|win.ES_READONLY|win.ES_AUTOVSCROLL|win.WS_VSCROLL,
		request.ChatTextLimit)
	c.input = f.edit(idChatInput, 16, y+200, 316, 28, win.ES_AUTOHSCROLL, request.ChatInputLimit)
	c.send = f.button("Gönder", idReqChatSend, 338, y+199, 86, true)
	c.note = f.label("", 16, y+234, 408, 20, fontNormal)
	win.EnableWindow(c.input.h, false)
	win.EnableWindow(c.send.h, false)
	return c, y + 260
}

// RequestChatSends "Gönder" ile verilen ham metinler (request.Deps.UI).
func (u *UI) RequestChatSends() <-chan string { return u.reqChat }

// SetRequestChatBalloon tepsi simgesi sahibi (P20 tepsi paketi) gövdesiz balon gösterecek işlevi verir. Pencere gizliyken
// (tepside) yeni teknisyen mesajında yalnız request.ChatBalloonText ile çağrılır; mesaj gövdesi/teknisyen adı asla
// verilmez (K-P20-9). UI iş parçacığında çağrılır.
func (u *UI) SetRequestChatBalloon(show func(text string)) {
	u.t.Do(func() { u.reqChatBalloon = show })
}

// RequestChat sohbet alanını günceller (bekleme penceresi yoksa yok sayılır).
func (u *UI) RequestChat(v request.ChatView) {
	u.t.Do(func() {
		w := u.reqWait
		if w == nil || w.chat == nil {
			return
		}
		c := w.chat
		if v.Rev != c.rev {
			c.rev = v.Rev
			win.SetText(c.history.h, v.Text)
			n := uintptr(len(windows.StringToUTF16(v.Text)) - 1)
			win.SendMessage(c.history.h, win.EM_SETSEL, n, n)
			win.SendMessage(c.history.h, win.EM_SCROLLCARET, 0, 0)
		}
		if v.Clear {
			win.SetText(c.input.h, "")
		}
		if v.Restore != "" && win.GetText(c.input.h) == "" { // gönderilemeyen metin kaybolmaz
			win.SetText(c.input.h, v.Restore)
		}
		win.EnableWindow(c.input.h, v.Input)
		c.canSend = v.Input && v.CanSend
		win.EnableWindow(c.send.h, c.canSend)
		win.SetText(c.note.h, v.Status)
		if v.NotifyNew && win.Foreground() != w.f.h {
			win.FlashUntilFocus(w.f.h)
			if !windows.IsWindowVisible(windows.HWND(w.f.h)) && u.reqChatBalloon != nil {
				u.reqChatBalloon(request.ChatBalloonText)
			}
		}
	})
}

// chatSubmit "Gönder"/Enter: ham metin akışa gider; doğrulama ve giriş kutusunu boşaltma kararı request.Chat'tedir.
func (u *UI) chatSubmit(c *chatPane) {
	if c == nil || !c.canSend {
		return
	}
	select {
	case u.reqChat <- win.GetText(c.input.h):
	default:
	}
}

// --- P22-G oturum sohbeti (mimari-p22 §9; flow/chat.go modeli) ---

// newChat oturum penceresinin sohbet bölümü: başlık + "Sohbet kayıt altına alınır" notu, salt okunur düz metin geçmiş
// (EDIT; bağlantı/biçim yorumlanmaz), durum satırı, giriş + "Gönder". chat.state{true} gelene kadar giriş pasif.
func (s *sessionWin) newChat(f *form, sq int32) {
	f.label(flow.ChatTexts.Heading, 16, 80, 70, 20, fontBold)
	f.label(flow.ChatTexts.HeaderNote, 90, 80, 334, 20, fontNormal)
	s.history = f.edit(0, 16, uicore.ChatHistoryY, 408, uicore.ChatHistoryH-sq-sessionChatNoteH,
		win.ES_MULTILINE|win.ES_READONLY|win.ES_AUTOVSCROLL|win.WS_VSCROLL, 0)
	s.chatNote = f.danger(flow.ChatTexts.Unavailable, 16, uicore.ChatHistoryY+uicore.ChatHistoryH-sq-sessionChatNoteH+2,
		408, sessionChatNoteH-2, fontNormal)
	s.input = f.edit(idChatInput, 16, 306-sq, 316, 28, win.ES_AUTOHSCROLL, uicore.ChatInputLimit)
	s.sendBtn = f.button(flow.ChatTexts.Send, idOK, 338, 305-sq, 86, true)
	win.EnableWindow(s.input.h, false)
	win.EnableWindow(s.sendBtn.h, false)
}

// sessionChatNoteH sohbet durum satırının geçmiş kutusundan aldığı yükseklik.
const sessionChatNoteH = 22

// sessionChatSubmit "Gönder"/Enter: ham metin akışa gider (doğrulama, kova ve kutuyu boşaltma kararı flow'da).
func (u *UI) sessionChatSubmit(s *sessionWin) {
	if s.finished || !s.chatOn {
		return
	}
	u.emit(flow.Event{Kind: flow.EvChat, Text: win.GetText(s.input.h)})
}

// SessionChat flow.ChatUI: geçmiş yalnız sürüm değişince yazılır; pencere arka plandaysa okunmamış sayacı başlıkta.
func (u *UI) SessionChat(v flow.ChatView) {
	u.t.Do(func() {
		s := u.sess
		if s == nil || s.finished {
			return
		}
		if v.Rev != s.chatRev {
			s.chatRev = v.Rev
			text := crlf(v.Text)
			win.SetText(s.history.h, text)
			n := uintptr(len(windows.StringToUTF16(text)) - 1)
			win.SendMessage(s.history.h, win.EM_SETSEL, n, n)
			win.SendMessage(s.history.h, win.EM_SCROLLCARET, 0, 0)
		}
		if v.Clear {
			win.SetText(s.input.h, "")
		}
		if v.Restore != "" && win.GetText(s.input.h) == "" { // gönderilemeyen metin kaybolmaz
			win.SetText(s.input.h, v.Restore)
		}
		s.chatOn = v.Enabled
		win.EnableWindow(s.input.h, v.Enabled)
		win.EnableWindow(s.sendBtn.h, v.Enabled)
		win.SetText(s.chatNote.h, v.Status)
		if v.NotifyNew && !s.active {
			s.unread++
			win.SetText(s.f.h, uicore.VersionedTitle(uicore.UnreadTitle(s.unread), u.t.version))
			win.FlashWindow(s.f.h)
		}
	})
}
