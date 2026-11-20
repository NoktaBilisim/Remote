//go:build darwin

package mac

import (
	"context"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/ui/uicore"
)

// P31 AC-513 (mimari-p31 §3.2 home_darwin.go): macOS ana ekranı. Kayıt deposu yoktur (Store=nil) → en çok bir satır
// (dosyanın firması) ya da AC-190 açıklaması; düğmeler uicore.HomeButtons(PlatformMac) tablosundan (Destek iste, Bağlantı
// kodum var); firma adresi tanımlıysa "Kötüye kullanımı bildir". Firma listesi, unut düğmeleri, tepsi ve otomatik
// başlatma kutuları yoktur. Satır metni yalnız sunucudan gelen firma adını taşır (G-E9-11; request.Display süzgeçli).

const homeW = 540

// FirmHome launch.HomeUI: karar dönene kadar bekler; pencere kapatma / ⌘Q → FirmClose.
func (u *UI) FirmHome(ctx context.Context, v launch.FirmView) launch.FirmAction {
	ch := make(chan launch.FirmAction, 1)
	u.do(func() { u.firmHome(v, ch) })
	return await(ctx, ch, launch.FirmAction{Kind: launch.FirmClose})
}

// homeHeight yerleşim adımlarının toplamı (firmHome ile aynı sıra).
func homeHeight(notice bool, abuse bool) float64 {
	h := 96.0 + 40 // başlık + satır, dolandırıcılık uyarısı
	if notice {
		h += 76
	}
	h += 42 // düğme satırı
	if abuse {
		h += 40
	}
	return h + 44 // altbilgi
}

func (u *UI) firmHome(v launch.FirmView, ch chan<- launch.FirmAction) {
	abuse := uicore.MailtoAddr(v.AbuseEmail)
	f := u.newForm(uicore.AppTitle+" — Uzaktan destek", homeW, homeHeight(v.Notice != "", abuse != ""))
	f.picture(uicore.SystemLogo(), 396, 8, 128, 56)
	f.label("Uzaktan destek", 16, 10, 370, 32, fontBig)
	f.label(uicore.HomeSingleText(v), 16, 50, 370, 40, fontNormal)
	y := 96.0
	f.danger(uicore.RequestFraudText, 16, y, 508, 36, fontNormal)
	y += 40
	if v.Notice != "" {
		f.danger(v.Notice, 16, y, 508, 72, fontNormal)
		y += 76
	}
	done := func(a launch.FirmAction) {
		f.destroy()
		u.reqQuit = nil
		u.restoreQuit()
		ch <- a
	}
	var focus objc.ID
	x := 16.0
	for _, b := range uicore.HomeButtons(v, uicore.PlatformMac) {
		act := homeAction(b.Kind)
		w := 150.0
		if b.Kind == uicore.HomeCode {
			w = 190
		}
		c := f.button(b.Text, x, y, w, 32, func(objc.ID) {
			if act.Kind != launch.FirmSupport || len(v.Firms) > 0 { // AC-190: pasif düğme yolu yine denetlenir
				done(act)
			}
		})
		enable(c, b.Enabled)
		if b.Default {
			setDefault(c)
			focus = c
		}
		x += w + 8
	}
	y += 42
	if abuse != "" {
		f.button("Kötüye kullanımı bildir", 16, y, 200, 32, func(objc.ID) { openMailto(abuse) })
		y += 40
	}
	f.label(u.footer, 16, y+4, 508, 36, fontNormal)
	closeHome := func() { done(launch.FirmAction{Kind: launch.FirmClose}) }
	u.reqQuit = closeHome
	f.onClose(closeHome)
	f.show(focus, false, 0)
}

// homeAction düğme türü → launch kararı (macOS'ta yalnız iki tür; dosyanın firması her zaman 0. satırdır).
func homeAction(k uicore.HomeButtonKind) launch.FirmAction {
	if k == uicore.HomeSupport {
		return launch.FirmAction{Kind: launch.FirmSupport, Index: 0}
	}
	return launch.FirmAction{Kind: launch.FirmCode}
}

var _ launch.HomeUI = (*UI)(nil)
