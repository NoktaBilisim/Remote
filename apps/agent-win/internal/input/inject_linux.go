//go:build linux

package input

import (
	"sync"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

// P28g K3 (mimari-p28g §2 `input/*_linux`, §5.2b m.3, §13 S-P28g-3 m.4): Applier'ın platformdan bağımsız olaylarını
// ([]Event; SendInput biçimi) Linux işlemlerine çeviren saf katman ve Wayland değiştirici bütçesi. XTest (X11) ve portal
// Notify* (Wayland) aynı Applier'dan geçer; yalnız son "sink" farklıdır.
//
//   - Koordinat: Applier noktayı monitör dikdörtgenine (fiziksel piksel) ve oradan sanal masaüstüne göre 0..65535'e
//     çevirir; burada aynı sanal dikdörtgenle piksele geri çevrilir. X11'de sanal = kök pencere (tüm monitörler);
//     Wayland'de sanal = monitör = portal akışı (koordinat akışa görelidir).
//   - Tuşlar: kısayol/denetim tuşları evdev koduyla (X11'de +8); metin karakterleri (Applier Unicode yolu) keysym ile
//     gider (müşterinin düzeninde karşılığı aranır; Türkçe harfler eski keysym'leriyle, keys_linux.go).
//   - Tekerlek: WHEEL_DELTA (120) birikimiyle çentik; + aşağı / sağ.

type opKind uint8

const (
	opMove opKind = iota
	opButton
	opWheel
	opKey
	opSym
)

// Düğmeler (X11 çekirdek düğme numarası; portal tarafı evdev BTN_* koduna çevirir).
const (
	btnLeft   = 1
	btnMiddle = 2
	btnRight  = 3
)

// linOp tek Linux girdi işlemi.
type linOp struct {
	kind   opKind
	x, y   float64 // opMove: piksel (X11 kök / Wayland akış)
	button uint8   // opButton
	down   bool    // opButton, opKey, opSym
	code   uint16  // opKey: evdev
	sym    uint32  // opSym: X keysym
	axis   uint8   // opWheel: 0 dikey, 1 yatay
	steps  int32   // opWheel: + aşağı / sağ
}

const wheelDelta = 120

// linTranslator durumlu çevirici (tekerlek birikimi); kilitleme çağıranın işidir.
type linTranslator struct {
	virt       Rect
	accV, accH int32
}

func (t *linTranslator) translate(evs []Event) []linOp {
	var out []linOp
	for i := 0; i < len(evs); i++ {
		e := evs[i]
		switch {
		case e.Mouse:
			out = t.mouse(e, out)
		case e.Flags&KeyUnicode != 0:
			up := e.Flags&KeyUp != 0
			units := []uint16{e.Scan}
			if utf16.IsSurrogate(rune(e.Scan)) && i+1 < len(evs) && !evs[i+1].Mouse && evs[i+1].Flags&KeyUnicode != 0 {
				i++
				units = append(units, evs[i].Scan)
			}
			for _, r := range utf16.Decode(units) {
				if r != utf8.RuneError {
					out = append(out, linOp{kind: opSym, sym: keysymOf(r), down: !up})
				}
			}
		default:
			if code, ok := linuxKey[vkInfo{vk: e.VK, ext: e.Flags&KeyExtended != 0}]; ok {
				out = append(out, linOp{kind: opKey, code: code, down: e.Flags&KeyUp == 0})
			}
		}
	}
	return out
}

func (t *linTranslator) mouse(e Event, out []linOp) []linOp {
	if e.Flags&MouseMove != 0 && e.Flags&MouseAbsolute != 0 {
		w, h := float64(max(1, t.virt.Right-t.virt.Left-1)), float64(max(1, t.virt.Bottom-t.virt.Top-1))
		out = append(out, linOp{kind: opMove, x: float64(t.virt.Left) + float64(e.DX)*w/65535,
			y: float64(t.virt.Top) + float64(e.DY)*h/65535})
	}
	for _, b := range []struct {
		flag uint32
		btn  uint8
		down bool
	}{{MouseLeftDown, btnLeft, true}, {MouseLeftUp, btnLeft, false}, {MouseRightDown, btnRight, true},
		{MouseRightUp, btnRight, false}, {MouseMiddleDown, btnMiddle, true}, {MouseMiddleUp, btnMiddle, false}} {
		if e.Flags&b.flag != 0 {
			out = append(out, linOp{kind: opButton, button: b.btn, down: b.down})
		}
	}
	if e.Flags&MouseWheel != 0 {
		t.accV += e.Data
		if n := t.accV / wheelDelta; n != 0 {
			t.accV -= n * wheelDelta
			out = append(out, linOp{kind: opWheel, axis: 0, steps: -n}) // Windows + yukarı → + aşağı
		}
	}
	if e.Flags&MouseHWheel != 0 {
		t.accH += e.Data
		if n := t.accH / wheelDelta; n != 0 {
			t.accH -= n * wheelDelta
			out = append(out, linOp{kind: opWheel, axis: 1, steps: n})
		}
	}
	return out
}

// Değiştirici bütçesi (mimari-p28g §5.2b m.3, r3 Y-P28g-T2-1): kayan 3 sn'lik pencerede "herhangi bir değiştirici
// basılı" toplam süresi en çok 2 sn. Bütçe dolunca basılı değiştiriciler bırakılır ve 1 sn soğuma başlar: bu sürede
// değiştirici basışı düşer, bırakma geçer. Kısa aralıklı yeniden basma bütçeyi sıfırlamaz. budgetMargin zamanlayıcı
// gecikmesine pay bırakır (her pencerede değiştiricisiz süre ≥ 1 sn kalsın).
const (
	budgetWindow = 3 * time.Second
	budgetLimit  = 2*time.Second - budgetMargin
	budgetMargin = 5 * time.Millisecond
	budgetCool   = time.Second
)

type span struct{ from, to time.Time }

type modBudget struct {
	held  map[uint16]bool
	spans []span    // kapanmış "değiştirici basılı" aralıkları
	open  time.Time // açık aralığın başı (sıfır = basılı değiştirici yok)
	cool  time.Time // soğuma bitişi
}

func newModBudget() *modBudget { return &modBudget{held: map[uint16]bool{}} }

// used now'dan önceki budgetWindow içindeki basılı süre.
func (b *modBudget) used(now time.Time) time.Duration {
	from := now.Add(-budgetWindow)
	var d time.Duration
	keep := b.spans[:0]
	for _, s := range b.spans {
		if !s.to.After(from) {
			continue
		}
		keep = append(keep, s)
		d += s.to.Sub(maxTime(s.from, from))
	}
	b.spans = keep
	if !b.open.IsZero() {
		d += now.Sub(maxTime(b.open, from))
	}
	return d
}

func maxTime(a, c time.Time) time.Time {
	if a.After(c) {
		return a
	}
	return c
}

// filter tuş işlemini bütçeye göre geçirir (true) ya da düşürür. Değiştirici olmayanlar her zaman geçer.
func (b *modBudget) filter(op linOp, now time.Time) bool {
	if op.kind != opKey || !modifierKey(op.code) {
		return true
	}
	if op.down {
		if now.Before(b.cool) {
			return false
		}
		if b.used(now) >= budgetLimit {
			b.cool = now.Add(budgetCool)
			return false
		}
		if len(b.held) == 0 {
			b.open = now
		}
		b.held[op.code] = true
		return true
	}
	if !b.held[op.code] {
		return false // bu enjektörün basılı tutmadığı değiştiricinin bırakılması (bütçe zaten bıraktı)
	}
	delete(b.held, op.code)
	if len(b.held) == 0 {
		b.spans = append(b.spans, span{b.open, now})
		b.open = time.Time{}
		if b.used(now) >= budgetLimit {
			b.cool = now.Add(budgetCool)
		}
	}
	return true
}

// expire bütçe dolduysa basılı değiştiricilerin bırakma işlemlerini döner ve soğumayı başlatır.
func (b *modBudget) expire(now time.Time) []linOp {
	if len(b.held) == 0 || b.used(now) < budgetLimit {
		return nil
	}
	var out []linOp
	for code := range b.held {
		out = append(out, linOp{kind: opKey, code: code})
	}
	clear(b.held)
	b.spans = append(b.spans, span{b.open, now})
	b.open = time.Time{}
	b.cool = now.Add(budgetCool)
	return out
}

// deadline basılı değiştirici varsa bütçenin dolacağı en erken an (sıfır = yok). Pencereden düşen eski aralıklar
// bütçeyi geri verebileceğinden gerçek dolma daha geç olabilir; zamanlayıcı yeniden hesaplar.
func (b *modBudget) deadline(now time.Time) time.Time {
	if len(b.held) == 0 {
		return time.Time{}
	}
	return now.Add(max(time.Millisecond, budgetLimit-b.used(now)))
}

// linSink çevrilmiş işlemleri sisteme verir (X11 XTest ya da Wayland portalı).
type linSink interface {
	apply(ops []linOp) error
}

// LinuxInjector input.Injector (Applier → Linux). Wayland'de değiştirici bütçesi uygulanır; zamanlayıcı yalnız
// enjektörün kilidini alır (Applier kilidine dokunmaz → kilit sırası tek yönlü).
type LinuxInjector struct {
	mu     sync.Mutex
	tr     linTranslator
	sink   linSink
	budget *modBudget
	now    func() time.Time
	timer  *time.Timer
}

func newLinuxInjector(sink linSink, budget bool) *LinuxInjector {
	i := &LinuxInjector{sink: sink, now: time.Now}
	if budget {
		i.budget = newModBudget()
	}
	return i
}

// SetVirtual koordinat çevirisinin sanal dikdörtgeni (X11: kök; Wayland: akış).
func (i *LinuxInjector) SetVirtual(r Rect) {
	i.mu.Lock()
	i.tr.virt = r
	i.mu.Unlock()
}

// Inject input.Injector.
func (i *LinuxInjector) Inject(evs []Event) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	ops := i.tr.translate(evs)
	if i.budget != nil {
		now := i.now()
		kept := i.budget.expire(now)
		for _, op := range ops {
			if i.budget.filter(op, now) {
				kept = append(kept, op)
			}
		}
		ops = kept
		i.scheduleLocked(now)
	}
	if len(ops) == 0 {
		return nil
	}
	return i.sink.apply(ops)
}

// scheduleLocked bütçe dolma anına zamanlayıcı kurar. i.mu altında.
func (i *LinuxInjector) scheduleLocked(now time.Time) {
	d := i.budget.deadline(now)
	if i.timer != nil {
		i.timer.Stop()
		i.timer = nil
	}
	if d.IsZero() {
		return
	}
	i.timer = time.AfterFunc(d.Sub(now), i.onTimer)
}

func (i *LinuxInjector) onTimer() {
	i.mu.Lock()
	defer i.mu.Unlock()
	now := i.now()
	if rel := i.budget.expire(now); len(rel) > 0 {
		_ = i.sink.apply(rel)
	}
	i.scheduleLocked(now)
}
