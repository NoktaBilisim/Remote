//go:build darwin

package mac

import (
	"image"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/ui/uicore"
)

// promptSpec ortak onay diyaloğunun içeriği (mimari-p28f §2.1 prompt_darwin.go).
type promptSpec struct {
	title, body, grantText string
	// bodyH gövde etiketi yüksekliği; 0 → promptBody (AC-506: uzun Erişilebilirlik rehberi büyütür).
	bodyH    float64
	denyText string      // boşsa "Reddet"
	logo     image.Image // nil değilse sağ üstte
	warns    []string    // kırmızı uyarı satırları
	hotkeyOK bool        // false ise izin düğmesi hiç etkinleşmez (G-21; yalnız kontrol diyaloğu)
	// open korunan değil: 1,5 sn kilit ve localClick yok (yalnız güvenli yönde işleyen "Oturumu bitir" onayı).
	open bool
	// guard izin anında ek koşul (kontrol: gösterge sağlıklı); false → izin verilmez, diyalog açık kalır.
	guard           func() bool
	slot            **prompt
	onGrant, onDeny func()
}

// prompt G-03 + §5.2a: "Reddet" varsayılan (Enter) ve odakta, Esc ve pencere kapatma da ret; izin düğmesi görünür
// olduktan 1,5 sn sonra etkinleşir; Space/Enter/Tam Klavye Erişimi ve localClick dışı her tıklama izin vermez
// (enjekte tıklamada bir kez uyarı); diyalog imlecin altında açılmaz; açıkken enjektör duraklar (SetInjectPause).
type prompt struct {
	u       *UI
	f       *form
	sp      promptSpec
	grant   objc.ID
	reject  objc.ID
	body    objc.ID
	rule    control.Consent
	gen     int // kilit zamanlayıcısı kuşağı (present yeniden başlatır)
	decided bool
	warned  bool
	warn    objc.ID // enjekte tıklama uyarısı (gizli başlar)
	btnY    float64
}

const (
	promptW    = 440
	promptWarn = 48
	promptBody = 96
)

func (u *UI) newPrompt(sp promptSpec) *prompt {
	d := &prompt{u: u, sp: sp, rule: control.Consent{HotkeyOK: sp.hotkeyOK || sp.open}}
	bodyH := float64(promptBody)
	if sp.bodyH > bodyH {
		bodyH = sp.bodyH
	}
	d.btnY = 44 + bodyH + float64(len(sp.warns)+1)*promptWarn + 8 // +1: enjekte tıklama uyarısı için ayrılmış satır
	f := u.newForm(uicore.AppTitle+" — "+sp.title, promptW, d.btnY+48)
	headW := 408.0
	if sp.logo != nil {
		headW = 280
		f.picture(sp.logo, 304, 8, 120, 32)
	}
	f.label(sp.title, 16, 14, headW, 22, fontBold)
	d.body = f.label(sp.body, 16, 44, 408, bodyH, fontNormal)
	y := 44 + bodyH
	for _, w := range sp.warns {
		f.danger(w, 16, y, 408, promptWarn-4, fontNormal)
		y += promptWarn
	}
	d.warn = f.danger(control.InjectedWarning, 16, y, 408, promptWarn-4, fontNormal)
	show(d.warn, false)
	deny := "Reddet"
	if sp.denyText != "" {
		deny = sp.denyText
	}
	grantW := 110.0
	if len([]rune(sp.grantText)) > 12 {
		grantW = 150
	}
	d.reject = f.button(deny, 424-grantW-110, d.btnY, 104, 32, func(objc.ID) { d.deny() })
	setDefault(d.reject)
	d.grant = f.button(sp.grantText, 424-grantW, d.btnY, grantW, 32, d.tryGrant)
	d.grant.Send(objc.Sel("setRefusesFirstResponder:"), true) // Tab/Space ile odak almaz (yine de localClick)
	f.keyButton(keyEsc, d.deny)
	f.onClose(d.deny)
	d.f = f
	if !sp.open {
		u.protectedDelta(1)
	}
	d.present()
	return d
}

// present diyaloğu imleç dışında, "Reddet" odaklı öne getirir ve 1,5 sn kilidi (yeniden) başlatır. Oturum penceresindeki
// "Erişime izin ver" yalnız bunu çağırır (S7-6): izin yine 1,5 sn sonra ve yalnız diyalogdaki yerel tıklamayla.
func (d *prompt) present() {
	if d.decided {
		return
	}
	d.f.show(d.reject, true, levelFloat)
	d.rearm()
}

func (d *prompt) rearm() {
	d.gen++
	enable(d.grant, d.sp.open)
	d.rule.ShownAt = time.Now()
	if d.sp.open {
		return
	}
	gen := d.gen
	time.AfterFunc(control.ArmDelay, func() {
		d.u.do(func() {
			if gen == d.gen && !d.decided && d.rule.HotkeyOK {
				enable(d.grant, true)
			}
		})
	})
}

// tryGrant yalnız control.Consent kuralları ve localClick sağlanırsa izin verir. Enjekte tıklamada bir kez uyarı satırı
// eklenir (0.8.1 kalıbı); klavye etkinleştirmesi ve kilit/kısayol retleri sessizdir.
func (d *prompt) tryGrant(sender objc.ID) {
	if d.decided {
		return
	}
	trig, injected := control.TrigClick, false
	if !d.sp.open {
		switch clickOf(sender) {
		case clickKeyboard:
			trig = control.TrigEnterSpace
		case clickInjected:
			injected = true
		}
	}
	switch d.rule.Check(time.Now(), trig, injected) {
	case control.ReasonOK:
		if d.sp.guard != nil && !d.sp.guard() {
			return
		}
		d.finish()
		d.sp.onGrant()
	case control.ReasonInjected:
		d.warnInjected()
	}
}

// warnInjected ayrılmış uyarı satırını gösterir, kilidi yeniden başlatır ve odağı "Reddet"e verir (diyalog boyutu
// değişmez; düğmeler yer değiştirmez).
func (d *prompt) warnInjected() {
	if d.warned {
		return
	}
	d.warned = true
	show(d.warn, true)
	d.f.win.Send(objc.Sel("makeFirstResponder:"), d.reject)
	d.rearm()
}

func (d *prompt) deny() {
	if d.decided {
		return
	}
	d.finish()
	if d.sp.onDeny != nil {
		d.sp.onDeny()
	}
}

// finish diyaloğu kapatır (karar verilmeden kapanışta geri çağrı yapılmaz).
func (d *prompt) finish() {
	d.decided = true
	d.gen++
	d.f.destroy()
	if d.sp.slot != nil && *d.sp.slot == d {
		*d.sp.slot = nil
	}
	if !d.sp.open {
		d.u.protectedDelta(-1)
	}
	d.u.restoreQuit()
	if d.sp.slot == &d.u.ctlDlg && d.u.sess != nil {
		enable(d.u.sess.grantBtn, false)
	}
}

func closePrompt(d *prompt) {
	if d != nil && !d.decided {
		d.finish()
	}
}
