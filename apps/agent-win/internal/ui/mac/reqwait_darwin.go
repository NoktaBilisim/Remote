//go:build darwin

package mac

import (
	"context"
	"strings"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/ui/uicore"
)

// P31 AC-515 (mimari-p31 §3.2 reqwait_darwin.go): bekleme penceresi (talep kodu, sıra, süre, talep sohbeti, "Talebi iptal
// et") ve kapanış ekranı. Sohbet metnini request.Chat üretir (süzülmüş, önekli, tavanlı); geçmiş salt okunur düz metin
// (bağlantı/veri algılama kapalı). Pencereyi kapatmak ya da ⌘Q talebi iptal eder ve uygulamayı kapatır (AC-163).

type reqWait struct {
	f                       *form
	code, pos, elapsed, msg objc.ID
	history, input, send    objc.ID
	note                    objc.ID
	rev                     int
	canSend                 bool // "Gönder" etkin (Enter da yalnız bu durumda gönderir)
}

// RequestEvents bekleme/onay ekranı eylemleri (request.Deps.Events).
func (u *UI) RequestEvents() <-chan request.UserAction { return u.reqEvents }

func (u *UI) reqEmit(a request.UserAction) {
	select {
	case u.reqEvents <- a:
	default:
	}
}

// OpenURL yalnız request.DownloadURL biçimindeki https adresini açar (T-P31-8; downloadURLAllowed).
func (u *UI) OpenURL(s string) {
	if downloadURLAllowed(s) {
		u.do(func() { openURL(s) })
	}
}

// RequestWaiting AC-139/AC-515: talep kodu büyük yazıyla, sıra, geçen süre, bilgi satırı.
func (u *UI) RequestWaiting(v request.WaitView) {
	u.do(func() {
		w := u.reqWait
		if w == nil {
			w = u.newReqWait(v)
			u.reqWait = w
			u.restoreQuit()
		}
		setText(w.code, uicore.RequestCodeText(v.Code))
		setText(w.pos, uicore.WaitPositionText(v.Position))
		setText(w.elapsed, uicore.WaitElapsedText(v.Elapsed))
		msg := v.Notice
		if v.Warning != "" {
			msg = strings.TrimSpace(v.Warning + " " + msg)
		}
		setText(w.msg, msg)
	})
}

// newReqWait bekleme penceresi: firma, talep kodu, sıra/süre/bilgi, sohbet ve "Talebi iptal et".
func (u *UI) newReqWait(v request.WaitView) *reqWait {
	title := uicore.AppTitle + " — Talebiniz iletildi"
	if l := request.Display(v.Label, ""); l != "" {
		title = uicore.AppTitle + " — " + l
	}
	f := u.newForm(title, 440, 580)
	w := &reqWait{f: f}
	logo := v.Logo
	if logo == nil {
		logo = uicore.SystemLogo()
	}
	f.picture(logo, 296, 8, 128, 48)
	f.label(v.Tenant, 16, 12, 270, 22, fontBold)
	f.label("Talebiniz iletildi", 16, 38, 270, 20, fontNormal)
	f.label("Talep kodunuz", 16, 70, 408, 20, fontNormal)
	w.code = f.label("", 16, 90, 408, 46, fontHuge)
	w.code.Send(objc.Sel("setAlignment:"), uint(nsAlignCtr))
	f.label("Teknisyen sizi aradığında bu kodu söyleyin.", 16, 140, 408, 20, fontNormal)
	w.pos = f.label("", 16, 172, 408, 20, fontBold)
	w.elapsed = f.label("", 16, 196, 408, 20, fontNormal)
	w.msg = f.danger("", 16, 222, 408, 36, fontNormal)
	f.label("Teknisyenle yazışma", 16, 266, 408, 20, fontBold)
	w.history = f.textView(16, 288, 408, 170, "")
	axLabel(w.history, "Teknisyenle yazışma")
	w.input = f.field(16, 466, 316, 26, func() { u.chatSubmitReq(w) }, nil)
	axLabel(w.input, "Mesajınız")
	w.send = f.button("Gönder", 338, 464, 86, 30, func(objc.ID) { u.chatSubmitReq(w) })
	w.note = f.label("", 16, 498, 408, 20, fontNormal)
	enable(w.input, false)
	enable(w.send, false)
	f.button("Talebi iptal et", 16, 530, 150, 32, func(objc.ID) { u.reqEmit(request.UserCancel) })
	f.onClose(func() { u.reqEmit(request.UserClose) })
	f.show(w.input, false, 0)
	return w
}

// RequestChatSends "Gönder" ile verilen ham metinler.
func (u *UI) RequestChatSends() <-chan string { return u.reqChat }

// RequestChat sohbet alanını günceller (bekleme penceresi yoksa yok sayılır). Geçmiş yalnız sürüm değişince yazılır;
// pencere arka plandaysa yeni teknisyen mesajında Dock dikkati (gövde gösterilmez).
func (u *UI) RequestChat(v request.ChatView) {
	u.do(func() {
		w := u.reqWait
		if w == nil {
			return
		}
		if v.Rev != w.rev {
			w.rev = v.Rev
			setTextView(w.history, strings.ReplaceAll(v.Text, "\r\n", "\n"))
		}
		if v.Clear {
			setText(w.input, "")
		}
		if v.Restore != "" && getText(w.input) == "" { // gönderilemeyen metin kaybolmaz
			setText(w.input, v.Restore)
		}
		enable(w.input, v.Input)
		w.canSend = v.Input && v.CanSend
		enable(w.send, w.canSend)
		setText(w.note, v.Status)
		if v.NotifyNew && !sendBool(w.f.win, objc.Sel("isKeyWindow")) {
			u.app.Send(objc.Sel("requestUserAttention:"), 10) // NSInformationalRequest
		}
	})
}

// chatSubmitReq "Gönder"/Enter: ham metin akışa; doğrulama ve kutuyu boşaltma kararı request.Chat'tedir.
func (u *UI) chatSubmitReq(w *reqWait) {
	if w == nil || !w.canSend {
		return
	}
	select {
	case u.reqChat <- uicore.TrimRunes(getText(w.input), request.ChatInputLimit):
	default:
	}
}

// RequestWaitClose bekleme penceresi ve onay diyaloğu kapanır (karar verilmeden kapanışta geri çağrı yok).
func (u *UI) RequestWaitClose() {
	u.do(func() {
		closePrompt(u.reqAccept)
		if u.reqWait != nil {
			u.reqWait.f.destroy()
			u.reqWait = nil
		}
		u.restoreQuit()
	})
}

// RequestClosed süre dolumu ("Yeniden talep oluştur", form dolu), ret ("Firmanızın mesajı:" düz metin), iptal.
func (u *UI) RequestClosed(ctx context.Context, v request.ClosedView) request.ClosedAction {
	ch := make(chan request.ClosedAction, 1)
	u.do(func() {
		h := 170.0
		if v.FirmMessage != "" {
			h += 84
		}
		f := u.newForm(uicore.AppTitle, 460, h)
		f.label(v.Title, 16, 16, 428, 24, fontBold)
		f.label(v.Body, 16, 46, 428, 56, fontNormal)
		y := 110.0
		if v.FirmMessage != "" {
			f.label("Firmanızın mesajı:", 16, y, 428, 20, fontBold)
			f.label(v.FirmMessage, 16, y+22, 428, 56, fontNormal)
			y += 84
		}
		done := func(a request.ClosedAction) {
			f.destroy()
			u.reqQuit = nil
			u.restoreQuit()
			ch <- a
		}
		var focus objc.ID
		if v.Recreate {
			focus = f.button("Yeniden talep oluştur", 16, y+10, 190, 32, func(objc.ID) { done(request.ClosedRecreate) })
			setDefault(focus)
		}
		c := f.button("Kapat", 354, y+10, 90, 32, func(objc.ID) { done(request.ClosedClose) })
		if focus == 0 {
			focus = c
			setDefault(c)
		}
		u.reqQuit = func() { done(request.ClosedClose) }
		f.onClose(u.reqQuit)
		f.show(focus, false, 0)
		u.app.Send(objc.Sel("requestUserAttention:"), 10)
	})
	return await(ctx, ch, request.ClosedClose)
}

var _ request.UI = (*UI)(nil)
