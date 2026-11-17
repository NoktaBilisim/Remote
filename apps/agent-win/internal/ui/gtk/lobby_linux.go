//go:build linux

package gtk

import (
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

// Lobby AC-112: kabul kodu büyük yazıyla.
func (u *UI) Lobby(admitCode, techName string) {
	u.do(func() {
		u.closeLobby()
		f := u.newForm(uicore.AppTitle+" — Bekleme odası", 420)
		f.heading("Teknisyen onayı bekleniyor")
		f.label("Kabul kodunuz")
		c := f.label(admitCode)
		addClass(c, clsCode)
		f.label("Bu kodu telefonda teknisyeninize okuyun. Teknisyen kodu girdiğinde bağlantı başlar.")
		f.danger("Kodu yalnız sizi aradığını bildiğiniz teknisyene söyleyin.")
		f.label("Teknisyen: " + techName)
		u.showLobby(f)
	})
}

// Connecting talep oturumu (Linux'ta talep yolu yok; flow.UI sözleşmesi için aynı ekran).
func (u *UI) Connecting(techName string) {
	u.do(func() {
		u.closeLobby()
		f := u.newForm(uicore.AppTitle+" — Bağlanıyor", 420)
		f.heading("Teknisyen bağlanıyor…")
		f.label("Teknisyen: " + techName)
		f.label("Ekranınız teknisyen bağlandığında paylaşılmaya başlar.")
		u.showLobby(f)
	})
}

func (u *UI) showLobby(f *form) {
	end := func() { u.emit(flow.Event{Kind: flow.EvEnd}) }
	f.button(f.row(), "Vazgeç ve çık", end)
	f.onX = end
	f.show(0)
	u.lobby = f
}

func (u *UI) closeLobby() {
	if u.lobby != nil {
		u.lobby.destroy()
		u.lobby = nil
	}
}
