//go:build windows

package ui

import (
	"time"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// timerPrintTick yazdırma onayının kalan süre sayacı (1 sn).
const timerPrintTick = 9

// PrintPrompt flow.ClipPrintUI (AC-349, mimari-p28 §5.3): yazdırma onayı ortak izin diyaloğuyla (G-03: "Reddet"
// varsayılan ve odakta, "Yazdır" 1,5 sn kilitli, Enter/Space tetiklemez, enjekte tıklama yok sayılır, imleç altında
// açılmaz). Kalan süre saniyede bir yazılır; son tarihte diyalog kararsız kapanır (akış TIMEOUT bildirir). Aynı anda
// tek diyalog.
func (u *UI) PrintPrompt(p flow.PrintPrompt) {
	u.t.Do(func() {
		if u.printDlg != nil || u.sess == nil || u.sess.finished {
			return
		}
		tx, pid := flow.ClipPrintTexts, p.PID
		u.printPID = pid
		d := u.newConsent(consentSpec{title: tx.PromptTitle, heading: tx.PromptTitle,
			body: uicore.PrintBody(p, time.Until(p.Deadline), "\r\n"), grantText: "&" + tx.PromptPrint, denyText: tx.PromptReject,
			hotkeyOK: true, slot: &u.printDlg,
			onGrant: func() { u.emit(flow.Event{Kind: flow.EvPrintApprove, PID: pid}) },
			onDeny:  func() { u.emit(flow.Event{Kind: flow.EvPrintReject, PID: pid}) }})
		u.printDlg = d
		arm := d.f.timer
		d.f.timer = func(id uintptr) {
			if id != timerPrintTick {
				arm(id)
				return
			}
			left := time.Until(p.Deadline)
			if left <= 0 {
				closeDlg(d)
				return
			}
			win.SetText(d.body.h, uicore.PrintBody(p, left, "\r\n"))
		}
		win.SetTimer(d.f.h, timerPrintTick, 1000)
		win.FlashWindow(d.f.h)
	})
}

// PrintPromptClosed akış diyaloğu karar verilmeden kapatır (zaman aşımı, iptal, kontrol kapısı kapandı — Y-P28a-1 —,
// kopma); geri çağrı yapılmaz.
func (u *UI) PrintPromptClosed(pid string) {
	u.t.Do(func() {
		if u.printPID == pid {
			closeDlg(u.printDlg)
		}
	})
}

// Notice 3 sn bildirim satırı (AC-346): gösterge varsa onun altında, odak çalmaz.
func (u *UI) Notice(text string) {
	u.t.Do(func() {
		if u.ind != nil {
			u.ind.notify(u.t, text)
		}
	})
}
