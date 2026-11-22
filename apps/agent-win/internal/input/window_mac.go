package input

import "math"

// P33 K2 (mimari-p33 §6.4, K-P33-5/9; S-P33-T-3, S-P33-T-5): WindowAPI'nin macOS karar mantığı. Build etiketsizdir:
// kararlar (sayfa/menü kabulü, ön plan, AX hatası → düş) sahte sorgularla Linux CI'da sınanır. İşletim sistemi
// sorguları macQuery'dedir (window_darwin.go: CoreGraphics pencere listesi + Accessibility). Pencere kimliği
// CGWindowID'dir; koordinatlar genel nokta (enjektörün uzayı).
//
//   - Exists/Iconic/Bounds: CG tek pencere sorgusu; Iconic = kCGWindowIsOnscreen yok/false (küçültme, ⌘H, başka Space,
//     tam ekran tek durum).
//   - RootAt: ekrandaki pencerelerde (önden arkaya) noktayı içeren ilk pencere. Kendi pencerelerimizden yalnız tıklama
//     geçirgen olanlar (gösterge, TEST bandı) atlanır; girdi alan pencerelerimiz (input.SetOwnWindows) örtücü sayılır
//     → olay düşer (Y-P28f-K1 korumasının pencere modundaki karşılığı).
//   - Owner: hedefle aynı PID'li katman ≠ 0 pencere (menü 101, açılır panel) → hedef. Katman 0 → yalnız AX ile kesin:
//     hedef AX penceresinin AXSheet çocuğunun çerçevesi bu pencereyle aynıysa hedef. AX hatası/belirsizlik → 0 (düşer).
//   - ForegroundRoot: AXFocusedApplication → AXFocusedWindow hedef ya da hedefin AX sayfası ise hedef; değilse/AX
//     hatası → 0. AX ↔ CGWindowID eşlemesi PID + çerçeveyle; hedefle aynı çerçeveli ikinci pencere varsa belirsiz → 0.
//   - OSModifiers: CGEventSourceFlagsState; Applier'ın DOM rol sırasıyla (win = ⌃, alt = ⌥, ctrl = ⌘). OSShift: ⇧.
//   - Accessibility: Yapışkan Tuşlar / Fare Tuşları (com.apple.universalaccess; okunamazsa açık).

// cgWin CG pencere listesinin sayısal kaydı.
type cgWin struct {
	ID       uint32
	PID      int32
	Layer    int
	OnScreen bool
	B        FRect
}

// axWin odaklı AX penceresi: rolü, çerçevesi ve (sayfa ise) üst pencerenin çerçevesi.
type axWin struct {
	PID       int32
	Role      string
	Frame     FRect
	Parent    FRect
	HasParent bool
}

// macQuery işletim sistemi sorguları (darwin: macOSQuery; testte sahte).
type macQuery interface {
	Win(id uint32) (cgWin, bool)
	OnScreen() []cgWin
	SelfPID() int32
	// Focused AXFocusedApplication → AXFocusedWindow; okunamazsa hata.
	Focused() (axWin, error)
	// Sheets pid uygulamasının frame çerçeveli AX penceresinin AXSheet çerçeveleri; okunamazsa hata.
	Sheets(pid int32, frame FRect) ([]FRect, error)
	Flags() uint64
	Cursor() (x, y float64, ok bool)
	Sticky() bool
	MouseKeys() bool
}

const (
	cgMenuLayer = 101 // kCGPopUpMenuWindowLevel
	axSheet     = "AXSheet"
	frameSlop   = 1.0 // nokta; AX ve CG çerçeveleri yuvarlama farkı
)

// MacWindowAPI WindowAPI'nin macOS uygulaması; target paylaşılan pencere (CGWindowID).
type MacWindowAPI struct {
	q      macQuery
	target uint32
}

func (m MacWindowAPI) Exists(h uintptr) bool { _, ok := m.q.Win(uint32(h)); return ok && h != 0 }
func (m MacWindowAPI) Iconic(h uintptr) bool { w, ok := m.q.Win(uint32(h)); return !ok || !w.OnScreen }

func (m MacWindowAPI) Bounds(h uintptr) (Rect, bool) {
	w, ok := m.q.Win(uint32(h))
	if !ok || w.B.W < 1 || w.B.H < 1 {
		return Rect{}, false
	}
	l, t := int32(math.Ceil(w.B.X)), int32(math.Ceil(w.B.Y))
	return Rect{Left: l, Top: t, Right: int32(math.Floor(w.B.X + w.B.W)), Bottom: int32(math.Floor(w.B.Y + w.B.H))}, true
}

func (m MacWindowAPI) RootAt(x, y int32) uintptr {
	fx, fy := float64(x), float64(y)
	self := m.q.SelfPID()
	for _, w := range m.q.OnScreen() {
		if !inside(w.B, fx, fy) {
			continue
		}
		if w.PID == self && !overOwnWindow(fx, fy) {
			continue // tıklama geçirgen kendi penceremiz (gösterge, TEST bandı)
		}
		return uintptr(w.ID)
	}
	return 0
}

// inside sağ/alt kenar hariç.
func inside(r FRect, x, y float64) bool { return x >= r.X && x < r.X+r.W && y >= r.Y && y < r.Y+r.H }

func (m MacWindowAPI) ForegroundRoot() uintptr {
	tw, ok := m.q.Win(m.target)
	if !ok {
		return 0
	}
	f, err := m.q.Focused()
	if err != nil || f.PID != tw.PID || !m.unique(tw) {
		return 0
	}
	switch {
	case f.Role == axSheet && f.HasParent && sameFrame(f.Parent, tw.B):
		return uintptr(m.target)
	case f.Role != axSheet && sameFrame(f.Frame, tw.B):
		return uintptr(m.target)
	}
	return 0
}

func (m MacWindowAPI) Owner(h uintptr) uintptr {
	w, ok := m.q.Win(uint32(h))
	tw, tok := m.q.Win(m.target)
	if !ok || !tok || w.PID != tw.PID || uint32(h) == m.target {
		return 0
	}
	if w.Layer != 0 {
		return uintptr(m.target) // aynı süreçten menü / açılır panel (nokta zaten hedefe kırpılı)
	}
	if !m.unique(tw) {
		return 0
	}
	sheets, err := m.q.Sheets(tw.PID, tw.B)
	if err != nil {
		return 0
	}
	for _, s := range sheets {
		if sameFrame(s, w.B) {
			return uintptr(m.target)
		}
	}
	return 0
}

// unique hedefle aynı PID ve çerçevede başka katman-0 pencere yok (AX ↔ CG eşlemesi kesin).
func (m MacWindowAPI) unique(tw cgWin) bool {
	n := 0
	for _, w := range m.q.OnScreen() {
		if w.PID == tw.PID && w.Layer == 0 && sameFrame(w.B, tw.B) {
			n++
		}
	}
	return n <= 1
}

func sameFrame(a, b FRect) bool {
	return math.Abs(a.X-b.X) <= frameSlop && math.Abs(a.Y-b.Y) <= frameSlop &&
		math.Abs(a.W-b.W) <= frameSlop && math.Abs(a.H-b.H) <= frameSlop
}

func (m MacWindowAPI) CursorPos() (int32, int32) {
	x, y, ok := m.q.Cursor()
	if !ok {
		return math.MinInt32, math.MinInt32 // hiçbir pencerede değil → düşer
	}
	return int32(math.Floor(x)), int32(math.Floor(y))
}

func (m MacWindowAPI) ThreadProcess(h uintptr) (uint32, uint32) {
	if w, ok := m.q.Win(uint32(h)); ok && w.PID > 0 {
		return 0, uint32(w.PID)
	}
	return 0, 0
}

func (m MacWindowAPI) IsMenu(h uintptr) bool {
	w, ok := m.q.Win(uint32(h))
	return ok && w.Layer == cgMenuLayer
}

// OSModifiers DOM rol sırasıyla: win = ⌃ Control, alt = ⌥ Option, ctrl = ⌘ Command (keys_mac.go eşlemesi).
func (m MacWindowAPI) OSModifiers() (win, alt, ctrl bool) {
	f := m.q.Flags()
	return f&flagControl != 0, f&flagAlternate != 0, f&flagCommand != 0
}

// OSShift osShifter: işletim sisteminin ⇧ durumu (kilitli Yapışkan ⇧ dahil).
func (m MacWindowAPI) OSShift() bool { return m.q.Flags()&flagShift != 0 }

func (m MacWindowAPI) Accessibility() (sticky, mouseKeys bool) { return m.q.Sticky(), m.q.MouseKeys() }
