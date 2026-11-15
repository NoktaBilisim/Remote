package input

import (
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf16"

	"remote-support/agent-win/internal/control"
)

// SendInput bayrakları (winuser.h).
const (
	MouseMove        = 0x0001
	MouseLeftDown    = 0x0002
	MouseLeftUp      = 0x0004
	MouseRightDown   = 0x0008
	MouseRightUp     = 0x0010
	MouseMiddleDown  = 0x0020
	MouseMiddleUp    = 0x0040
	MouseWheel       = 0x0800
	MouseHWheel      = 0x1000
	MouseVirtualDesk = 0x4000
	MouseAbsolute    = 0x8000
	KeyExtended      = 0x0001
	KeyUp            = 0x0002
	KeyUnicode       = 0x0004
)

// Event tek SendInput INPUT kaydı (fare veya klavye).
type Event struct {
	Mouse bool
	DX    int32  // fare: mutlak 0..65535
	DY    int32  //
	Data  int32  // fare: tekerlek miktarı
	VK    uint16 // klavye: sanal tuş (Unicode'da 0)
	Scan  uint16 // klavye: Unicode'da UTF-16 birimi
	Flags uint32
}

// Injector olayları işletim sistemine verir (Windows: SendInput; testte sahte).
type Injector interface {
	Inject(evs []Event) error
}

// Rect fiziksel masaüstü koordinatları (sağ/alt hariç).
type Rect = control.Rect

type heldKey struct {
	vk  vkInfo
	uni []uint16 // doluysa tuş Unicode olarak basıldı
}

// S7-8 hız sınırı: konsol fare hareketini 16 ms'de bir (~62/sn) gönderir; klavye tekrarı ~30/sn. 250/sn sürekli,
// 500 ani patlama normal kullanımın ~4 katıdır. Aşan basma/hareket/tekerlek düşer ve sayılır; yalnız basılı tuş/düğmenin
// bırakılması (k/m.btn down=false) ve k.release_all takılı tuş kalmasın diye sınıra takılmaz (S7-13).
const (
	RatePerSec = 250
	RateBurst  = 500
)

// Applier input kanalının alıcısı. Handle her mesajda kapıyı enjeksiyondan hemen önce, kilit altında denetler;
// Close (gate.OnClose → ReleaseAll) aynı kilidi aldığından kapanıştan sonra hiçbir basma olayı uygulanmaz (AC-101).
//
// Kilit sırası (S7-3): a.mu tutulurken Inject (SendInput) çağrılır; SendInput, LL kancası kurulu iş parçacığının
// (input.Host) kancayı işlemesini bekler. Bu yüzden Host iş parçacığı a.mu'yu ASLA almaz: kancalar yalnız atomik
// yazar, kısayol gate.Shut ile kapatır (ReleaseAll ayrı goroutine'de). Kilit yalnız Pion, UI ve akış
// goroutine'lerinde alınır; hiçbiri SendInput'un beklediği kancayı çalıştırmaz.
type Applier struct {
	gate *control.Gate
	inj  Injector
	now  func() time.Time

	limited      atomic.Uint64
	scopeDropped atomic.Uint64

	mu      sync.Mutex
	tokens  float64
	last    time.Time
	mon     Rect
	virt    Rect
	hasMon  bool
	keys    map[string]heldKey
	buttons map[string]bool
	// AC-248 / S17-1 pencere modu (scope.go); scope.on false ise monitör modu.
	scope       winScope
	scopeMeta   map[string]bool // S-P17-1: pencere modunda düşürülen, uzakta hâlâ basılı Win tuşları
	scopeLatch  bool            // S-P17-1: kabuk kısayolu görüldü; Win/Alt/Ctrl bırakılana dek basmalar düşer
	keyTokens   float64         // S-P17-1: pencere modu tuş basma kovası
	keyLast     time.Time
	dropLog     func(reason string)
	dropAt      time.Time
	pendingDrop string
	cur         time.Time // işlenen mesajın zamanı (handleLocked)
}

// NewApplier kapıya bağlı alıcı; kapı kapanınca basılı kalan tuş/düğmeler bırakılır.
func NewApplier(g *control.Gate, inj Injector, now func() time.Time) *Applier {
	if now == nil {
		now = time.Now
	}
	a := &Applier{gate: g, inj: inj, now: now, keys: map[string]heldKey{}, buttons: map[string]bool{},
		scopeMeta: map[string]bool{}}
	g.OnClose(a.ReleaseAll)
	return a
}

// SetTarget AC-49: normalize koordinatların eşleneceği monitör ve sanal masaüstü (tüm monitörler) dikdörtgeni.
func (a *Applier) SetTarget(mon, virt Rect) {
	a.mu.Lock()
	a.mon, a.virt, a.hasMon = mon, virt, mon.Right > mon.Left && virt.Right > virt.Left
	a.scope = winScope{}
	a.resetShellLocked()
	a.mu.Unlock()
}

// Handle tek input mesajı: kapı ön denetimi → doğrula → hız sınırı → kapı (kilit altında) → çevir → enjekte.
// Kapalı/askıdaysa düşer ve sayılır. Kapı kapalıyken ayrıştırma bile yapılmaz (S7-8); kapanışta ReleaseAll zaten
// her şeyi bıraktığından kapalı kapıda k.release_all'ın da yapacağı iş yoktur.
func (a *Applier) Handle(raw []byte) {
	if !a.gate.IsOpen() {
		a.gate.Drop()
		return
	}
	m, err := Parse(raw)
	if err != nil {
		return
	}
	if log, reason := a.handleLocked(m); reason != "" {
		log(reason) // tanılama yazımı kilit dışında (S7-3: kilit yalnız enjeksiyonu korur)
	}
}

// handleLocked Handle'ın kilitli kısmı; pencere kapsamı düşmesi için tanılama zamanı geldiyse yazıcı ve neden döner.
func (a *Applier) handleLocked(m Msg) (func(string), string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if m.T == "k.release_all" {
		a.releaseLocked()
		return nil, ""
	}
	now := a.now()
	a.cur = now
	if !a.heldReleaseLocked(m) && !a.takeLocked(now) {
		a.limited.Add(1)
		return nil, ""
	}
	if !a.gate.Allow(now) {
		a.gate.Drop()
		return nil, ""
	}
	var evs []Event
	if a.scope.on {
		evs = a.translateScoped(m)
	} else {
		evs = a.translate(m)
	}
	if len(evs) > 0 {
		_ = a.inj.Inject(evs)
	}
	reason := a.pendingDrop
	a.pendingDrop = ""
	return a.dropLog, reason
}

// Limited hız sınırı nedeniyle düşen mesaj sayısı (S7-8; tanı ve test).
func (a *Applier) Limited() uint64 { return a.limited.Load() }

// heldReleaseLocked S7-13: yalnız bu alıcının gerçekten basılı tuttuğu tuş/düğmenin bırakılması hız sınırından muaftır
// (takılı tuş kalmasın). Basılı olmayanın "bırakılması" jeton harcar; translate onu zaten enjekte etmez. a.mu altında.
func (a *Applier) heldReleaseLocked(m Msg) bool {
	if m.Down == nil || *m.Down {
		return false
	}
	switch m.T {
	case "k":
		_, held := a.keys[m.Code]
		return held
	case "m.btn":
		return a.buttons[m.B]
	}
	return false
}

// takeLocked jeton kovası; a.mu altında.
func (a *Applier) takeLocked(now time.Time) bool {
	if a.last.IsZero() {
		a.tokens, a.last = RateBurst, now
	}
	if el := now.Sub(a.last).Seconds(); el > 0 {
		a.tokens = min(RateBurst, a.tokens+el*RatePerSec)
		a.last = now
	}
	if a.tokens < 1 {
		return false
	}
	a.tokens--
	return true
}

// ReleaseAll yalnız bu alıcının bastığı tuş/düğmeleri bırakır (odak kaybı, kapı kapanışı). Basma olayı üretmez.
func (a *Applier) ReleaseAll() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.releaseLocked()
}

func (a *Applier) releaseLocked() {
	var evs []Event
	for b := range a.buttons {
		evs = append(evs, Event{Mouse: true, Flags: buttonFlag(b, false)})
	}
	for _, k := range a.keys {
		evs = append(evs, keyEvents(k, false)...)
	}
	clear(a.buttons)
	clear(a.keys)
	a.resetShellLocked()
	if len(evs) > 0 {
		_ = a.inj.Inject(evs)
	}
}

func (a *Applier) translate(m Msg) []Event {
	switch m.T {
	case "m.move":
		if mv, ok := a.move(*m.X, *m.Y); ok {
			return []Event{mv}
		}
	case "m.btn":
		mv, ok := a.move(*m.X, *m.Y)
		if !ok {
			return nil
		}
		if *m.Down {
			a.buttons[m.B] = true
		} else {
			if !a.buttons[m.B] {
				return nil // S7-13: basılı olmayan düğmeyi bırakma no-op (eşleşmeyen UP ve hareket enjekte edilmez)
			}
			delete(a.buttons, m.B)
		}
		return []Event{mv, {Mouse: true, Flags: buttonFlag(m.B, *m.Down)}}
	case "m.wheel":
		var evs []Event
		if *m.DY != 0 { // tarayıcıda +dy aşağı, Windows'ta +WHEEL yukarı
			evs = append(evs, Event{Mouse: true, Data: int32(-*m.DY), Flags: MouseWheel})
		}
		if *m.DX != 0 {
			evs = append(evs, Event{Mouse: true, Data: int32(*m.DX), Flags: MouseHWheel})
		}
		return evs
	case "k":
		return a.key(m)
	}
	return nil
}

// move normalize (0..1) → aktif monitör pikseli → sanal masaüstü mutlak (0..65535) koordinatı.
func (a *Applier) move(x, y float64) (Event, bool) {
	if !a.hasMon {
		return Event{}, false
	}
	px := float64(a.mon.Left) + x*float64(a.mon.Right-a.mon.Left-1)
	py := float64(a.mon.Top) + y*float64(a.mon.Bottom-a.mon.Top-1)
	ax := (px - float64(a.virt.Left)) * 65535 / float64(max(1, a.virt.Right-a.virt.Left-1))
	ay := (py - float64(a.virt.Top)) * 65535 / float64(max(1, a.virt.Bottom-a.virt.Top-1))
	return Event{Mouse: true, DX: int32(ax + 0.5), DY: int32(ay + 0.5),
		Flags: MouseMove | MouseAbsolute | MouseVirtualDesk}, true
}

func buttonFlag(b string, down bool) uint32 {
	f := map[string][2]uint32{"l": {MouseLeftDown, MouseLeftUp}, "r": {MouseRightDown, MouseRightUp},
		"m": {MouseMiddleDown, MouseMiddleUp}}[b]
	if down {
		return f[0]
	}
	return f[1]
}

func (a *Applier) modHeld(names ...string) bool {
	for _, n := range names {
		if _, ok := a.keys[n]; ok {
			return true
		}
	}
	return false
}

// blocked AC-48: Ctrl+Alt+Del ve Win+L iletilmez (Ctrl+Alt+Del zaten SendInput ile üretilemez; Win+L kilitler).
func (a *Applier) blocked(code string) bool {
	ctrl := a.modHeld("ControlLeft", "ControlRight")
	alt := a.modHeld("AltLeft", "AltRight")
	win := a.modHeld("MetaLeft", "MetaRight")
	return (code == "Delete" || code == "NumpadDecimal") && ctrl && alt || code == "KeyL" && win
}

func (a *Applier) key(m Msg) []Event {
	vk, ok := codeVK[m.Code]
	if !ok {
		return nil
	}
	if !*m.Down {
		k, held := a.keys[m.Code]
		if !held {
			return nil
		}
		delete(a.keys, m.Code)
		return keyEvents(k, false)
	}
	if a.blocked(m.Code) {
		return nil
	}
	k := heldKey{vk: vk}
	if prev, held := a.keys[m.Code]; held {
		k = prev // otomatik tekrar: aynı yöntemle yeniden bas
	} else if uni := unicodeOf(m); uni != nil && charKey(m.Code) && !a.modHeld(shortcutMods...) {
		k.uni = uni
	}
	a.keys[m.Code] = k
	return keyEvents(k, true)
}

// unicodeOf `key` tek yazdırılabilir karakterse UTF-16 birimleri.
func unicodeOf(m Msg) []uint16 {
	if m.Key == nil {
		return nil
	}
	r := []rune(*m.Key)
	if len(r) != 1 || !unicode.IsPrint(r[0]) || r[0] == ' ' {
		return nil
	}
	return utf16.Encode(r)
}

func keyEvents(k heldKey, down bool) []Event {
	var up uint32
	if !down {
		up = KeyUp
	}
	if k.uni != nil {
		evs := make([]Event, 0, len(k.uni))
		for _, u := range k.uni {
			evs = append(evs, Event{Scan: u, Flags: KeyUnicode | up})
		}
		return evs
	}
	f := up
	if k.vk.ext {
		f |= KeyExtended
	}
	return []Event{{VK: k.vk.vk, Flags: f}}
}
