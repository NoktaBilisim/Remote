//go:build linux

package gtk

import (
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

// showEnded son ekran (AC-107; çağıran 2,5 sn sonra Quit): gösterge ve diyaloglar kalkar; oturum penceresi varsa
// metinleri yazılır ve denetimleri kapatılır, yoksa küçük pencere. Boş mesaj: yalnız göstergeler kalkar.
func (u *UI) showEnded(m flow.Message) {
	u.closePrompts()
	u.closeLobby()
	u.closePortal()
	if u.ind != nil {
		u.ind.close()
		u.ind = nil
	}
	if m.Title == "" {
		return
	}
	if s := u.sess; s != nil {
		s.finished, s.clipOn = true, false
		setChecked(s.clipChk, false)
		setText(s.watch, m.Title)
		setText(s.status, m.Body)
		if u.endNote != "" {
			u.appendLine(s, "Sistem", u.endNote)
		}
		for _, c := range []uintptr{s.input, s.sendBtn, s.endBtn, s.fileBtn, s.grantBtn, s.closeBtn, s.clipChk,
			s.recBtn, s.voiceMute, s.vEnd} {
			enable(c, false)
		}
		for _, r := range s.techs {
			enable(r.btn, false)
		}
		show(s.recBox, false)
		show(s.voiceBox, false)
		show(s.recNote, false)
		s.f.onX = func() {}
		return
	}
	f := u.newForm(uicore.AppTitle, 420)
	f.heading(m.Title)
	f.label(m.Body)
	f.onX = func() {}
	f.show(0)
	u.ended = f
}

// showAbout AC-128: sürüm, ikili parmak izi ve sunucu; TEST derlemesinde "TEST" (S-P28g-9).
func (u *UI) showAbout() {
	if u.about != nil && !u.about.closed {
		gtkWindowPresent(u.about.win)
		return
	}
	f := u.newForm(uicore.AppTitle+" Hakkında", 460)
	f.heading(title(uicore.AppTitle, u.test, testText()))
	f.label(u.footer)
	closeFn := func() { f.destroy(); u.about = nil }
	ok := f.button(f.row(), "Tamam", closeFn)
	f.onX = closeFn
	u.about = f
	f.show(ok)
}

// showLicenses üçüncü taraf bildirimleri (salt okunur, ağsız; godbus BSD-2 ve sistem kitaplığı notu K2'de eklenir).
func (u *UI) showLicenses() {
	if u.licenses != nil && !u.licenses.closed {
		gtkWindowPresent(u.licenses.win)
		return
	}
	f := u.newForm(uicore.AppTitle+" — Lisanslar", 640)
	f.textView(440, uicore.ThirdPartyNotices)
	closeFn := func() { f.destroy(); u.licenses = nil }
	b := f.button(f.row(), "Kapat", closeFn)
	f.onX = closeFn
	u.licenses = f
	f.show(b)
}
