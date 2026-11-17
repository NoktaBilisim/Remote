//go:build windows

package ui

import (
	"fmt"

	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/transfer"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// FileOffer AC-36 + G-03 (ortak izin diyaloğu, S7-5): "Reddet" varsayılan ve odakta; "Kabul et" 1,5 sn kilitli,
// Enter/Space ile ve enjekte tıklamayla tetiklenmez (teknisyen kendi gönderdiği dosyayı kabul edemez); diyalog
// imlecin altında açılmaz.
func (u *UI) FileOffer(p transfer.Prompt) {
	u.t.Do(func() {
		closeDlg(u.offer) // transfer.Manager aynı anda tek bekleyen teklif tutar
		var warns []string
		switch p.Warning {
		case files.WarnDoubleExtension:
			warns = append(warns, "Dikkat: Dosya adı çift uzantılı; gerçek türü gizleniyor olabilir. Beklemediğiniz bir dosyaysa reddedin.")
		case files.WarnDangerous:
			warns = append(warns, "Dikkat: Bu dosya türü bilgisayarınızda program çalıştırabilir. Yalnız beklediğiniz bir dosyaysa kabul edin.")
		}
		body := "Teknisyen size bir dosya göndermek istiyor:\r\n" + p.Name + "\r\nBoyut: " + uicore.HumanSize(p.Size) +
			"  ·  İndirilenler klasörüne kaydedilir"
		fid := p.FID
		decide := func(kind flow.EventKind) func() {
			return func() {
				u.offerFID = ""
				u.emit(flow.Event{Kind: kind, FID: fid})
			}
		}
		u.offer = u.newConsent(consentSpec{title: "Dosya teklifi", heading: "Dosya teklifi", body: body,
			grantText: "&Kabul et", warns: warns, hotkeyOK: true, slot: &u.offer,
			onGrant: decide(flow.EvFileAccept), onDeny: decide(flow.EvFileReject)})
		u.offerFID = fid
	})
}

// FileOfferWithdrawn gönderen teklifi geri çekti: diyalog karar verilmeden kapanır.
func (u *UI) FileOfferWithdrawn(fid string) {
	u.t.Do(func() {
		if u.offer != nil && u.offerFID == fid {
			closeDlg(u.offer)
			u.offerFID = ""
		}
	})
}

// FileProgress AC-53: yüzde + iptal düğmesi.
func (u *UI) FileProgress(done, total int64) {
	u.t.Do(func() {
		if u.sess == nil || total <= 0 {
			return
		}
		win.SetText(u.sess.fileLbl.h, fmt.Sprintf("Dosya alınıyor: %%%d", done*100/total))
		win.ShowWindow(u.sess.fileBtn.h, win.SW_SHOWNORMAL)
	})
}

// FileResult AC-54: "Dosya bozuk" vb.
func (u *UI) FileResult(r transfer.Result) {
	u.t.Do(func() {
		if u.sess == nil {
			return
		}
		var msg string
		switch r.Status {
		case "OK":
			msg = "Dosya kaydedildi: " + r.Path
			if r.MOTWFailed {
				msg += " (Uyarı: güvenlik işareti yazılamadı; dosyayı açmadan önce dikkatli olun.)"
			}
		case "CORRUPT":
			msg = "Dosya bozuk; silindi: " + r.Name
		case "CANCELLED":
			msg = "Dosya aktarımı iptal edildi: " + r.Name
		case "REJECTED":
			msg = "Dosya reddedildi: " + r.Name
			if r.MOTWFailed {
				msg = "Dosya kaydedilmedi: " + r.Name + " (Bu klasöre güvenlik işareti yazılamıyor; " +
					"program çalıştırabilen dosyalar işaretsiz bırakılmaz.)"
			}
		default:
			msg = "Dosya reddedildi: " + r.Name
		}
		appendLine(u.sess.history, "Sistem", msg)
		win.SetText(u.sess.fileLbl.h, "")
		win.ShowWindow(u.sess.fileBtn.h, win.SW_HIDE)
	})
}

// FileServerMode P28b (AC-363): oturumun dosya modu ilk hello'da bildirilir; oturum penceresi bu bayrakla kurulur
// (hello pencereden önce gelir).
func (u *UI) FileServerMode(server bool) {
	u.t.Do(func() { u.fileServer = server })
}

// FileServerStatus P28b dosya alanı durumu ("Yükleniyor %n", "Virüs taraması yapılıyor"); final (virüs/taranamadı)
// metin sohbet geçmişine "Sistem" satırı olarak düşer ve dosya alanı temizlenir. Dosya adı içermez.
func (u *UI) FileServerStatus(text string, final bool) {
	u.t.Do(func() {
		if u.sess == nil {
			return
		}
		if final {
			appendLine(u.sess.history, "Sistem", text)
			text = ""
		}
		win.SetText(u.sess.fileLbl.h, text)
	})
}
