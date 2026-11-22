package input

import "time"

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
	a.scopeUniOnly = false
	if why := a.shortcuts().drop(a, m); why != "" { // ön plan denetiminden önce (S-P17-1, S-P33-T-2)
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
	if a.scopeUniOnly && a.pressUnicode(m) == nil { // AltGr istisnası yalnız Unicode olayına (K5 AltGr kararı m.4)
		a.dropLocked(DropShell)
		return nil
	}
	_, held := a.keys[m.Code]
	evs := a.key(m)
	if len(evs) > 0 {
		a.noteDownLocked(m.Code, held)
	}
	return evs
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
		a.altRun = 0
	case isAlt(code):
		a.altRun++
		a.shiftRun = 0
	default:
		a.shiftRun, a.altRun = 0, 0
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
