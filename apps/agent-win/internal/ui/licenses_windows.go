//go:build windows

package ui

import (
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// P28d (ADR-0036 r3 m.1 c): tepsi menüsünden "Lisanslar" — gömülü üçüncü taraf bildirimleri salt okunur, kaydırmalı
// metin kutusunda. Ağ yok, pencere kapsamı açılmaz; açıkken yeniden istenirse öne gelir.

const licensesW, licensesH = 600, 520

// ShowLicenses bildirim penceresini açar (ya da öne getirir).
func (u *UI) ShowLicenses() {
	u.t.Do(func() {
		if f := u.licenses; f != nil && f.h != 0 {
			if win.IsIconic(f.h) {
				win.ShowWindow(f.h, swRestore)
			}
			win.SetForegroundWindow(f.h)
			return
		}
		f := u.t.newForm(appTitle+" — Lisanslar", licensesW, licensesH, false)
		text := f.edit(0, 16, 16, licensesW-32, licensesH-76,
			win.ES_MULTILINE|win.ES_READONLY|win.ES_AUTOVSCROLL|win.WS_VSCROLL, len(uicore.ThirdPartyNotices)*2)
		win.SetText(text.h, crlf(uicore.ThirdPartyNotices))
		closeBtn := f.button("Kapat", idOK, licensesW-112, licensesH-48, 96, true)
		done := func() {
			f.destroy()
			if u.licenses == f {
				u.licenses = nil
			}
		}
		f.command = func(id, _ int) {
			if id == idOK || id == idCancel {
				done()
			}
		}
		f.close = done
		u.licenses = f
		f.show(primaryWork(), true, closeBtn)
	})
}
