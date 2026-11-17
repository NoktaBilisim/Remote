//go:build windows

package ui

import (
	"fmt"
	"strings"
	"time"

	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

type reqWait struct {
	f                       *form
	code, pos, elapsed, msg *ctrl
	chat                    *chatPane // P20 K6 talep sohbeti (chat_windows.go)
}

// RequestWaiting AC-139: talep kodu büyük puntoyla, sıra, geçen süre; "Talebi iptal et" (AC-141).
func (u *UI) RequestWaiting(v request.WaitView) {
	u.t.Do(func() {
		w := u.reqWait
		if w == nil {
			w = u.newReqWait(v)
			u.reqWait = w
		}
		win.SetText(w.code.h, codeText(v.Code))
		pos := "Sıra bilgisi alınıyor…"
		if v.Position > 0 {
			pos = fmt.Sprintf("Sırada %d. talepsiniz", v.Position)
		}
		win.SetText(w.pos.h, pos)
		win.SetText(w.elapsed.h, "Bekleme süresi: "+mmss(v.Elapsed))
		msg := v.Notice
		if v.Warning != "" { // QA-P8b2-2: hatırlama dosyası silinemedi
			msg = strings.TrimSpace(v.Warning + " " + msg)
		}
		win.SetText(w.msg.h, msg)
	})
}

// newReqWait bekleme penceresi: firma, talep kodu, sıra/süre/bilgi satırları, sohbet ve "Talebi iptal et".
func (u *UI) newReqWait(v request.WaitView) *reqWait {
	title := appTitle + " — Talebiniz iletildi"
	if l := request.Display(v.Label, ""); l != "" { // G-P20-7: seçili firmanın yerel etiketi
		title = appTitle + " — " + l
	}
	f := u.t.newForm(title, 440, 576, false)
	w := &reqWait{f: f}
	f.picture(orSystemLogo(v.Logo), 296, 8, 128, 48)
	f.label(v.Tenant, 16, 12, 270, 22, fontBold)
	f.label("Talebiniz iletildi", 16, 38, 270, 20, fontNormal)
	f.label("Talep kodunuz", 16, 70, 408, 20, fontNormal)
	w.code = f.add("STATIC", "", win.SS_CENTER|win.SS_NOPREFIX, 0, 0, 16, 92, 408, 44, fontBig)
	f.label("Teknisyen sizi aradığında bu kodu söyleyin.", 16, 140, 408, 20, fontNormal)
	w.pos = f.label("", 16, 172, 408, 20, fontBold)
	w.elapsed = f.label("", 16, 196, 408, 20, fontNormal)
	w.msg = f.danger("", 16, 222, 408, 36, fontNormal)
	var y int32
	w.chat, y = newChatPane(f, 266)
	f.button("Talebi iptal et", idCancel, 16, y+8, 150, false)
	f.command = func(id, _ int) {
		switch id {
		case idCancel:
			u.reqEmit(request.UserCancel)
		case idReqChatSend:
			u.chatSubmit(w.chat)
		}
	}
	f.close = func() { u.reqEmit(request.UserClose) } // AC-163: kapatma iptal eder, süreç biter
	f.show(win.WorkAreaAt(win.CursorPos()), true, w.chat.input)
	return w
}

func acceptBody(v request.AcceptView) string {
	return "Teknisyen doğrulama kodu: " + v.TechVerifyCode + " (telefondaki teknisyen de bu kodu söylemeli)\r\n" +
		"Talep kodunuz: " + codeText(v.RequestCode) + uicore.AdmitLine(v.AdmitCode) + "\r\n" +
		"\"Ekranımı paylaş\" derseniz teknisyen ekranınızı görür; uzaktan kontrol için ayrıca izin istenir.\r\n" +
		"Kalan süre: " + mmss(v.Remaining)
}

// RequestAccepted AC-154 / §13.3: P7 izin diyaloğu kuralları (odak "Vazgeç", 1,5 sn kilit, Enter/Space paylaşmaz,
// enjekte tıklama uyarısı, imleç dışında açılır); öne getirilir ve görev çubuğu yanıp söner. Otomatik onay yok.
func (u *UI) RequestAccepted(v request.AcceptView) {
	u.t.Do(func() {
		d := u.reqAccept
		key := uicore.AcceptKey{Tech: v.TechName, Verify: v.TechVerifyCode}
		switch uicore.AcceptDecision(d != nil && !d.decided, u.reqAcceptKey, key) {
		case uicore.AcceptUpdate: // yeniden bağlanmada yeni ticket, aynı teknisyen ve kod: diyalog aynı kalır
			win.SetText(d.body.h, acceptBody(v))
			return
		case uicore.AcceptReopen:
			// S8b2-3/S8b2-4: teknisyen adı veya doğrulama kodu değişti → diyalog kapatılıp yeniden açılır (1,5 sn kilit
			// yeniden başlar); müşteri eski diyalogdaki onayını aynı adlı başka teknisyene veremez.
			closeDlg(d)
		}
		u.reqAcceptKey = key
		u.reqAccept = u.newConsent(consentSpec{title: "Bağlantı isteği", heading: v.TechName + " bağlanmak istiyor",
			body: acceptBody(v), grantText: "&Ekranımı paylaş", denyText: "Vazgeç", logo: orSystemLogo(v.Logo), hotkeyOK: true,
			slot:    &u.reqAccept,
			onGrant: func() { u.reqEmit(request.UserShare) },
			onDeny:  func() { u.reqEmit(request.UserDecline) }})
		win.FlashWindow(u.reqAccept.f.h)
	})
}

// RequestAcceptedTick kalan süre (60 sn bağlanma penceresi, AC-155).
func (u *UI) RequestAcceptedTick(remaining time.Duration) {
	u.t.Do(func() {
		d := u.reqAccept
		if d == nil || d.decided {
			return
		}
		text := win.GetText(d.body.h)
		if i := strings.LastIndex(text, "Kalan süre: "); i >= 0 {
			win.SetText(d.body.h, text[:i]+"Kalan süre: "+mmss(remaining))
		}
	})
}

// RequestWaitClose bekleme penceresi ve onay diyaloğu kapanır (karar verilmeden kapanışta geri çağrı yok).
func (u *UI) RequestWaitClose() {
	u.t.Do(func() {
		closeDlg(u.reqAccept)
		if u.reqWait != nil {
			u.reqWait.f.destroy()
			u.reqWait = nil
		}
	})
}
