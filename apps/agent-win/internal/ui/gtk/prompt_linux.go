//go:build linux

package gtk

import (
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

// promptSpec ortak onay diyaloğunun içeriği (§2.1 prompt_linux.go): kontrol, monitör, dosya teklifi, yazdırma, ses
// kabulü, teknisyen çıkarma, oturum bitirme.
type promptSpec struct {
	title, heading, body, grantText string
	denyText                        string   // boşsa "Reddet"
	warns                           []string // kırmızı uyarı satırları
	hotkeyOK                        bool     // false ise izin düğmesi hiç etkinleşmez (G-21; yalnız kontrol diyaloğu)
	// open korunan değil: kilit ve localClick yok (yalnız güvenli yönde işleyen "Oturumu bitir" onayı).
	open bool
	// guard izin anında ek koşul (kontrol: gösterge sağlıklı); false → izin verilmez, diyalog açık kalır.
	guard           func() bool
	slot            **prompt
	onGrant, onDeny func()
}

// prompt G-03 + §5.2a: "Reddet" varsayılan (Enter) ve odakta; Esc, ✕ ve Space/Enter ret; izin düğmesi odak almaz ve
// görünür olduktan 1,5 sn sonra etkinleşir; izin yalnız localClick ile; enjekte tıklamada bir kez uyarı; X11'de
// imlecin altında açılmaz, Wayland'de oturum penceresinin monitörünün ortasında açılır; açıkken enjektör duraklar.
type prompt struct {
	u       *UI
	f       *form
	sp      promptSpec
	grant   uintptr
	reject  uintptr
	body    uintptr
	warn    uintptr
	rule    control.Consent
	gen     int
	decided bool
	warned  bool
}

func (u *UI) newPrompt(sp promptSpec) *prompt {
	d := &prompt{u: u, sp: sp, rule: control.Consent{HotkeyOK: sp.hotkeyOK || sp.open}}
	f := u.newForm(uicore.AppTitle+" — "+sp.title, 460)
	gtkWindowSetTypeHint(f.win, hintDialog)
	gtkWindowSetKeepAbove(f.win, true)
	h := sp.heading
	if h == "" {
		h = sp.title
	}
	f.heading(h)
	d.body = f.label(sp.body)
	for _, w := range sp.warns {
		f.danger(w)
	}
	d.warn = f.danger(control.InjectedWarning)
	show(d.warn, false)
	deny := "Reddet"
	if sp.denyText != "" {
		deny = sp.denyText
	}
	b := f.row()
	gtkWidgetSetHalign(b, alignCenter)
	d.reject = f.button(b, deny, d.deny)
	gtkWidgetSetCanDefault(d.reject, true)
	gtkWindowSetDefault(f.win, d.reject)
	if sp.open {
		d.grant = f.button(b, sp.grantText, d.grantOpen)
	} else {
		d.grant = f.protected(b, sp.grantText, d.tryGrant)
		u.protectedDelta(1)
	}
	onEvent(f.win, sigKey, func(ev uintptr) bool {
		if *(*uint32)(ptrAt(cptr(ev), 28)) == keyEscape {
			d.deny()
			return true
		}
		return false
	})
	f.onX = d.deny
	d.f = f
	d.present()
	return d
}

// present diyaloğu konumlar, "Reddet" odaklı öne getirir ve 1,5 sn kilidi (yeniden) başlatır. "Erişime izin ver"
// yalnız bunu çağırır (S7-6).
func (d *prompt) present() {
	if d.decided {
		return
	}
	gtkWidgetShowAll(d.f.win)
	d.u.placePrompt(d.f.win)
	gtkWindowPresent(d.f.win)
	gtkWidgetGrabFocus(d.reject)
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

// tryGrant yalnız control.Consent kuralları ve localClick sağlanırsa izin verir.
func (d *prompt) tryGrant(k clickKind) {
	if d.decided {
		return
	}
	if k == clickA11y {
		setText(d.warn, flow.LinuxTexts.A11yChanged)
		show(d.warn, true)
		d.rearm()
		return
	}
	switch d.rule.Check(time.Now(), control.TrigClick, k != clickLocal) {
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

// grantOpen korunmayan diyalog (oturumu bitir onayı; güvenli yön).
func (d *prompt) grantOpen() {
	if !d.decided {
		d.finish()
		d.sp.onGrant()
	}
}

func (d *prompt) warnInjected() {
	if d.warned {
		return
	}
	d.warned = true
	show(d.warn, true)
	gtkWidgetGrabFocus(d.reject)
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
	if d.sp.slot == &d.u.ctlDlg && d.u.sess != nil {
		enable(d.u.sess.grantBtn, false)
	}
}

func closePrompt(d *prompt) {
	if d != nil && !d.decided {
		d.finish()
	}
}

// placePrompt S-P28g-3 m.3: Wayland'de oturum penceresinin monitörünün ortası; X11'de imlecin monitörü, imlecin
// altında değil.
func (u *UI) placePrompt(win uintptr) {
	disp := gdkDisplayGetDefault()
	var nat [2]int32
	gtkWidgetGetPreferredSize(win, nil, &nat)
	var px, py int32
	var mon uintptr
	if u.wayland {
		if s := u.sess; s != nil && !s.finished {
			if gw := gtkWidgetGetWindow(s.f.win); gw != 0 {
				mon = gdkDisplayMonitorAtWindow(disp, gw)
			}
		}
	} else if seat := gdkDisplayGetDefaultSeat(disp); seat != 0 {
		if ptr := gdkSeatGetPointer(seat); ptr != 0 {
			gdkDeviceGetPosition(ptr, nil, &px, &py)
			mon = gdkDisplayMonitorAtPoint(disp, px, py)
		}
	}
	if mon == 0 {
		mon = gdkDisplayGetMonitor(disp, 0)
	}
	if mon == 0 {
		return
	}
	var wa [4]int32
	gdkMonitorGetWorkarea(mon, &wa)
	x, y := placeDialog(rect{int(wa[0]), int(wa[1]), int(wa[2]), int(wa[3])}, int(nat[0]), int(nat[1]), int(px), int(py),
		u.wayland)
	gtkWindowMove(win, int32(x), int32(y))
}
