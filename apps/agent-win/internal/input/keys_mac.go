package input

import "strconv"

// P28f K3 (ADR-0037 m.3, mimari-p28f §2 `input/*_darwin`): macOS tuş tablosu. Bu dosya build etiketsizdir: tablo ve
// eşleme her platformda birim testle sınanır (mimari §9 "Go birim (her platform)"); CGEvent'e yalnız
// cgevent_darwin.go dokunur.
//
// kVK_* değerleri HIToolbox `Events.h` (macOS SDK) ile birebir. ISO tuşları Chromium'un DOM code ↔ kVK eşlemesiyle aynı
// (`Backquote` ↔ kVK_ANSI_Grave, `IntlBackslash` ↔ kVK_ISO_Section): teknisyenin tarayıcısı code'u bu tabloyla üretir.
// Windows'a özgü PrintScreen / ScrollLock / Pause macOS'ta F13–F15'e (parlaklık) düşerdi → tabloda YOK (düşer).
const (
	kvkReturn         = 0x24
	kvkTab            = 0x30
	kvkSpace          = 0x31
	kvkDelete         = 0x33 // Backspace
	kvkEscape         = 0x35
	kvkCommand        = 0x37
	kvkShift          = 0x38
	kvkCapsLock       = 0x39
	kvkOption         = 0x3A
	kvkControl        = 0x3B
	kvkRightCommand   = 0x36
	kvkRightShift     = 0x3C
	kvkRightOption    = 0x3D
	kvkRightControl   = 0x3E
	kvkF5             = 0x60
	kvkF11            = 0x67
	kvkF12            = 0x6F
	kvkHelp           = 0x72 // Insert
	kvkHome           = 0x73
	kvkPageUp         = 0x74
	kvkForwardDelete  = 0x75
	kvkEnd            = 0x77
	kvkPageDown       = 0x79
	kvkLeftArrow      = 0x7B
	kvkRightArrow     = 0x7C
	kvkDownArrow      = 0x7D
	kvkUpArrow        = 0x7E
	kvkContextualMenu = 0x6E
	kvkKeypadClear    = 0x47 // NumLock'un Mac klavyedeki yeri
	kvkKeypadEnter    = 0x4C
	kvkANSIQ          = 0x0C
)

// codeMacVK KeyboardEvent.code → kVK_*. Listede olmayan code düşer (Windows tablosu codeVK ile aynı kural).
var codeMacVK = func() map[string]uint16 {
	m := map[string]uint16{
		"Enter": kvkReturn, "Escape": kvkEscape, "Backspace": kvkDelete, "Tab": kvkTab, "Space": kvkSpace,
		"Minus": 0x1B, "Equal": 0x18, "BracketLeft": 0x21, "BracketRight": 0x1E, "Backslash": 0x2A,
		"Semicolon": 0x29, "Quote": 0x27, "Backquote": 0x32, "Comma": 0x2B, "Period": 0x2F, "Slash": 0x2C,
		"IntlBackslash": 0x0A, "CapsLock": kvkCapsLock,
		// Değiştirici eşlemesi (ADR-0037 m.3; A-PF-2): Windows teknisyenin Ctrl+C/V/Z alışkanlığı Mac'te ⌘ ile çalışsın.
		"ShiftLeft": kvkShift, "ShiftRight": kvkRightShift,
		"ControlLeft": kvkCommand, "ControlRight": kvkRightCommand, // Ctrl → ⌘ Command
		"MetaLeft": kvkControl, "MetaRight": kvkRightControl, // Win → Control
		"AltLeft": kvkOption, "AltRight": kvkRightOption, // Alt → Option
		"ContextMenu": kvkContextualMenu,
		"ArrowUp":     kvkUpArrow, "ArrowDown": kvkDownArrow, "ArrowLeft": kvkLeftArrow, "ArrowRight": kvkRightArrow,
		"Insert": kvkHelp, "Delete": kvkForwardDelete, "Home": kvkHome, "End": kvkEnd,
		"PageUp": kvkPageUp, "PageDown": kvkPageDown, "NumLock": kvkKeypadClear,
		"NumpadMultiply": 0x43, "NumpadAdd": 0x45, "NumpadSubtract": 0x4E, "NumpadDecimal": 0x41,
		"NumpadDivide": 0x4B, "NumpadEnter": kvkKeypadEnter,
	}
	letters := map[byte]uint16{'A': 0x00, 'S': 0x01, 'D': 0x02, 'F': 0x03, 'H': 0x04, 'G': 0x05, 'Z': 0x06, 'X': 0x07,
		'C': 0x08, 'V': 0x09, 'B': 0x0B, 'Q': kvkANSIQ, 'W': 0x0D, 'E': 0x0E, 'R': 0x0F, 'Y': 0x10, 'T': 0x11, 'O': 0x1F,
		'U': 0x20, 'I': 0x22, 'P': 0x23, 'L': 0x25, 'J': 0x26, 'K': 0x28, 'N': 0x2D, 'M': 0x2E}
	for c, v := range letters {
		m["Key"+string(rune(c))] = v
	}
	digits := [10]uint16{0x1D, 0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19}
	numpad := [10]uint16{0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5B, 0x5C}
	for d := range 10 {
		m["Digit"+strconv.Itoa(d)] = digits[d]
		m["Numpad"+strconv.Itoa(d)] = numpad[d]
	}
	fkeys := [12]uint16{0x7A, 0x78, 0x63, 0x76, kvkF5, 0x61, 0x62, 0x64, 0x65, 0x6D, kvkF11, kvkF12}
	for i, v := range fkeys {
		m["F"+strconv.Itoa(i+1)] = v
	}
	return m
}()

// macVK Applier'ın ürettiği (Windows VK, E0) çifti → kVK. Applier platformdan bağımsız kalır (Windows ile aynı arayüz,
// `Injector`); çevirme DOM code tablosu üzerinden yapılır, iki tablonun ortak anahtarı code'dur. Çakışma (iki code aynı
// VK+E0'a) testte yakalanır (Enter / NumpadEnter E0 bayrağıyla ayrılır).
var macVK = func() map[vkInfo]uint16 {
	m := make(map[vkInfo]uint16, len(codeMacVK))
	for code, kvk := range codeMacVK {
		if vk, ok := codeVK[code]; ok {
			m[vk] = kvk
		}
	}
	return m
}()

// CGEventFlags (CGEventTypes.h / IOLLEvent.h): genel maske + aygıta özgü sol/sağ biti.
const (
	flagShift     uint64 = 0x00020000
	flagControl   uint64 = 0x00040000
	flagAlternate uint64 = 0x00080000
	flagCommand   uint64 = 0x00100000
)

// modFlag değiştirici tuşun basılıyken olaya eklenen bayrakları; değiştirici değilse 0.
func modFlag(kvk uint16) uint64 {
	switch kvk {
	case kvkShift:
		return flagShift | 0x02
	case kvkRightShift:
		return flagShift | 0x04
	case kvkControl:
		return flagControl | 0x01
	case kvkRightControl:
		return flagControl | 0x2000
	case kvkOption:
		return flagAlternate | 0x20
	case kvkRightOption:
		return flagAlternate | 0x40
	case kvkCommand:
		return flagCommand | 0x08
	case kvkRightCommand:
		return flagCommand | 0x10
	}
	return 0
}
