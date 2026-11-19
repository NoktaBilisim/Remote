//go:build linux

package input

import "strconv"

// P28g K3 (mimari-p28g §2 `keys_linux.go`, §10.1 "tablo başına bir dosya"): DOM `code` → Linux evdev tuş kodu
// (linux/input-event-codes.h). X11 tuş kodu = evdev + 8; Wayland portalı evdev kodunu doğrudan alır. Dosya adı Linux'a
// sınırlar; tablo Linux CI'da birim testle sınanır. Tabloda olmayan code düşer.
var codeEvdev = func() map[string]uint16 {
	m := map[string]uint16{
		"Escape": 1, "Minus": 12, "Equal": 13, "Backspace": 14, "Tab": 15, "BracketLeft": 26, "BracketRight": 27,
		"Enter": 28, "ControlLeft": 29, "Semicolon": 39, "Quote": 40, "Backquote": 41, "ShiftLeft": 42, "Backslash": 43,
		"Comma": 51, "Period": 52, "Slash": 53, "ShiftRight": 54, "NumpadMultiply": 55, "AltLeft": 56, "Space": 57,
		"CapsLock": 58, "NumLock": 69, "ScrollLock": 70, "NumpadSubtract": 74, "NumpadAdd": 78, "NumpadDecimal": 83,
		"IntlBackslash": 86, "F11": 87, "F12": 88, "NumpadEnter": 96, "ControlRight": 97, "NumpadDivide": 98,
		"PrintScreen": 99, "AltRight": 100, "Home": 102, "ArrowUp": 103, "PageUp": 104, "ArrowLeft": 105,
		"ArrowRight": 106, "End": 107, "ArrowDown": 108, "PageDown": 109, "Insert": 110, "Delete": 111, "Pause": 119,
		"MetaLeft": 125, "MetaRight": 126, "ContextMenu": 127,
	}
	rows := []struct {
		keys  string
		first uint16
	}{{"QWERTYUIOP", 16}, {"ASDFGHJKL", 30}, {"ZXCVBNM", 44}}
	for _, r := range rows {
		for i, c := range r.keys {
			m["Key"+string(c)] = r.first + uint16(i)
		}
	}
	for d := 1; d <= 9; d++ {
		m["Digit"+strconv.Itoa(d)] = uint16(1 + d)
	}
	m["Digit0"] = 11
	numpad := [10]uint16{82, 79, 80, 81, 75, 76, 77, 71, 72, 73}
	for d, v := range numpad {
		m["Numpad"+strconv.Itoa(d)] = v
	}
	for f := 1; f <= 10; f++ {
		m["F"+strconv.Itoa(f)] = uint16(58 + f)
	}
	return m
}()

// linuxKey Applier'ın ürettiği (Windows VK, E0) çifti → evdev (macVK kalıbı: ortak anahtar DOM code'dur; Enter /
// NumpadEnter E0 ile ayrılır).
var linuxKey = func() map[vkInfo]uint16 {
	m := make(map[vkInfo]uint16, len(codeEvdev))
	for code, ev := range codeEvdev {
		if vk, ok := codeVK[code]; ok {
			m[vk] = ev
		}
	}
	return m
}()

// Değiştirici evdev kodları (§5.2b m.3 bütçesi).
const (
	evLeftCtrl   = 29
	evLeftShift  = 42
	evRightShift = 54
	evLeftAlt    = 56
	evRightCtrl  = 97
	evRightAlt   = 100
	evLeftMeta   = 125
	evRightMeta  = 126
	evF11        = 87
	evF12        = 88
	evL          = 38
)

// modifierKey evdev kodu değiştirici mi.
func modifierKey(code uint16) bool {
	switch code {
	case evLeftCtrl, evRightCtrl, evLeftShift, evRightShift, evLeftAlt, evRightAlt, evLeftMeta, evRightMeta:
		return true
	}
	return false
}

// keysymOf metin karakterinin X keysym'i: Latin-1 doğrudan; Türkçe ve Latin-2 harfleri eski (legacy) keysym'leriyle
// (düzen tablosunda bunlar bulunur; K0s-6: ş = 0x1ba yazıldı); diğerleri Unicode keysym (0x01000000 + kod noktası).
func keysymOf(r rune) uint32 {
	if s, ok := legacyKeysym[r]; ok {
		return s
	}
	if (r >= 0x20 && r <= 0x7e) || (r >= 0xa0 && r <= 0xff) {
		return uint32(r)
	}
	return 0x01000000 + uint32(r)
}

// legacyKeysym X11 keysymdef.h eski keysym'leri (Türkçe Q/F ve Latin-2 ortak harfler, Euro).
var legacyKeysym = map[rune]uint32{
	'ğ': 0x2bb, 'Ğ': 0x2ab, 'ı': 0x2b9, 'İ': 0x2a9, 'ş': 0x1ba, 'Ş': 0x1aa, '€': 0x20ac,
	'ł': 0x1b3, 'Ł': 0x1a3, 'ő': 0x1f5, 'Ő': 0x1d5, 'ű': 0x1fb, 'Ű': 0x1db, 'č': 0x1e8, 'Č': 0x1c8,
	'ř': 0x1f8, 'Ř': 0x1d8, 'ž': 0x1be, 'Ž': 0x1ae, 'š': 0x1b9, 'Š': 0x1a9,
}
