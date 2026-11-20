//go:build darwin

package mac

import (
	"strings"
	"time"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/ui/uicore"
)

// P31 AC-516 (mimari-p31 K-P31-8, §3.2 reqaccept_darwin.go): teknisyen kabul edince "Bağlantı isteği" — P28f korumalı
// istem (prompt_darwin.go): "Vazgeç" varsayılan ve odakta, "Ekranımı paylaş" 1,5 sn kilitli, Return/boşluk ile
// tetiklenmez, yalnız yerel fiziksel tıklama (input.LocalClick); açıkken enjektör duraklar. Açık diyalog kararı
// uicore.AcceptDecision (Win32 ile aynı). Öne getirme + Dock dikkati (NSCriticalRequest).

const nsCriticalRequest = 0

// RequestAccepted onay diyaloğunu açar ya da (aynı teknisyen + kod) gövdesini günceller.
func (u *UI) RequestAccepted(v request.AcceptView) {
	u.do(func() {
		d := u.reqAccept
		key := uicore.AcceptKey{Tech: v.TechName, Verify: v.TechVerifyCode}
		switch uicore.AcceptDecision(d != nil && !d.decided, u.reqAcceptKey, key) {
		case uicore.AcceptUpdate: // yeniden bağlanmada yeni ticket: diyalog aynı kalır
			setText(d.body, uicore.AcceptBody(v, "\n"))
			return
		case uicore.AcceptReopen: // S8b2-3/4: ad ya da kod değişti → kapat, yeniden aç (kilit yeniden başlar)
			closePrompt(d)
		}
		u.reqAcceptKey = key
		logo := v.Logo
		if logo == nil {
			logo = uicore.SystemLogo()
		}
		u.reqAccept = u.newPrompt(promptSpec{title: uicore.AcceptHeading(v.TechName), body: uicore.AcceptBody(v, "\n"),
			bodyH: 124, grantText: "Ekranımı paylaş", denyText: "Vazgeç", logo: logo, hotkeyOK: true, slot: &u.reqAccept,
			onGrant: func() { u.reqEmit(request.UserShare) },
			onDeny:  func() { u.reqEmit(request.UserDecline) }})
		u.app.Send(objc.Sel("requestUserAttention:"), nsCriticalRequest)
	})
}

// RequestAcceptedTick kalan süre (60 sn bağlanma penceresi, AC-155): yalnız son satır değişir.
func (u *UI) RequestAcceptedTick(remaining time.Duration) {
	u.do(func() {
		d := u.reqAccept
		if d == nil || d.decided {
			return
		}
		text := getText(d.body)
		if i := strings.LastIndex(text, uicore.AcceptRemainingPrefix); i >= 0 {
			setText(d.body, text[:i]+uicore.AcceptRemainingPrefix+uicore.MMSS(remaining))
		}
	})
}
