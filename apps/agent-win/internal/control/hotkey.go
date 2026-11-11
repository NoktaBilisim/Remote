package control

import "errors"

// Hotkey kontrolü anında kapatan global kısayol (AC-102, G-21).
type Hotkey struct {
	VK    uint32
	Label string
}

// Kısayollar: önce Ctrl+Shift+F12, kaydedilemezse Ctrl+Shift+F11.
var (
	HotkeyPrimary  = Hotkey{VK: 0x7B, Label: "Ctrl+Shift+F12"}
	HotkeyFallback = Hotkey{VK: 0x7A, Label: "Ctrl+Shift+F11"}
)

// ErrNoHotkey iki kısayol da kaydedilemedi: kontrol izni verilemez.
var ErrNoHotkey = errors.New("control: kapatma kısayolu kaydedilemedi")

// RegisterHotkey önce birincil, olmazsa yedek kısayolu register ile kaydeder; kaydedilen kısayolu döner.
func RegisterHotkey(register func(Hotkey) error) (Hotkey, error) {
	for _, hk := range []Hotkey{HotkeyPrimary, HotkeyFallback} {
		if register(hk) == nil {
			return hk, nil
		}
	}
	return Hotkey{}, ErrNoHotkey
}
