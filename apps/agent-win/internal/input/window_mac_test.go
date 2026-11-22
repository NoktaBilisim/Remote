package input

import (
	"errors"
	"testing"
)

// P33 K2 (mimari-p33 §6.4, §9; AC-547/548, S-P33-T-3): MacWindowAPI kararları sahte sorgularla (Linux CI'da da).

type fakeMacQ struct {
	wins     []cgWin // önden arkaya; hepsi Win ile de bulunur
	self     int32
	focused  axWin
	focusErr error
	sheets   []FRect
	sheetErr error
	flags    uint64
}

func (q *fakeMacQ) Win(id uint32) (cgWin, bool) {
	for _, w := range q.wins {
		if w.ID == id {
			return w, true
		}
	}
	return cgWin{}, false
}
func (q *fakeMacQ) OnScreen() []cgWin {
	var out []cgWin
	for _, w := range q.wins {
		if w.OnScreen {
			out = append(out, w)
		}
	}
	return out
}
func (q *fakeMacQ) SelfPID() int32                       { return q.self }
func (q *fakeMacQ) Focused() (axWin, error)              { return q.focused, q.focusErr }
func (q *fakeMacQ) Sheets(int32, FRect) ([]FRect, error) { return q.sheets, q.sheetErr }
func (q *fakeMacQ) Flags() uint64                        { return q.flags }
func (q *fakeMacQ) Cursor() (float64, float64, bool)     { return 0, 0, false }
func (q *fakeMacQ) Sticky() bool                         { return false }
func (q *fakeMacQ) MouseKeys() bool                      { return false }

const (
	mTarget = 10 // paylaşılan pencere (PID 500)
	mOther  = 11 // aynı uygulamanın başka penceresi (katman 0, sayfa değil), hedefin üstünde
	mSheet  = 12 // hedefin "Kaydet" sayfası
	mMenu   = 13 // hedefin açılır menüsü (katman 101)
	mOwn    = 14 // kendi oturum penceremiz (girdi alır)
	mBadge  = 15 // kendi göstergemiz (tıklama geçirgen)
	mPanel  = 16 // süreç dışı Kaydet/Aç paneli (başka PID)
)

var (
	tFrame     = FRect{X: 100, Y: 100, W: 800, H: 600}
	sheetFrame = FRect{X: 300, Y: 122, W: 400, H: 300}
)

func newMacQ() *fakeMacQ {
	return &fakeMacQ{self: 900, wins: []cgWin{
		{ID: mMenu, PID: 500, Layer: 101, OnScreen: true, B: FRect{X: 120, Y: 120, W: 200, H: 300}},
		{ID: mBadge, PID: 900, Layer: 1000, OnScreen: true, B: FRect{X: 0, Y: 0, W: 1920, H: 40}},
		{ID: mOwn, PID: 900, Layer: 0, OnScreen: true, B: FRect{X: 700, Y: 500, W: 300, H: 200}},
		{ID: mSheet, PID: 500, Layer: 0, OnScreen: true, B: sheetFrame},
		{ID: mOther, PID: 500, Layer: 0, OnScreen: true, B: FRect{X: 150, Y: 400, W: 300, H: 200}},
		{ID: mPanel, PID: 777, Layer: 0, OnScreen: true, B: FRect{X: 600, Y: 150, W: 200, H: 100}},
		{ID: mTarget, PID: 500, Layer: 0, OnScreen: true, B: tFrame},
	}, focused: axWin{PID: 500, Role: "AXWindow", Frame: tFrame}}
}

func TestAC547MacOwnerSheetMenuAndSamePID(t *testing.T) {
	q := newMacQ()
	q.sheets = []FRect{sheetFrame}
	m := MacWindowAPI{q: q, target: mTarget}
	if m.Owner(mMenu) != mTarget || !m.IsMenu(mMenu) {
		t.Fatal("aynı PID'li menü (katman 101) hedefe ait sayılmalı")
	}
	if m.Owner(mSheet) != mTarget {
		t.Fatal("AX ile doğrulanmış sayfa hedefe ait sayılmalı")
	}
	if m.Owner(mOther) != 0 {
		t.Fatal("aynı PID, katman 0, sayfa değil → düşmeli")
	}
	if m.Owner(mPanel) != 0 {
		t.Fatal("süreç dışı panel (başka PID) → düşmeli (R-P33-4)")
	}
	q.sheetErr = errors.New("ax")
	if m.Owner(mSheet) != 0 {
		t.Fatal("AX hatası → düşmeli (S-P33-T-3)")
	}
}

func TestAC548MacForegroundRoot(t *testing.T) {
	q := newMacQ()
	m := MacWindowAPI{q: q, target: mTarget}
	if m.ForegroundRoot() != mTarget {
		t.Fatal("odaklı pencere hedef")
	}
	q.focused = axWin{PID: 500, Role: "AXWindow", Frame: FRect{X: 150, Y: 400, W: 300, H: 200}}
	if m.ForegroundRoot() != 0 {
		t.Fatal("aynı uygulamanın başka penceresi odakta → 0")
	}
	q.focused = axWin{PID: 500, Role: axSheet, Frame: sheetFrame, Parent: tFrame, HasParent: true}
	if m.ForegroundRoot() != mTarget {
		t.Fatal("hedefin sayfası odakta → hedef")
	}
	q.focused = axWin{PID: 777, Role: "AXWindow", Frame: tFrame}
	if m.ForegroundRoot() != 0 {
		t.Fatal("başka süreç odakta → 0")
	}
	q.focused, q.focusErr = axWin{PID: 500, Role: "AXWindow", Frame: tFrame}, errors.New("ax")
	if m.ForegroundRoot() != 0 {
		t.Fatal("AX hatası → 0 (düşer)")
	}
	q.focusErr = nil
	q.wins = append(q.wins, cgWin{ID: 99, PID: 500, Layer: 0, OnScreen: true, B: tFrame}) // aynı çerçeveli ikinci pencere
	if m.ForegroundRoot() != 0 {
		t.Fatal("belirsiz AX ↔ CG eşlemesi → 0")
	}
}

func TestAC547MacRootAtOwnWindows(t *testing.T) {
	q := newMacQ()
	m := MacWindowAPI{q: q, target: mTarget}
	SetOwnWindows([]FRect{{X: 700, Y: 500, W: 300, H: 200}})
	t.Cleanup(func() { SetOwnWindows(nil) })
	if got := m.RootAt(750, 550); got != mOwn {
		t.Fatalf("girdi alan kendi penceremiz örtücü sayılmalı: %d", got)
	}
	if got := m.RootAt(500, 20); got != 0 {
		t.Fatalf("tıklama geçirgen göstergemiz atlanmalı: %d", got)
	}
	if got := m.RootAt(200, 650); got != mTarget {
		t.Fatalf("hedef: %d", got)
	}
}

func TestAC549MacOSModifierMapping(t *testing.T) {
	q := newMacQ()
	m := MacWindowAPI{q: q, target: mTarget}
	q.flags = flagCommand
	if w, a, c := m.OSModifiers(); w || a || !c {
		t.Fatal("⌘ → ctrl (DOM Control)")
	}
	q.flags = flagControl | flagAlternate | flagShift
	if w, a, c := m.OSModifiers(); !w || !a || c || !m.OSShift() {
		t.Fatal("⌃ → win, ⌥ → alt, ⇧")
	}
}

// S-P33-T-5: tercih alanı okunamazsa açık; okunabiliyor ama anahtar yoksa kapalı.
func TestAC549MacAccessibilityFailClosed(t *testing.T) {
	if !mouseKeysState(false, false, false) {
		t.Fatal("okunamaz → açık")
	}
	if mouseKeysState(true, false, false) {
		t.Fatal("anahtar yok → kapalı")
	}
	if !mouseKeysState(true, true, true) || mouseKeysState(true, true, false) {
		t.Fatal("değer")
	}
}

// AC-547/548 uçtan uca: Applier pencere kapsamı MacWindowAPI ile — sayfa tıklaması geçer, aynı PID'li başka pencere
// ve AX hatası düşer; odak başka penceredeyken tuş düşer.
func TestAC547MacScopeEndToEnd(t *testing.T) {
	_, inj, a, _ := newScoped(t)
	q := newMacQ()
	q.sheets = []FRect{sheetFrame}
	a.SetWindowTarget(mTarget, virtDesk, MacWindowAPI{q: q, target: mTarget})
	a.SetShortcutPolicy(MacShortcuts())
	click := func(x, y float64) bool { // normalize nokta (hedef 100..900 × 100..700)
		a.Handle(btn("l", true, x, y))
		evs := inj.take()
		a.Handle(btn("l", false, x, y))
		inj.take()
		return len(evs) == 2
	}
	if !click(0.5, 0.1) { // (500,160) sayfanın içinde
		t.Fatal("sayfa tıklaması geçmeli")
	}
	if click(0.2, 0.6) { // (260,460) aynı PID'li başka pencere
		t.Fatal("aynı PID, sayfa değil → düşmeli")
	}
	q.sheetErr = errors.New("ax")
	if click(0.5, 0.1) {
		t.Fatal("AX hatası → düşmeli")
	}
	if !chord(a, inj, nil, "KeyA") {
		t.Fatal("hedef odaktayken tuş geçmeli")
	}
	q.focusErr = errors.New("ax")
	if chord(a, inj, nil, "KeyA") {
		t.Fatal("AX hatasında tuş düşmeli")
	}
}
