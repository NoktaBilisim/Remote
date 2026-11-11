package input

import (
	"strconv"
	"strings"
)

// vkInfo sanal tuş kodu ve genişletilmiş (E0) bayrağı.
type vkInfo struct {
	vk  uint16
	ext bool
}

// codeVK KeyboardEvent.code → Windows sanal tuş kodu (winuser.h). Listede olmayan code düşürülür.
var codeVK = func() map[string]vkInfo {
	m := map[string]vkInfo{
		"Enter": {0x0D, false}, "Escape": {0x1B, false}, "Backspace": {0x08, false}, "Tab": {0x09, false},
		"Space": {0x20, false}, "Minus": {0xBD, false}, "Equal": {0xBB, false}, "BracketLeft": {0xDB, false},
		"BracketRight": {0xDD, false}, "Backslash": {0xDC, false}, "Semicolon": {0xBA, false}, "Quote": {0xDE, false},
		"Backquote": {0xC0, false}, "Comma": {0xBC, false}, "Period": {0xBE, false}, "Slash": {0xBF, false},
		"IntlBackslash": {0xE2, false}, "CapsLock": {0x14, false},
		"ShiftLeft": {0xA0, false}, "ShiftRight": {0xA1, false}, "ControlLeft": {0xA2, false},
		"ControlRight": {0xA3, true}, "AltLeft": {0xA4, false}, "AltRight": {0xA5, true},
		"MetaLeft": {0x5B, true}, "MetaRight": {0x5C, true}, "ContextMenu": {0x5D, true},
		"ArrowUp": {0x26, true}, "ArrowDown": {0x28, true}, "ArrowLeft": {0x25, true}, "ArrowRight": {0x27, true},
		"Insert": {0x2D, true}, "Delete": {0x2E, true}, "Home": {0x24, true}, "End": {0x23, true},
		"PageUp": {0x21, true}, "PageDown": {0x22, true}, "PrintScreen": {0x2C, true}, "ScrollLock": {0x91, false},
		"Pause": {0x13, false}, "NumLock": {0x90, true},
		"NumpadMultiply": {0x6A, false}, "NumpadAdd": {0x6B, false}, "NumpadSubtract": {0x6D, false},
		"NumpadDecimal": {0x6E, false}, "NumpadDivide": {0x6F, true}, "NumpadEnter": {0x0D, true},
	}
	for c := 'A'; c <= 'Z'; c++ {
		m["Key"+string(c)] = vkInfo{uint16(c), false}
	}
	for d := 0; d <= 9; d++ {
		m["Digit"+string(rune('0'+d))] = vkInfo{uint16('0' + d), false}
		m["Numpad"+string(rune('0'+d))] = vkInfo{uint16(0x60 + d), false}
	}
	for f := 1; f <= 12; f++ {
		m["F"+strconv.Itoa(f)] = vkInfo{uint16(0x6F + f), false}
	}
	return m
}()

// charKey yazı üreten tuşlar: `key` tek karakterse layout'tan bağımsız KEYEVENTF_UNICODE ile gönderilir (Türkçe
// karakterler ç ğ ı ö ş ü İ teknisyenin ve müşterinin klavye düzeni farklı olsa da doğru çıkar, AC-48).
func charKey(code string) bool {
	if strings.HasPrefix(code, "Key") || strings.HasPrefix(code, "Digit") {
		return true
	}
	switch code {
	case "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Backquote",
		"Comma", "Period", "Slash", "IntlBackslash":
		return true
	}
	return false
}

// Kısayol niteliği taşıyan değiştiriciler basılıyken harf tuşu VK olarak gönderilir (Ctrl+C, Win+E …). AltRight
// (AltGr) bu listede yok: AltGr ile üretilen karakter (@, €) Unicode gider.
var shortcutMods = []string{"ControlLeft", "ControlRight", "AltLeft", "MetaLeft", "MetaRight"}
