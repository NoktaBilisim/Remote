//go:build windows

package ui

import (
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/win"
)

// Lobby AC-112: kabul kodu, teknisyene telefonda okunur.
func (u *UI) Lobby(admitCode, techName string) {
	u.t.Do(func() {
		f := u.t.newForm(appTitle+" — Bekleme odası", 420, 290, false)
		f.label("Teknisyen onayı bekleniyor", 16, 16, 388, 24, fontBold)
		f.label("Kabul kodunuz", 16, 48, 388, 20, fontNormal)
		f.add("STATIC", admitCode, win.SS_CENTER|win.SS_NOPREFIX, 0, 0, 16, 70, 388, 44, fontBig)
		f.label("Bu kodu telefonda teknisyeninize okuyun. Teknisyen kodu girdiğinde bağlantı başlar.", 16, 122, 388, 40, fontNormal)
		f.danger("Kodu yalnız sizi aradığını bildiğiniz teknisyene söyleyin.", 16, 166, 388, 36, fontNormal)
		f.label("Teknisyen: "+techName, 16, 206, 388, 20, fontNormal)
		u.showLobby(f, 242)
	})
}

// Connecting P8b-2 (mimari-e9 §13.2): talepten doğan oturumda lobi yok; teknisyenin bağlanması beklenir.
func (u *UI) Connecting(techName string) {
	u.t.Do(func() {
		f := u.t.newForm(appTitle+" — Bağlanıyor", 420, 170, false)
		f.label("Teknisyen bağlanıyor…", 16, 16, 388, 24, fontBold)
		f.label("Teknisyen: "+techName, 16, 48, 388, 20, fontNormal)
		f.label("Ekranınız teknisyen bağlandığında paylaşılmaya başlar.", 16, 74, 388, 40, fontNormal)
		u.showLobby(f, 122)
	})
}

// showLobby bekleme penceresinin ortak sonu: "Vazgeç ve çık" (y), Esc/kapatma oturumu bitirir; pencere lobi yuvasına
// girer (ChooseShare/Active kapatır).
func (u *UI) showLobby(f *form, btnY int32) {
	f.button("Vazgeç ve çık", idCancel, 16, btnY, 150, false)
	f.command = func(id, _ int) {
		if id == idCancel {
			u.emit(flow.Event{Kind: flow.EvEnd})
		}
	}
	f.close = func() { u.emit(flow.Event{Kind: flow.EvEnd}) }
	f.show(win.WorkAreaAt(win.CursorPos()), true, nil)
	u.lobby = f
}
