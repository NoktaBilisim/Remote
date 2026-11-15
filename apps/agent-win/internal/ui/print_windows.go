//go:build windows

package ui

import (
	"fmt"
	"time"

	"remote-support/agent-win/internal/flow"
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
			body: printBody(p, time.Until(p.Deadline)), grantText: "&" + tx.PromptPrint, denyText: tx.PromptReject,
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
			win.SetText(d.body.h, printBody(p, left))
		}
		win.SetTimer(d.f.h, timerPrintTick, 1000)
		win.FlashWindow(d.f.h)
	})
}

// printBody diyalog gövdesi: teknisyen, dosya, sayfa · boyut, yazıcı, kalan süre (metinler flow.ClipPrintTexts).
func printBody(p flow.PrintPrompt, left time.Duration) string {
	tx := flow.ClipPrintTexts
	secs := max(0, int((left+time.Second-1)/time.Second))
	return fmt.Sprintf(tx.PromptBody, p.TechName) + "\r\n" +
		tx.PromptFile + p.FileName + "\r\n" +
		fmt.Sprintf("%s%d  ·  %s%s", tx.PromptPages, p.Pages, tx.PromptSize, humanSize(p.Size)) + "\r\n" +
		tx.PromptPrinter + p.Printer + "\r\n" +
		fmt.Sprintf(tx.PromptRemaining, secs)
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
