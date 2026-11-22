package input

import "strings"

// macShortcuts P33 K2 (mimari-p33 §6.4, AC-549; S-P33-T-2, S-P33-T-5): macOS pencere modu kısayol politikası.
// Tuşlar EŞLEME SONRASI anlamıyla değerlendirilir (keys_mac.go codeMacVK): DOM Control* = ⌘, Meta* = ⌃, Alt* = ⌥.
// "Basılı" = bu alıcının durumu VEYA işletim sisteminin durumu (WindowAPI.OSModifiers; macOS'ta win = ⌃, alt = ⌥,
// ctrl = ⌘ döner). Sıra bağlayıcıdır, ilk eşleşen düşürür:
//
//  1. Genel kural: {⌘, ⌥, ⌃}'den iki ya da fazlası basılıyken her değiştirici olmayan tuş düşer ve kilit açılır
//     (değiştiriciler bırakılana dek bütün basmalar düşer; scopedKeyUp ortak kilit çözümü).
//  2. Tek değiştirici tablosu (kilit açar): ⌃ + {ok, Space, F1–F12, Tab, Esc}; ⌥ + Space; ⌘ + {Space, Tab, `, F1–F12};
//     ⇧⌘Q; ⇧⌘3/4/5/6.
//  3. Değiştiricisiz: F3, F4, F11 (Görev Kontrolü / Launchpad / masaüstü).
//  4. Erişilebilirlik dizileri (ayardan bağımsız): art arda 5. ⇧ ve 5. ⌥ basması düşer.
//  5. Yapışkan Tuşlar açık (ya da okunamadı): Tab, Esc, Space ve 2. madde tuşları değiştiricisiz de düşer. Fare Tuşları
//     açık (ya da okunamadı): tuş takımı ve tuş takımsız karşılıkları (hostguard mouseKeysKey) düşer.
//  6. Açık izinli liste (varsayılan-ret): değiştiricisiz (⇧ serbest) her tuş; tek ⌘ (+⇧) ile harf/rakam/noktalama;
//     tek ⌥ (+⇧) ile harf/rakam. Gerisi düşer.
//
// AltGr güvenli istisnası (guvenlik-raporu K5 "AltGr kararı" m.1–5; AC-549 "normal yazı"): Windows tarayıcısı AltGr'yi
// ControlLeft + AltRight (= ⌘⌥) olarak gönderir. Kilit yokken ve 5. madde (Yapışkan/Fare Tuşları) o tuşu düşürmüyorken,
// şu basma 1–3 ve 6. maddeleri atlar: altGrText açık; alıcıda AltRight basılı, başka basılı değiştirici yalnız
// ControlLeft ve ⇧ (AltLeft/ControlRight/Meta*/CapsLock basılıysa istisna yok); OS ⌃ kapalı (OS ⌘/⌥ alıcının kendi
// enjekte ettiği tuşlardır, yok sayılır); tuş yazı tuşu (charKey) ve `key` tek, yazdırılabilir, boşluk olmayan karakter
// (yoksa, çok karakterliyse ya da "Dead" ise istisna yok → genel kural düşürür). İstisnayla geçen basma scopeUniOnly'yi
// açar: scopedKeyDown basma Unicode yoluna (bayraksız metin olayı) gitmezse enjekte etmeden düşürür; VK yoluna asla
// geçmez. 4. madde (⇧×5/⌥×5) yalnız değiştirici basmalarına uygulanır, istisna değiştirici olmayan tuşa; kümeler
// ayrıktır. Ön plan ve tuş kovası denetimleri değişmez.
//
// Değiştirici tuşların kendi basmaları (kilit yoksa ve 4. madde dışında) iletilir.
type macShortcuts struct{}

// MacShortcuts macOS pencere modu politikası (deps_darwin.go → Applier.SetShortcutPolicy).
func MacShortcuts() ShortcutPolicy { return macShortcuts{} }

// osShifter isteğe bağlı: işletim sisteminin ⇧ durumu (macOS CGEventSourceFlagsState; Yapışkan Tuşlar kilidi dahil).
type osShifter interface{ OSShift() bool }

func (macShortcuts) drop(a *Applier, m Msg) string {
	code := m.Code
	osCtl, osOpt, osCmd := a.scope.api.OSModifiers()
	cmd := osCmd || a.modHeld("ControlLeft", "ControlRight")
	ctl := osCtl || a.modHeld("MetaLeft", "MetaRight")
	opt := osOpt || a.modHeld("AltLeft", "AltRight")
	shift := a.modHeld("ShiftLeft", "ShiftRight")
	if s, ok := a.scope.api.(osShifter); ok && s.OSShift() {
		shift = true
	}
	sticky, mouseKeys := a.accessibility()
	n := 0
	for _, m := range []bool{cmd, ctl, opt} {
		if m {
			n++
		}
	}
	mod := macModifier(code)
	altGr := !mod && a.macAltGrText(m, osCtl) &&
		!(sticky && macStickyKey(code)) && !(mouseKeys && mouseKeysKey(code)) // 5 istisnadan önce
	switch {
	case a.scopeLatch:
		return DropShell
	case altGr:
		a.scopeUniOnly = true
		return ""
	case !mod && n >= 2: // 1
		a.scopeLatch = true
		return DropShell
	case isShift(code) && !a.modHeld("ShiftLeft", "ShiftRight") && a.shiftRun >= stickyShiftRun-1: // 4
		return DropSticky
	case isAlt(code) && !a.modHeld("AltLeft", "AltRight") && a.altRun >= stickyShiftRun-1: // 4
		return DropSticky
	case mod:
		return ""
	case macTable(code, cmd, ctl, opt, shift): // 2
		a.scopeLatch = true
		return DropShell
	case code == "F3" || code == "F4" || code == "F11": // 3
		return DropShell
	case sticky && macStickyKey(code): // 5
		return DropSticky
	case mouseKeys && mouseKeysKey(code): // 5
		return DropMouseKeys
	case !macAllowed(code, cmd, ctl, opt): // 6
		return DropShell
	}
	return ""
}

func isAlt(code string) bool { return code == "AltLeft" || code == "AltRight" }

// macStickyKey 5. madde: Yapışkan Tuşlar açıkken değiştiricisiz de düşen tuşlar.
func macStickyKey(code string) bool {
	return code == "Tab" || code == "Escape" || code == "Space" || macTableKey(code)
}

// macAltGrText AltGr istisnasının değiştirici ve karakter koşulları (dosya başı; K5 AltGr kararı m.1–3). a.mu altında.
func (a *Applier) macAltGrText(m Msg, osCtl bool) bool {
	return a.altGrText && !osCtl && a.modHeld("AltRight") &&
		!a.modHeld("AltLeft", "ControlRight", "MetaLeft", "MetaRight", "CapsLock") &&
		charKey(m.Code) && unicodeOf(m) != nil
}

// macModifier değiştirici tuşun kendisi (CapsLock dahil).
func macModifier(code string) bool {
	switch code {
	case "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "AltLeft", "AltRight",
		"CapsLock":
		return true
	}
	return false
}

func fKey(code string) bool {
	switch code {
	case "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12":
		return true
	}
	return false
}

func arrowKey(code string) bool { return strings.HasPrefix(code, "Arrow") }

// macTable 2. madde (tek değiştirici; genel kural ikiden fazlasını zaten düşürdü).
func macTable(code string, cmd, ctl, opt, shift bool) bool {
	switch {
	case ctl && (arrowKey(code) || fKey(code) || code == "Space" || code == "Tab" || code == "Escape"):
		return true
	case opt && code == "Space":
		return true
	case cmd && (fKey(code) || code == "Space" || code == "Tab" || code == "Backquote"):
		return true
	case cmd && shift && (code == "KeyQ" || code == "Digit3" || code == "Digit4" || code == "Digit5" || code == "Digit6"):
		return true
	}
	return false
}

// macTableKey 2. maddede geçen tuşlar (Yapışkan Tuşlar açıkken kilitli değiştiriciyle birleşebilecekleri için 5. madde).
func macTableKey(code string) bool {
	switch code {
	case "Backquote", "KeyQ", "Digit3", "Digit4", "Digit5", "Digit6":
		return true
	}
	return arrowKey(code) || fKey(code)
}

// macAllowed 6. madde açık izinli liste.
func macAllowed(code string, cmd, ctl, opt bool) bool {
	switch {
	case !cmd && !ctl && !opt:
		return true
	case cmd && !ctl && !opt:
		return charKey(code)
	case opt && !cmd && !ctl:
		return strings.HasPrefix(code, "Key") || strings.HasPrefix(code, "Digit")
	}
	return false
}
