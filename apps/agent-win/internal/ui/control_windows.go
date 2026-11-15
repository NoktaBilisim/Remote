//go:build windows

package ui

import (
	"fmt"

	"remote-support/agent-win/internal/capture"
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
