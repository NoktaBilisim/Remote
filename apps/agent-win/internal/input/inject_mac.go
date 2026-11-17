package input

import (
	"math"
	"time"
)

// P28f K3 (ADR-0037 m.3, mimari-p28f §5.2a): Applier'ın platformdan bağımsız olaylarını ([]Event; SendInput biçimi)
// macOS CGEvent tariflerine çeviren saf mantık. Etiketsizdir ki her platformda birim testle sınansın; CGEvent'i kuran
// ve gönderen ince katman cgevent_darwin.go'dadır.
//
// Kurallar:
//   - Koordinat: Applier normalize noktayı monitör dikdörtgenine (nokta = point, CGDisplayBounds) ve oradan sanal
//     masaüstüne göre 0..65535'e çevirir; burada aynı sanal dikdörtgenle noktaya geri çevrilir (Retina'da piksel
//     değil nokta: ±2 px ölçütü, AC-49).
//   - Düğme basılıyken hareket `*MouseDragged`; çift tık için kCGMouseEventClickState burada sayılır (macOS sentetik
//     olayda zamanlamadan çift tık türetmez).
//   - Değiştiriciler: bayraklar bu çeviricinin bastığı tuşlardan izlenir ve her olaya açıkça konur.
//   - Unicode: ardışık UTF-16 birimleri tek olayda (≤ 20 birim, FFI kuralı 3) birleşir; bayraklar temizlenir (AltGr
//     ile üretilen karakter Option kısayolu sayılmasın).
//   - Erişilebilirlik kısayolları HİÇ enjekte edilmez (S-P28f-1, §5.2a): Option ×5 ardışık (Fare Tuşları), ⌘F5
//     (VoiceOver) ve ⌘⌥F5 (Erişilebilirlik kısayolları) — "⌘ basılı" = bu alıcının durumu VEYA sistemin durumu
//     (yerel kullanıcının basılı tuttuğu ⌘ + uzaktan F5 de düşer; S-P17-7 kalıbı). fn tuşu tabloda yok (fn ×3 üretilemez).
//     AC-48 eşdeğeri: ⌃⌘Q (ekranı kilitle; Windows'ta Win+L) iletilmez.

// CGEventType değerleri (CGEventTypes.h).
const (
	cgLeftMouseDown     uint32 = 1
	cgLeftMouseUp       uint32 = 2
	cgRightMouseDown    uint32 = 3
	cgRightMouseUp      uint32 = 4
	cgMouseMoved        uint32 = 5
	cgLeftMouseDragged  uint32 = 6
	cgRightMouseDragged uint32 = 7
	cgKeyDown           uint32 = 10
	cgKeyUp             uint32 = 11
	cgFlagsChanged      uint32 = 12
	cgScrollWheel       uint32 = 22
	cgOtherMouseDown    uint32 = 25
	cgOtherMouseUp      uint32 = 26
	cgOtherMouseDragged uint32 = 27
)

// CGMouseButton.
const (
	cgButtonLeft   uint32 = 0
	cgButtonRight  uint32 = 1
	cgButtonCenter uint32 = 2
)

const (
	// unicodeChunk FFI kuralı 3: CGEventKeyboardSetUnicodeString ≤ 20 UTF-16 birim.
	unicodeChunk = 20
	// optionRunMax Fare Tuşları kısayolu "Option'a 5 kez bas": ardışık 5. Option basması (ve sonrası) düşer.
	optionRunMax = 5
	// doubleClickGap / doubleClickSlop macOS varsayılan çift tık aralığı (NSEvent.doubleClickInterval = 0,5 sn) ve
	// konum toleransı (nokta).
	doubleClickGap  = 500 * time.Millisecond
	doubleClickSlop = 4.0
	// wheelPixelNum/Den Windows WHEEL_DELTA (çentik = 120; konsol ×1,2 ölçekler) → piksel: ×5/6 ≈ tarayıcının
	// piksel deltası.
	wheelPixelNum = 5
	wheelPixelDen = 6
)

// macEvent tek CGEvent tarifi.
type macEvent struct {
	typ    uint32
	x, y   float64 // fare: genel nokta koordinatı (birincil ekranın sol üstü 0,0)
	here   bool    // fare: konum bilinmiyor → imlecin bulunduğu yer (imleç taşınmaz)
	button uint32
	click  int64 // kCGMouseEventClickState
	vk     uint16
	down   bool
	flags  uint64
	text   []uint16 // Unicode klavye olayı (vk 0)
	wheelY int32    // piksel; + yukarı (Windows ile aynı yön)
	wheelX int32    // piksel; + sola (CGEvent wheel2)
}

// macTranslator durumlu çevirici. Kilitleme çağıranın işidir (CGInjector.mu).
type macTranslator struct {
	virt    Rect
	now     func() time.Time
	osFlags func() uint64 // sistemin gördüğü değiştiriciler (yerel + enjekte); nil → 0

	mods    map[uint16]bool // bu çeviricinin bastığı değiştiriciler (kVK)
	dropped map[uint16]bool // basması düşürülen tuş: bırakması da düşer
	held    map[uint16]bool // enjekte edilmiş, bırakılmamış değiştirici olmayan tuşlar
	buttons map[uint32]bool
	x, y    float64
	hasPos  bool
	optRun  int
	last    struct {
		button uint32
		at     time.Time
		x, y   float64
		count  int64
	}
}

func newMacTranslator(now func() time.Time, osFlags func() uint64) *macTranslator {
	if now == nil {
		now = time.Now
	}
	return &macTranslator{now: now, osFlags: osFlags, mods: map[uint16]bool{}, dropped: map[uint16]bool{},
		held: map[uint16]bool{}, buttons: map[uint32]bool{}}
}

// flags bu çeviricinin basılı tuttuğu değiştiricilerin bayrakları.
func (t *macTranslator) flags() uint64 {
	var f uint64
	for k := range t.mods {
		f |= modFlag(k)
	}
	return f
}

// translate Applier'ın tek Inject çağrısındaki olayları CGEvent tariflerine çevirir.
func (t *macTranslator) translate(evs []Event) []macEvent {
	var out []macEvent
	for i := 0; i < len(evs); i++ {
		e := evs[i]
		switch {
		case e.Mouse:
			out = t.mouse(e, out)
		case e.Flags&KeyUnicode != 0:
			up := e.Flags&KeyUp != 0
			units := []uint16{e.Scan}
			for i+1 < len(evs) && !evs[i+1].Mouse && evs[i+1].Flags&KeyUnicode != 0 && (evs[i+1].Flags&KeyUp != 0) == up {
				i++
				units = append(units, evs[i].Scan)
			}
			if !up {
				t.optRun = 0
			}
			out = appendText(out, units, !up)
		default:
			out = t.key(e, out)
		}
	}
	return out
}

func appendText(out []macEvent, units []uint16, down bool) []macEvent {
	typ := cgKeyUp
	if down {
		typ = cgKeyDown
	}
	for len(units) > 0 {
		n := min(len(units), unicodeChunk)
		// Vekil çifti parçalanmasın (yüksek vekil parçanın sonunda kalırsa bir sonraki parçaya bırakılır).
		if n < len(units) && units[n-1] >= 0xD800 && units[n-1] < 0xDC00 {
			n--
		}
		out = append(out, macEvent{typ: typ, down: down, text: append([]uint16(nil), units[:n]...)})
		units = units[n:]
	}
	return out
}

// key fiziksel tuş (VK) olayı.
func (t *macTranslator) key(e Event, out []macEvent) []macEvent {
	kvk, ok := macVK[vkInfo{vk: e.VK, ext: e.Flags&KeyExtended != 0}]
	if !ok {
		return out
	}
	down := e.Flags&KeyUp == 0
	mod := modFlag(kvk) != 0
	if !down {
		if t.dropped[kvk] {
			delete(t.dropped, kvk)
			return out
		}
		delete(t.held, kvk)
		typ := cgKeyUp
		if mod {
			if !t.mods[kvk] {
				return out
			}
			delete(t.mods, kvk)
			typ = cgFlagsChanged
		}
		return append(out, macEvent{typ: typ, vk: kvk, flags: t.flags()})
	}
	if mod && t.mods[kvk] {
		return out // değiştiricinin otomatik tekrarı: macOS'ta karşılığı yok, sayılmaz
	}
	if t.blocked(kvk) {
		if !t.held[kvk] { // zaten enjekte edilmiş tuşun tekrarı düşer ama bırakması enjekte edilmeli
			t.dropped[kvk] = true
		}
		return out
	}
	if kvk == kvkOption || kvk == kvkRightOption {
		t.optRun++
	} else {
		t.optRun = 0
	}
	if mod {
		t.mods[kvk] = true
		return append(out, macEvent{typ: cgFlagsChanged, vk: kvk, down: true, flags: t.flags()})
	}
	t.held[kvk] = true
	return append(out, macEvent{typ: cgKeyDown, vk: kvk, down: true, flags: t.flags()})
}

// blocked S-P28f-1 / AC-48: enjekte edilmeyecek basma.
func (t *macTranslator) blocked(kvk uint16) bool {
	f := t.flags()
	if t.osFlags != nil {
		f |= t.osFlags()
	}
	switch {
	case (kvk == kvkOption || kvk == kvkRightOption) && t.optRun+1 >= optionRunMax:
		return true // Fare Tuşları kısayolu
	case kvk == kvkF5 && f&flagCommand != 0:
		return true // ⌘F5 VoiceOver, ⌘⌥F5 Erişilebilirlik kısayolları
	case kvk == kvkANSIQ && f&flagCommand != 0 && f&flagControl != 0:
		return true // ⌃⌘Q ekranı kilitle
	}
	return false
}

// point Applier'ın mutlak (0..65535) koordinatını genel nokta koordinatına çevirir (Applier.move'un tersi).
func (t *macTranslator) point(dx, dy int32) (float64, float64) {
	w := float64(max(1, t.virt.Right-t.virt.Left-1))
	h := float64(max(1, t.virt.Bottom-t.virt.Top-1))
	return float64(t.virt.Left) + float64(dx)*w/65535, float64(t.virt.Top) + float64(dy)*h/65535
}

func (t *macTranslator) mouse(e Event, out []macEvent) []macEvent {
	if e.Flags&MouseMove != 0 {
		t.x, t.y = t.point(e.DX, e.DY)
		t.hasPos = true
		out = append(out, macEvent{typ: t.moveType(), x: t.x, y: t.y, button: t.dragButton(), flags: t.flags()})
	}
	for _, b := range []struct {
		down, up uint32
		btn      uint32
	}{{MouseLeftDown, MouseLeftUp, cgButtonLeft}, {MouseRightDown, MouseRightUp, cgButtonRight},
		{MouseMiddleDown, MouseMiddleUp, cgButtonCenter}} {
		switch {
		case e.Flags&b.down != 0:
			t.optRun = 0
			t.buttons[b.btn] = true
			out = append(out, macEvent{typ: buttonType(b.btn, true), x: t.x, y: t.y, here: !t.hasPos, button: b.btn,
				click: t.clickCount(b.btn), flags: t.flags()})
		case e.Flags&b.up != 0:
			delete(t.buttons, b.btn)
			click := int64(1)
			if t.last.button == b.btn && t.last.count > 0 {
				click = t.last.count
			}
			out = append(out, macEvent{typ: buttonType(b.btn, false), x: t.x, y: t.y, here: !t.hasPos, button: b.btn,
				click: click, flags: t.flags()})
		}
	}
	if e.Flags&MouseWheel != 0 && e.Data != 0 {
		out = append(out, macEvent{typ: cgScrollWheel, wheelY: wheelPixels(e.Data), flags: t.flags()})
	}
	if e.Flags&MouseHWheel != 0 && e.Data != 0 {
		out = append(out, macEvent{typ: cgScrollWheel, wheelX: -wheelPixels(e.Data), flags: t.flags()})
	}
	return out
}

func wheelPixels(d int32) int32 {
	v := int32(math.Round(float64(d) * wheelPixelNum / wheelPixelDen))
	if v == 0 { // küçük delta da en az 1 piksel kaydırsın
		if d > 0 {
			return 1
		}
		return -1
	}
	return v
}

// moveType basılı düğmeye göre hareket türü (sol > sağ > orta önceliği).
func (t *macTranslator) moveType() uint32 {
	switch {
	case t.buttons[cgButtonLeft]:
		return cgLeftMouseDragged
	case t.buttons[cgButtonRight]:
		return cgRightMouseDragged
	case t.buttons[cgButtonCenter]:
		return cgOtherMouseDragged
	}
	return cgMouseMoved
}

func (t *macTranslator) dragButton() uint32 {
	switch {
	case t.buttons[cgButtonLeft]:
		return cgButtonLeft
	case t.buttons[cgButtonRight]:
		return cgButtonRight
	case t.buttons[cgButtonCenter]:
		return cgButtonCenter
	}
	return cgButtonLeft
}

func buttonType(btn uint32, down bool) uint32 {
	switch btn {
	case cgButtonLeft:
		return map[bool]uint32{true: cgLeftMouseDown, false: cgLeftMouseUp}[down]
	case cgButtonRight:
		return map[bool]uint32{true: cgRightMouseDown, false: cgRightMouseUp}[down]
	}
	return map[bool]uint32{true: cgOtherMouseDown, false: cgOtherMouseUp}[down]
}

// clickCount çift/üçlü tık: aynı düğme, ≤ 0,5 sn, ≤ 4 nokta → sayaç artar.
func (t *macTranslator) clickCount(btn uint32) int64 {
	now := t.now()
	l := &t.last
	if l.count > 0 && l.button == btn && now.Sub(l.at) <= doubleClickGap &&
		math.Abs(t.x-l.x) <= doubleClickSlop && math.Abs(t.y-l.y) <= doubleClickSlop {
		l.count++
	} else {
		l.count = 1
	}
	l.button, l.at, l.x, l.y = btn, now, t.x, t.y
	return l.count
}
