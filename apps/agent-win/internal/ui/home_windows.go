//go:build windows

package ui

import (
	"context"

	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/win"
)

// RequestHome ana ekran (AC-182, 183, 189, 190; mimari-e10 §8.2): logo, sunucudan gelen firma adı, kayıt satırı,
// dolandırıcılık uyarısı (AC-125), bilgi satırı, düğmeler (Tab sırası homeButtons), sunucu + sürüm + SHA-256 satırı
// (AC-133). Sunucu metinleri statik denetimde `SS_NOPREFIX` (f.label), request.Display'den süzülmüş gelir. Enter
// odaktaki düğmeyi çalıştırır (IsDialogMessage); pasif "Destek iste" hiçbir yoldan tetiklenmez.
func (u *UI) RequestHome(ctx context.Context, v request.HomeView) request.HomeAction {
	ch := make(chan request.HomeAction, 1)
	u.t.Do(func() {
		title := v.Tenant
		if title == "" {
			title = "Uzaktan destek"
		}
		f := u.t.newForm(appTitle+" — "+title, 540, 330, false)
		logo := v.Logo
		if logo == nil {
			logo = systemLogo()
		}
		f.picture(logo, 396, 8, 128, 56)
		f.label(title, 16, 10, 370, 32, fontBig)
		f.label(registeredText(v.Registered), 16, 46, 370, 20, fontNormal)
		f.danger(fraudText, 16, 72, 508, 36, fontNormal)
		f.danger(v.Notice, 16, 114, 508, 54, fontNormal)
		var focus *ctrl
		x := int32(16)
		widths := map[int]int32{idHomeSupport: 140, idHomeCode: 170, idHomeForget: 170, idHomeAbuse: 200}
		for i, b := range homeButtons(v) {
			if i == 3 { // ikinci satır: Kötüye kullanımı bildir
				x = 16
			}
			y := int32(176)
			if i == 3 {
				y = 214
			}
			c := f.button(b.text, b.id, x, y, widths[b.id], b.def)
			win.EnableWindow(c.h, b.enabled)
			if b.def {
				focus = c
			}
			x += widths[b.id] + 8
		}
		f.button("Kapat", idCancel, 434, 214, 90, false)
		if !v.Support {
			f.label(v.Hint, 16, 252, 508, 36, fontNormal) // AC-190 açıklaması
		}
		f.label(u.footer, 16, 300, 508, 20, fontNormal)
		done := func(a request.HomeAction) { f.destroy(); ch <- a }
		f.command = func(id, _ int) {
			switch id {
			case idHomeSupport, idOK:
				if v.Support {
					done(request.HomeSupport)
				}
			case idHomeCode:
				done(request.HomeCode)
			case idHomeForget:
				done(request.HomeForget)
			case idHomeAbuse:
				win.OpenMailto(v.AbuseEmail)
			case idCancel:
				done(request.HomeClose)
			}
		}
		f.close = func() { done(request.HomeClose) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
	})
	select {
	case a := <-ch:
		return a
	case <-ctx.Done():
		return request.HomeClose
	}
}
