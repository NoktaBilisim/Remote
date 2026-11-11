//go:build windows

package ui

import (
	"fmt"
	"time"

	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/win"
)

const timerArm = 4

// HotkeyPressed input.Host'tan (kapı zaten kapatıldı): akışa control.state{VIEW, HOTKEY} için bildirir.
func (u *UI) HotkeyPressed() { u.emit(flow.Event{Kind: flow.EvControlHotkey}) }

// SetHotkey kaydedilen kapatma kısayolu (input.Host); boş = kaydedilemedi (G-21). Active'den önce çağrılır.
func (u *UI) SetHotkey(label string) { u.hotkeyLabel = label }

func hotkeyText(label string) string {
	if label == "" {
		return "Kontrolü kapatma kısayolu kaydedilemedi (başka bir program kullanıyor). Güvenliğiniz için uzaktan " +
			"kontrol izni verilemez."
	}
	return "Uzaktan kontrolü anında kapatmak için: " + label
}

// elevatedText S7-9: istemci yönetici olarak çalışıyorsa (UIPI sınırı yok) kontrol izni öncesi ve oturum penceresinde.
const elevatedText = "Dikkat: Bu program yönetici olarak çalışıyor. Uzaktan kontrol izni verirseniz teknisyen yönetici " +
	"yetkisi isteyen pencereleri ve onay ekranlarını da kullanabilir. Gerekmiyorsa oturumu bitirip programı normal açın."

// consentSpec ortak izin diyaloğunun içeriği.
type consentSpec struct {
	title, heading, body, grantText string
	warns                           []string // kırmızı uyarı satırları (kısayol yok, yönetici, tehlikeli dosya)
	hotkeyOK                        bool     // false ise "İzin ver" hiç etkinleşmez (G-21; yalnız kontrol diyaloğu)
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
	y := int32(140)
	btnY := int32(192)
	if len(sp.warns) > 0 {
		btnY = y + int32(len(sp.warns))*consentWarn + 8
	}
	f := u.t.newForm(appTitle+" — "+sp.title, consentW, btnY+44, true)
	f.label(sp.heading, 16, 14, 408, 24, fontBold)
	f.label(sp.body, 16, 44, 408, 96, fontNormal)
	for _, w := range sp.warns {
		f.danger(w, 16, y, 408, consentWarn-4, fontNormal)
		y += consentWarn
	}
	d.reject = f.button("Reddet", idOK, 228, btnY, 96, true)
	d.grant = f.button(sp.grantText, idGrant, 330, btnY, 94, false)
	win.EnableWindow(d.grant.h, false)
	f.noKey = d.grant.h
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

// ControlRequest AC-99/116: kontrol izni diyaloğu.
func (u *UI) ControlRequest(p flow.ControlPrompt) {
	u.t.Do(func() {
		if u.ctlDlg != nil || u.sess == nil || u.sess.finished {
			return
		}
		body := p.TechName + " bilgisayarınızın faresini ve klavyesini kullanmak istiyor. İzin verirseniz " +
			"ekranınızda yaptığı her şeyi görürsünüz; istediğiniz an \"Kontrolü kapat\" düğmesiyle"
		if p.Hotkey != "" {
			body += " veya " + p.Hotkey + " tuşlarıyla"
		}
		body += " kapatabilirsiniz."
		var warns []string
		if p.Hotkey == "" {
			warns = append(warns, hotkeyText(""))
		}
		if u.elevated {
			warns = append(warns, elevatedText)
		}
		u.ctlDlg = u.newConsent(consentSpec{title: "Uzaktan kontrol isteği", heading: "Uzaktan kontrol isteği",
			body: body, grantText: "&İzin ver", warns: warns, hotkeyOK: p.Hotkey != "", slot: &u.ctlDlg,
			onGrant: func() { u.emit(flow.Event{Kind: flow.EvControlGrant}) },
			onDeny:  func() { u.emit(flow.Event{Kind: flow.EvControlDeny}) }})
		// S7-6: oturum penceresindeki düğme yalnız diyaloğu öne getirir; izin vermez.
		win.EnableWindow(u.sess.grantBtn.h, true)
	})
}

// MonitorRequest AC-43: monitör değiştirme izni (aynı G-03 kuralları). Reddet/Esc/kapatma → monitor.denied (K4).
func (u *UI) MonitorRequest(mon signal.Monitor) {
	u.t.Do(func() {
		if u.monDlg != nil || u.sess == nil || u.sess.finished {
			return
		}
		body := fmt.Sprintf("Teknisyen paylaşılan ekranı \"%s\" (%d×%d) olarak değiştirmek istiyor. "+
			"İzin verirseniz o ekrandaki her şeyi görür.", mon.Name, mon.W, mon.H)
		id := mon.ID
		u.monDlg = u.newConsent(consentSpec{title: "Ekran değiştirme isteği", heading: "Ekran değiştirme isteği",
			body: body, grantText: "&İzin ver", hotkeyOK: true, slot: &u.monDlg,
			onGrant: func() { u.emit(flow.Event{Kind: flow.EvMonitorAccept, Monitor: id}) },
			onDeny:  func() { u.emit(flow.Event{Kind: flow.EvMonitorDeny}) }})
	})
}

// ControlPromptClosed release/cancel/revoke/kopma: açık kontrol diyaloğu karar verilmeden kapanır.
func (u *UI) ControlPromptClosed() { u.t.Do(func() { closeDlg(u.ctlDlg) }) }

// MonitorPromptClosed revoke/kopma: açık monitör diyaloğu karar verilmeden kapanır.
func (u *UI) MonitorPromptClosed() { u.t.Do(func() { closeDlg(u.monDlg) }) }

func closeDlg(d *consentDlg) {
	if d != nil && !d.decided {
		d.finish()
	}
}

func (u *UI) closePrompts() {
	for _, d := range []*consentDlg{u.ctlDlg, u.monDlg, u.offer} {
		closeDlg(d)
	}
}

// SetElevated S7-9: istemci yönetici olarak çalışıyor (Active'den önce çağrılır).
func (u *UI) SetElevated(on bool) { u.elevated = on }

// closeControlNow "Kontrolü kapat": kapı UI iş parçacığında hemen kapanır (AC-101 ≤ 100 ms), akış sonra bildirir.
func (u *UI) closeControlNow() {
	if u.gate != nil {
		u.gate.Close()
	}
	u.emit(flow.Event{Kind: flow.EvControlClose})
}

// ControlState AC-103: gösterge metni ve düğmeler.
func (u *UI) ControlState(granted bool, hotkey string) {
	u.t.Do(func() {
		u.granted = granted
		text := "Ekranınız izleniyor — " + u.techName
		if granted {
			text = "Uzaktan kontrol aktif — " + u.techName
		}
		if u.ind != nil {
			u.ind.setText(text)
		}
		if s := u.sess; s != nil && !s.finished {
			win.SetText(s.watch.h, text)
			win.SetText(s.hotkey.h, hotkeyText(hotkey))
			win.EnableWindow(s.closeBtn.h, granted)
			if granted {
				win.SetFocus(s.closeBtn.h)
			}
		}
	})
}

// MonitorChanged işaretleme katmanı yeni monitöre taşınır.
func (u *UI) MonitorChanged(mon signal.Monitor) {
	u.t.Do(func() {
		if u.ov != nil {
			u.ov.close()
			u.ov = nil
		}
		if r, ok := capture.MonitorRect(mon.ID); ok {
			u.ov = newOverlay(u.t, r)
		}
	})
}
