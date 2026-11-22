package input

import "strings"

// Pencere modu kısayol politikası (mimari-p33 K-P33-9, §6.4; S-P33-T-2). Pencere kapsamının ortak motoru (scope.go,
// scope_keys.go) tuş basmasını ön plan denetiminden ÖNCE platform politikasına sorar. Windows kuralları (S-P17-1/7)
// winShortcuts'ta davranış değişmeden durur; macOS kuralları macShortcuts'tadır (shortcuts_mac.go). İkisi de build
// etiketsizdir: tablo testleri her platformda (Linux CI) koşar.

// ShortcutPolicy pencere modunda basılan tuşun düşme nedeni ("" = geçer). a.mu altında çağrılır; politika
// Applier'ın kilit altı durumunu (scopeMeta, scopeLatch, basılı tuşlar, art arda sayaçlar) okuyup yazabilir.
type ShortcutPolicy interface {
	drop(a *Applier, code string) string
}

// winShortcuts Windows kabuk kısayolu kuralları (S-P17-1/7; P17'den taşındı, davranış aynı).
type winShortcuts struct{}

// SetShortcutPolicy pencere modu kısayol politikası (macOS: MacShortcuts). Verilmezse Windows kuralları.
func (a *Applier) SetShortcutPolicy(p ShortcutPolicy) {
	a.mu.Lock()
	a.policy = p
	a.mu.Unlock()
}

// shortcuts etkin politika. a.mu altında.
func (a *Applier) shortcuts() ShortcutPolicy {
	if a.policy == nil {
		return winShortcuts{}
	}
	return a.policy
}

// shellMods kabuk kısayolu kilidini (scopeLatch) ayakta tutan değiştiriciler.
var shellMods = []string{"MetaLeft", "MetaRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight"}

// shellShortcut S-P17-1/7: basılan tuş pencere modunda kabuğa giden bir kısayol mu (ya da kısayol kilidi açık mı);
// düşme nedeni, geçerse "". Win basması enjekte edilmez; uzakta basılı olduğu scopeMeta'da izlenir (monitör modunda
// basılıp a.keys'te kalan Win de sayılır). Değiştirici kararı bu alıcının ve işletim sisteminin durumunun birleşimidir.
// a.mu altında.
func (winShortcuts) drop(a *Applier, code string) string {
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
