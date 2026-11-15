//go:build windows

package ui

import (
	"image"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/win"
)

// consentSpec ortak izin diyaloğunun içeriği.
type consentSpec struct {
	title, heading, body, grantText string
	denyText                        string      // boşsa "Reddet" (P8b-2 onay ekranı: "Vazgeç")
	logo                            image.Image // nil değilse sağ üstte (P8b-2 onay ekranı: firma logosu)
	warns                           []string    // kırmızı uyarı satırları (kısayol yok, yönetici, tehlikeli dosya)
	hotkeyOK                        bool        // false ise "İzin ver" hiç etkinleşmez (G-21; yalnız kontrol diyaloğu)
	slot                            **consentDlg
	onGrant, onDeny                 func()
}

// consentDlg ortak izin diyaloğu (kontrol, monitör, dosya kabulü) — G-03: "Reddet" varsayılan ve odakta; "İzin ver"
// 1,5 sn kilitli, Enter/Space ile tetiklenmez (noKey); tıklamayı/erişim tuşunu üreten olay enjekteyse yok sayılır
// (S7-5, thread.userInput); imlecin altında açılmaz. Reddet, Esc ve pencere kapatma aynı ret yoludur.
type consentDlg struct {
	u       *UI
	f       *form
	grant   *ctrl
	reject  *ctrl
	body    *ctrl // P8b-2: kalan süre güncellemesi
	rule    control.Consent
	decided bool
	slot    **consentDlg
	onGrant func()
	onDeny  func()
	// warned 0.8.1: enjekte tıklama uyarısı eklendi mi (tek kez).
	warned bool
}

const (
	consentW    = 440
	consentWarn = 48 // uyarı satırı yüksekliği
)

func (u *UI) newConsent(sp consentSpec) *consentDlg {
	d := &consentDlg{u: u, rule: control.Consent{ShownAt: time.Now(), HotkeyOK: sp.hotkeyOK}, slot: sp.slot,
		onGrant: sp.onGrant, onDeny: sp.onDeny}
	btnY := int32(192)
	if len(sp.warns) > 0 {
		btnY = 140 + int32(len(sp.warns))*consentWarn + 8
	}
	f := u.t.newForm(appTitle+" — "+sp.title, consentW, btnY+44, true)
	d.body = consentContent(f, sp)
	d.addButtons(f, sp, btnY)
	f.command = func(id, _ int) {
		switch id {
		case idOK, idCancel:
			d.deny()
		case idGrant:
			d.tryGrant()
		}
	}
	f.close = d.deny
	f.timer = func(id uintptr) {
		if id == timerArm {
			win.KillTimer(f.h, timerArm)
			d.arm()
		}
	}
	d.f = f
	d.present()
	return d
}

// consentContent (varsa) logo, başlık, gövde ve kırmızı uyarı satırları; gövde denetimini döner.
func consentContent(f *form, sp consentSpec) *ctrl {
	headW := int32(408)
	if sp.logo != nil {
		headW = 280
		f.picture(sp.logo, 304, 8, 120, 32)
	}
	f.label(sp.heading, 16, 14, headW, 24, fontBold)
	body := f.label(sp.body, 16, 44, 408, 96, fontNormal)
	y := int32(140)
	for _, w := range sp.warns {
		f.danger(w, 16, y, 408, consentWarn-4, fontNormal)
		y += consentWarn
	}
	return body
}

// addButtons "Reddet" (varsayılan, Enter) ve kilitli "İzin ver" (noKey: Enter/Space tetiklemez).
func (d *consentDlg) addButtons(f *form, sp consentSpec, btnY int32) {
	denyText, grantW := "Reddet", int32(94)
	if sp.denyText != "" {
		denyText = sp.denyText
	}
	if len([]rune(sp.grantText)) > 12 {
		grantW = 150 // "Ekranımı paylaş"
	}
	d.reject = f.button(denyText, idOK, 424-grantW-102, btnY, 96, true)
	d.grant = f.button(sp.grantText, idGrant, 424-grantW, btnY, grantW, false)
	win.EnableWindow(d.grant.h, false)
	f.noKey = d.grant.h
}

// present diyaloğu imleç dışında, "Reddet" odaklı gösterir ve 1,5 sn kilidi (yeniden) başlatır. Oturum penceresindeki
// "Erişime izin ver" de yalnız bunu çağırır (S7-6): öne gelen diyalog imlecin altına düşmez ve izin yine 1,5 sn sonra.
func (d *consentDlg) present() {
	if d.decided {
		return
	}
	win.KillTimer(d.f.h, timerArm)
	win.EnableWindow(d.grant.h, false)
	d.f.showAwayFromCursor(d.reject)
	d.rule.ShownAt = time.Now() // 1,5 sn görünür olduktan sonra başlar
	win.SetTimer(d.f.h, timerArm, uint32(control.ArmDelay/time.Millisecond))
}

func (d *consentDlg) arm() {
	if !d.rule.HotkeyOK || d.decided {
		return
	}
	win.EnableWindow(d.grant.h, true)
}

// tryGrant yalnız control.Consent kuralları sağlanırsa ve tıklamayı üreten olay bu diyaloğa gelen yerel (enjekte
// olmayan) girdi ise izin verir. Enter/Space noKey ile buraya hiç ulaşmaz. Enjekte tıklama uyarı gösterir (0.8.1);
// kilit/kısayol nedenli retlerde (düğme zaten devre dışı) hiçbir şey yapılmaz.
func (d *consentDlg) tryGrant() {
	if d.decided {
		return
	}
	switch d.rule.Check(time.Now(), control.TrigClick, !d.u.t.userInput(d.f)) {
	case control.ReasonOK:
		d.finish()
		d.onGrant()
	case control.ReasonInjected:
		d.warnInjected()
	}
}

// warnInjected 0.8.1: enjekte tıklama sessizce yok sayılmaz; diyaloğa bir kez kırmızı uyarı satırı eklenir, düğmeler
// aşağı kayar ve pencere uzar (konumu korunur). Diyalog açık kalır, karar verilmez. Düğme yeri değiştiği için 1,5 sn
// kilit yeniden başlar (yer değiştiren düğmeye kaza tıklaması olmasın) ve odak "Reddet"e döner.
func (d *consentDlg) warnInjected() {
	if d.warned {
		return
	}
	d.warned = true
	f := d.f
	f.danger(control.InjectedWarning, 16, d.reject.y, 408, consentWarn-4, fontNormal)
	d.reject.y += consentWarn
	d.grant.y += consentWarn
	f.ch += consentWarn
	f.layout()
	w, h := f.size()
	win.SetWindowPos(f.h, 0, 0, 0, w, h, win.SWP_NOMOVE|win.SWP_NOZORDER|win.SWP_NOACTIVATE)
	win.KillTimer(f.h, timerArm)
	win.EnableWindow(d.grant.h, false)
	win.SetFocus(d.reject.h)
	d.rule.ShownAt = time.Now()
	win.SetTimer(f.h, timerArm, uint32(control.ArmDelay/time.Millisecond))
}

func (d *consentDlg) deny() {
	if d.decided {
		return
	}
	d.finish()
	d.onDeny()
}

// finish diyaloğu kapatır (karar verilmeden kapanışta geri çağrı yapılmaz).
func (d *consentDlg) finish() {
	d.decided = true
	d.f.destroy()
	if d.slot != nil && *d.slot == d {
		*d.slot = nil
	}
	if d.slot == &d.u.ctlDlg && d.u.sess != nil {
		win.EnableWindow(d.u.sess.grantBtn.h, false)
	}
}

func closeDlg(d *consentDlg) {
	if d != nil && !d.decided {
		d.finish()
	}
}
