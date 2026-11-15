package input

import (
	"strings"
	"time"
)

// Pencere modu klavye kuralları (S-P17-1 kabuk kısayolları, S-P17-7 erişilebilirlik, tuş kovası); kurallar scope.go
// başındaki açıklamadadır.

// scopedKeyUp pencere modunda tuş bırakma: düşmez; kabuk kısayolu kilidi değiştiriciler bırakılınca açılır. a.mu altında.
func (a *Applier) scopedKeyUp(m Msg) []Event {
	delete(a.scopeMeta, m.Code)
	evs := a.key(m) // yalnız basılı tuşun bırakılması üretilir (key içinde)
	if len(a.scopeMeta) == 0 && !a.modHeld(shellMods...) {
		a.scopeLatch = false
	}
	return evs
}

// scopedKeyDown pencere modunda tuş basma: pencere durumu → kabuk kısayolu → ön plan → tuş kovası sırasıyla. a.mu altında.
func (a *Applier) scopedKeyDown(m Msg) []Event {
	if why := a.windowState(); why != "" {
		a.dropLocked(why)
		return nil
	}
	if why := a.shellShortcut(m.Code); why != "" { // ön plan denetiminden önce (S-P17-1)
		a.dropLocked(why)
		return nil
	}
	if a.scope.api.ForegroundRoot() != a.scope.hwnd {
		a.dropLocked(DropUnfocused)
		return a.releaseKeysLocked()
	}
	if !a.takeKeyLocked(a.cur) {
		a.dropLocked(DropKeyBurst)
		return nil
	}
	_, held := a.keys[m.Code]
	evs := a.key(m)
	if len(evs) > 0 {
		a.noteDownLocked(m.Code, held)
	}
	return evs
}

// shellMods kabuk kısayolu kilidini (scopeLatch) ayakta tutan değiştiriciler.
var shellMods = []string{"MetaLeft", "MetaRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight"}

// shellShortcut S-P17-1/7: basılan tuş pencere modunda kabuğa giden bir kısayol mu (ya da kısayol kilidi açık mı);
// düşme nedeni, geçerse "". Win basması enjekte edilmez; uzakta basılı olduğu scopeMeta'da izlenir (monitör modunda
// basılıp a.keys'te kalan Win de sayılır). Değiştirici kararı bu alıcının ve işletim sisteminin durumunun birleşimidir.
// a.mu altında.
func (a *Applier) shellShortcut(code string) string {
	osWin, osAlt, osCtrl := a.scope.api.OSModifiers()
	alt := osAlt || a.modHeld("AltLeft", "AltRight")
	ctrl := osCtrl || a.modHeld("ControlLeft", "ControlRight")
	shift := a.modHeld("ShiftLeft", "ShiftRight")
	sticky, mouseKeys := a.accessibility()
	if a.latchShortcut(code, osWin, alt, ctrl) {
		a.scopeLatch = true
		return DropShell
	}
	return a.unlatchedDrop(code, alt, shift, sticky, mouseKeys)
}

// latchShortcut kabuk kısayolu kilidini açan durumlar (sırayla): Win basması (scopeMeta'ya yazılır); açık kilit ya da
// uzakta/OS'ta/a.keys'te basılı Win; Alt+Tab, Alt/Ctrl+Esc. a.mu altında.
func (a *Applier) latchShortcut(code string, osWin, alt, ctrl bool) bool {
	switch {
	case code == "MetaLeft" || code == "MetaRight":
		a.scopeMeta[code] = true
	case a.scopeLatch || len(a.scopeMeta) > 0 || osWin || a.modHeld("MetaLeft", "MetaRight"):
	case code == "Tab" && alt, code == "Escape" && (alt || ctrl):
	default:
		return false
	}
	return true
}

// unlatchedDrop kilit açmadan düşen tuşlar (latchShortcut'tan sonra, sırayla): PrintScreen, Fare Tuşları ve Yapışkan
// Tuşlar kuralları; geçerse "". a.mu altında.
func (a *Applier) unlatchedDrop(code string, alt, shift, sticky, mouseKeys bool) string {
	switch {
	case code == "PrintScreen":
		return DropShell // değiştiricisiz de kabuğa gider (ekran alıntısı); kilit açılmaz
	case code == "NumLock" && alt && shift:
		return DropMouseKeys // Fare Tuşları kısayolu (ayar kapalıyken onay diyaloğu açar)
	case mouseKeys && (code == "NumLock" || strings.HasPrefix(code, "Numpad")):
		return DropMouseKeys
	case sticky && (code == "Tab" || code == "Escape"):
		return DropSticky // kilitli (bas-bırak ya da iki kez basılıp kilitlenmiş) Ctrl/Alt ile birleşirdi; kilit açılmaz
	case isShift(code) && !shift && a.shiftRun >= stickyShiftRun-1:
		return DropSticky
	}
	return ""
}

// accessibility erişilebilirlik ayarı; en çok accessEvery'de bir işletim sisteminden okunur. a.mu altında.
func (a *Applier) accessibility() (sticky, mouseKeys bool) {
	if a.accessAt.IsZero() || a.cur.Sub(a.accessAt) >= accessEvery {
		a.sticky, a.mouseKeys = a.scope.api.Accessibility()
		a.accessAt = a.cur
	}
	return a.sticky, a.mouseKeys
}

func isShift(code string) bool { return code == "ShiftLeft" || code == "ShiftRight" }

// noteDownLocked S-P17-7: enjekte edilen basma art arda Shift sayacını günceller (held: otomatik tekrar, sayılmaz).
// a.mu altında.
func (a *Applier) noteDownLocked(code string, held bool) {
	switch {
	case held:
	case isShift(code):
		a.shiftRun++
	default:
		a.shiftRun = 0
	}
}

// resetShellLocked kabuk kısayolu durumunu sıfırlar (monitör moduna dönüş, k.release_all, kapı kapanışı). a.mu altında.
func (a *Applier) resetShellLocked() {
	clear(a.scopeMeta)
	a.scopeLatch = false
}

// releaseKeysLocked bu alıcının basılı tuttuğu tuşların bırakılması (ön plan hedeften çıktı). a.mu altında.
func (a *Applier) releaseKeysLocked() []Event {
	var evs []Event
	for _, k := range a.keys {
		evs = append(evs, keyEvents(k, false)...)
	}
	clear(a.keys)
	return evs
}

// takeKeyLocked pencere modu tuş basma kovası (WindowKeyPerSec/WindowKeyBurst). a.mu altında.
func (a *Applier) takeKeyLocked(now time.Time) bool {
	if a.keyLast.IsZero() {
		a.keyTokens, a.keyLast = WindowKeyBurst, now
	}
	if el := now.Sub(a.keyLast).Seconds(); el > 0 {
		a.keyTokens = min(WindowKeyBurst, a.keyTokens+el*WindowKeyPerSec)
		a.keyLast = now
	}
	if a.keyTokens < 1 {
		return false
	}
	a.keyTokens--
	return true
}
