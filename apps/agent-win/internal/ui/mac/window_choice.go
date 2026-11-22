package mac

import (
	"slices"

	"remote-support/agent-win/internal/flow"
)

// --- P33 pencere seçim ekranı karar mantığı (AC-542/543; mimari-p33 §6.1, §11 "Go birim: seçim mantığı") ----------
// AppKit katmanı (window_choose_darwin.go) yalnız bu durumu çizer; hangi radyonun seçili, hangi denetimin etkin olduğu ve
// Paylaş'ın hangi ShareChoice'u ürettiği burada karar verilir. Sentetik/AX etkinleştirmesi (clickInjected) yok sayılır
// (S-P28f-1 kalıbı); yerel tıklama ve klavye (Tab/Space, VoiceOver) kabul edilir.

// windowChoice seçim ekranının durumu.
type windowChoice struct {
	mon    int       // seçili monitör kimliği ("Tüm ekran")
	window bool      // "Yalnız bir pencere" seçili
	sel    uintptr   // seçili pencere (0 = yok)
	list   []uintptr // listelenen pencereler (ekran sırası)
}

// choiceView denetimlerin görünen durumu.
type choiceView struct {
	FullChecked, OneChecked bool
	MonitorsEnabled         bool    // monitör radyoları (yalnız "Tüm ekran"da)
	ListEnabled             bool    // pencere listesi (yalnız "Yalnız bir pencere"de)
	ShowList, ShowEmpty     bool    // pencere modunda liste boşsa liste yerine "pencere yok" iletisi
	Checked                 uintptr // işaretli pencere radyosu (0 = yok)
	ShareEnabled            bool    // Paylaş: tüm ekranda her zaman, pencere modunda seçim varsa
}

// newWindowChoice varsayılan: "Tüm ekran", def monitörü; çoklu monitörde def listede yoksa ilk monitör.
func newWindowChoice(monIDs []int, def int) windowChoice {
	c := windowChoice{mon: def}
	if len(monIDs) > 1 && !slices.Contains(monIDs, def) {
		c.mon = monIDs[0]
	}
	return c
}

func accepted(k clickKind) bool { return k != clickInjected }

// setMode "Tüm ekran"/"Yalnız bir pencere" seçimi; sentetik ise yok sayılır (görünen seçim duruma geri döner).
func (c *windowChoice) setMode(k clickKind, window bool) {
	if accepted(k) {
		c.window = window
	}
}

// pickMonitor monitör radyosu.
func (c *windowChoice) pickMonitor(k clickKind, id int) {
	if accepted(k) {
		c.mon = id
	}
}

// pickWindow pencere radyosu; yalnız listedeki pencere seçilebilir.
func (c *windowChoice) pickWindow(k clickKind, id uintptr) {
	if accepted(k) && slices.Contains(c.list, id) {
		c.sel = id
	}
}

// setList listeyi yeniler; seçili pencere listede kalmadıysa seçim kalkar.
func (c *windowChoice) setList(ids []uintptr) {
	c.list = ids
	if !slices.Contains(ids, c.sel) {
		c.sel = 0
	}
}

func (c *windowChoice) view() choiceView {
	return choiceView{
		FullChecked:     !c.window,
		OneChecked:      c.window,
		MonitorsEnabled: !c.window,
		ListEnabled:     c.window,
		ShowList:        !c.window || len(c.list) > 0,
		ShowEmpty:       c.window && len(c.list) == 0,
		Checked:         c.sel,
		ShareEnabled:    !c.window || c.sel != 0,
	}
}

// submit Paylaş: sentetik etkinleştirme ya da pencere modunda seçimsiz basma bir şey üretmez (ok false).
func (c *windowChoice) submit(k clickKind) (flow.ShareChoice, bool) {
	switch {
	case !accepted(k):
		return flow.ShareChoice{}, false
	case !c.window:
		return flow.ShareChoice{Monitor: c.mon}, true
	case c.sel == 0:
		return flow.ShareChoice{}, false
	}
	return flow.ShareChoice{Window: c.sel}, true
}
