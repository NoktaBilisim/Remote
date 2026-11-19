//go:build linux

package input

import (
	"errors"
	"runtime"
	"slices"
	"strings"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/linux/x11"
)

// P28g K3 X11 yolu (mimari-p28g §5.2 X11 sütunu, §5.4, §13 S-P28g-13, §14 m.1):
//
//   - XTest enjektörü kendi Display'inde, kilitli kendi iş parçacığında çalışır; Applier işlemleri kanalla ve sınırlı
//     beklemeyle verilir. Tuş = evdev + 8; metin karakteri keysym → XKeysymToKeycode + düzey (Shift / ISO_Level3);
//     müşterinin düzeninde karşılığı yoksa düşer. Her partiden sonra XFlush.
//   - XI2 izleyici (AC-104) ayrı Display + ayrı kilitli iş parçacığında engelleyen XNextEvent ile ham olayları (13–17)
//     ve aygıt hiyerarşisini (11) okur. Kaynak aygıt XTEST alt aygıt KİMLİKLERİNDEN biri değilse yerel girdi sayılır →
//     gate.Suspend (1 sn). Kimlikler hiyerarşi değişince yeniden okunur; bulunamazsa kontrol verilmez/kapanır.
//     Her XGetEventData'dan sonra XFreeEventData. Kapanış: kendi 1×1 penceresine XSendEvent ile ClientMessage, ardından
//     aynı iş parçacığında XCloseDisplay (eşzamanlı kapatma yok).
//   - Kapatma kısayolu XGrabKey Ctrl+Shift+F12 (yedek F11) Lock/NumLock varyantlarıyla GDK'nın X bağlantısında, ana
//     iş parçacığında, GDK hata tuzağı içinde; olay init'te kaydedilen GDK süzgeci ile (ana iş parçacığı).

// isXTestName XIQueryDevice adı XTEST alt aygıtı mı ("Virtual core XTEST pointer/keyboard"; XWayland aynı adı verir).
func isXTestName(name string) bool { return strings.Contains(name, "XTEST") }

// sinkWait bir partinin XTest iş parçacığına verilip işlenmesi için üst sınır (Applier kilidi bu sürede tutulur).
const sinkWait = 500 * time.Millisecond

var errSinkBusy = errors.New("input: XTest enjektörü yanıt vermedi")

type xreq struct {
	ops  []linOp
	done chan xreq
	// cursor true → işlem yerine XQueryPointer (HostProbe.Cursor); sonuç x, y, ok.
	cursor bool
	x, y   float64
	ok     bool
}

// xtestSink linSink (X11).
type xtestSink struct {
	req  chan xreq
	stop chan struct{}
}

// newXTestSink XTest iş parçacığını başlatır; Display ya da XTEST uzantısı yoksa hata (kontrol yok).
func newXTestSink() (*xtestSink, error) {
	if err := bindX(); err != nil {
		return nil, err
	}
	s := &xtestSink{req: make(chan xreq), stop: make(chan struct{})}
	ready := make(chan error, 1)
	go s.loop(ready)
	return s, <-ready
}

var errNoXTest = errors.New("input: XTEST uzantısı yok")

func (s *xtestSink) loop(ready chan<- error) {
	runtime.LockOSThread()
	d := openXDisplay()
	if d == 0 {
		ready <- errDisplay
		return
	}
	defer xl.closeDisplay(d)
	var ev, er, maj, minor int32
	if xl.xtQueryExtension(d, &ev, &er, &maj, &minor) == 0 {
		ready <- errNoXTest
		return
	}
	kb := &xkbState{d: d, shift: xl.keysymToKeycode(d, xkShiftL), level3: xl.keysymToKeycode(d, xkISOLevel3Shift),
		held: map[uint8]bool{}}
	root := xl.defaultRoot(d)
	ready <- nil
	for {
		select {
		case <-s.stop:
			return
		case r := <-s.req:
			if r.cursor {
				var rw, cw uint64
				var rx, ry, wx, wy int32
				var mask uint32
				r.ok = xl.queryPointer(d, root, &rw, &cw, &rx, &ry, &wx, &wy, &mask) != 0
				r.x, r.y = float64(rx), float64(ry)
				r.done <- r
				continue
			}
			for _, op := range r.ops {
				kb.apply(op)
			}
			xl.flush(d)
			r.done <- r
		}
	}
}

var errDisplay = errors.New("input: X görüntüsü açılamadı")

// apply linSink: parti iş parçacığına sinkWait içinde verilir ve işlenmesi beklenir.
func (s *xtestSink) apply(ops []linOp) error {
	_, err := s.do(xreq{ops: slices.Clone(ops)})
	return err
}

// cursor canlı imleç (kök koordinatı, X aygıt pikseli). Okunamazsa ok false.
func (s *xtestSink) cursor() (float64, float64, bool) {
	r, err := s.do(xreq{cursor: true})
	return r.x, r.y, err == nil && r.ok
}

// do isteği iş parçacığına sinkWait içinde verir ve sonucu bekler.
func (s *xtestSink) do(r xreq) (xreq, error) {
	r.done = make(chan xreq, 1)
	t := time.NewTimer(sinkWait)
	defer t.Stop()
	select {
	case s.req <- r:
	case <-t.C:
		return r, errSinkBusy
	case <-s.stop:
		return r, errSinkBusy
	}
	select {
	case out := <-r.done:
		return out, nil
	case <-t.C:
		return r, errSinkBusy
	}
}

// close iş parçacığını durdurur (Display aynı iş parçacığında kapanır).
func (s *xtestSink) close() { close(s.stop) }

// xkbState XTest iş parçacığının Display'i ve değiştirici tuş kodları.
type xkbState struct {
	d             uintptr
	shift, level3 uint8
	held          map[uint8]bool // teknisyenin opKey ile basılı tuttuğu tuş kodları (opSym onları bırakmaz)
}

func (k *xkbState) key(kc uint8, down bool) { xl.xtKey(k.d, uint32(kc), xbool(down), 0) }

func xbool(b bool) int32 {
	if b {
		return 1
	}
	return 0
}

func (k *xkbState) apply(op linOp) {
	switch op.kind {
	case opMove:
		xl.xtMotion(k.d, -1, int32(op.x+0.5), int32(op.y+0.5), 0)
	case opButton:
		xl.xtButton(k.d, uint32(op.button), xbool(op.down), 0)
	case opWheel:
		btn, n := wheelButton(op.axis, op.steps)
		for range min(n, 20) {
			xl.xtButton(k.d, btn, 1, 0)
			xl.xtButton(k.d, btn, 0, 0)
		}
	case opKey:
		if op.code > 0 && op.code < 248 {
			kc := uint8(op.code + 8)
			if op.down {
				k.held[kc] = true
			} else {
				delete(k.held, kc)
			}
			k.key(kc, op.down)
		}
	case opSym:
		kc := xl.keysymToKeycode(k.d, uint64(op.sym))
		if kc == 0 {
			return // müşterinin düzeninde yok: düşer
		}
		if !op.down {
			k.key(kc, false)
			return
		}
		lvl := int32(-1)
		for l := range int32(4) {
			if xl.keycodeToKeysym(k.d, kc, 0, l) == uint64(op.sym) {
				lvl = l
				break
			}
		}
		if lvl < 0 {
			return
		}
		mods := levelMods(lvl, k.shift, k.level3)
		if mods == nil {
			return // gereken değiştirici düzende yok
		}
		var pressed []uint8 // yalnız bu karakter için basılanlar (teknisyenin basılı tuttuğu değiştirici bırakılmaz)
		for _, m := range mods {
			if !k.held[m] {
				k.key(m, true)
				pressed = append(pressed, m)
			}
		}
		k.key(kc, true)
		for _, m := range slices.Backward(pressed) {
			k.key(m, false)
		}
	}
}

// levelMods XKB düzeyi için basılacak değiştiriciler (0 yok, 1 Shift, 2 AltGr, 3 AltGr+Shift). Gereken tuş kodu 0 ise
// nil (karakter yazılamaz).
func levelMods(lvl int32, shift, level3 uint8) []uint8 {
	need := []uint8{}
	if lvl&1 != 0 {
		if shift == 0 {
			return nil
		}
		need = append(need, shift)
	}
	if lvl&2 != 0 {
		if level3 == 0 {
			return nil
		}
		need = append(need, level3)
	}
	return need
}

// wheelButton çekirdek tekerlek düğmesi ve çentik sayısı (4 yukarı, 5 aşağı, 6 sol, 7 sağ).
func wheelButton(axis uint8, steps int32) (uint32, int32) {
	n := steps
	if n < 0 {
		n = -n
	}
	switch {
	case axis == 0 && steps > 0:
		return 5, n
	case axis == 0:
		return 4, n
	case steps > 0:
		return 7, n
	default:
		return 6, n
	}
}

// --- XI2 izleyici ---------------------------------------------------------------------------------------------------

// xtestIDs son okunan XTEST alt aygıt kimlikleri (localClick m.3 ve ControlReady). nil = bilinmiyor (ret).
var xtestIDs atomic.Pointer[[]int32]

// XTestIDs §5.2a m.3: XTEST alt aygıt kimlikleri (boş = bilinmiyor; korunan denetim reddeder).
func XTestIDs() []int32 {
	if p := xtestIDs.Load(); p != nil {
		return *p
	}
	return nil
}

// xi2Raw izleyicinin okuduğu XI2 olay sayısı (tanı; GUI testi izleyicinin boşta olmadığını bununla kanıtlar).
var xi2Raw atomic.Uint64

// isLocalSource XI2 olayının kaynağı XTEST dışı bir aygıt mı (bilinmeyen kimlik listesi → yerel sayılır: güvenli yön,
// yalnız uzaktan girdiyi askıya alır).
func isLocalSource(src int32, ids []int32) bool { return !slices.Contains(ids, src) }

// xi2Watcher AC-104 yerel girdi izleyicisi.
type xi2Watcher struct {
	gate   *control.Gate
	onLost func() // kimlikler kayboldu (kapı kapatılır)
	d      uintptr
	win    uint64
	closed atomic.Bool
	done   chan struct{}
}

var (
	errNoXI2   = errors.New("input: XInputExtension 2.1+ yok")
	errNoXTEST = errors.New("input: XTEST aygıt kimliği bulunamadı")
)

// startXI2 izleyiciyi başlatır; uzantı, sürüm ya da XTEST kimliği yoksa hata (kontrol verilmez).
func startXI2(g *control.Gate, onLost func()) (*xi2Watcher, error) {
	if err := bindX(); err != nil {
		return nil, err
	}
	w := &xi2Watcher{gate: g, onLost: onLost, done: make(chan struct{})}
	ready := make(chan error, 1)
	go w.loop(ready)
	if err := <-ready; err != nil {
		return nil, err
	}
	return w, nil
}

func (w *xi2Watcher) loop(ready chan<- error) {
	runtime.LockOSThread()
	defer close(w.done)
	d := openXDisplay()
	if d == 0 {
		ready <- errDisplay
		return
	}
	defer xl.closeDisplay(d)
	var op, evb, erb int32
	name := []byte("XInputExtension\x00")
	if xl.queryExtension(d, &name[0], &op, &evb, &erb) == 0 {
		ready <- errNoXI2
		return
	}
	maj, minor := int32(2), int32(2)
	if xl.xiQueryVersion(d, &maj, &minor) != 0 || maj < 2 || (maj == 2 && minor < 1) {
		ready <- errNoXI2
		return
	}
	ids := xtestDevices(d)
	if len(ids) == 0 {
		ready <- errNoXTEST
		return
	}
	xtestIDs.Store(&ids)
	root := xl.defaultRoot(d)
	w.d, w.win = d, xl.createSimpleWin(d, root, 0, 0, 1, 1, 0, 0, 0)
	selectXI2(d, root)
	xl.sync(d, 0)
	ready <- nil
	ev := make([]uint64, sizeXEvent/8)
	p := unsafe.Pointer(&ev[0])
	for {
		xl.nextEvent(d, p)
		typ := *(*int32)(unsafe.Add(p, offCookieType))
		if typ == xClientMessage && *(*uint64)(unsafe.Add(p, offClientWindow)) == w.win && w.closed.Load() {
			return
		}
		if typ != xGenericEvent || *(*int32)(unsafe.Add(p, offCookieExtension)) != op {
			continue
		}
		if xl.getEventData(d, p) == 0 {
			continue
		}
		data := *(*uintptr)(unsafe.Add(p, offCookieData))
		evtype := *(*int32)(unsafe.Add(p, offCookieEvtype))
		var src int32
		if data != 0 && evtype != xiHierarchyChanged {
			src = at[int32](data, offRawSourceid)
		}
		xl.freeEventData(d, p) // her XGetEventData'dan sonra (m.1)
		if evtype == xiHierarchyChanged {
			ids = xtestDevices(d)
			xtestIDs.Store(&ids)
			if len(ids) == 0 && w.onLost != nil {
				w.onLost()
			}
			continue
		}
		xi2Raw.Add(1)
		if evtype >= xiRawKeyPress && evtype <= xiRawMotion && isLocalSource(src, ids) {
			w.gate.Suspend(time.Now())
		}
	}
}

// selectXI2 kök pencerede ham olaylar (ana aygıtlar) + hiyerarşi (tüm aygıtlar). Maske tamponları ve yapılar C'ye
// yalnız çağrı süresince verilir (runtime.Pinner; m.3).
func selectXI2(d uintptr, root uint64) {
	raw := make([]byte, 4)
	for e := xiRawKeyPress; e <= xiRawMotion; e++ {
		raw[e>>3] |= 1 << (e & 7)
	}
	hier := make([]byte, 4)
	hier[xiHierarchyChanged>>3] |= 1 << (xiHierarchyChanged & 7)
	masks := make([]byte, 2*sizeEventMask)
	var pin runtime.Pinner
	defer pin.Unpin()
	pin.Pin(&raw[0])
	pin.Pin(&hier[0])
	pin.Pin(&masks[0])
	put := func(i int, dev int32, m []byte) {
		b := unsafe.Pointer(&masks[i*sizeEventMask])
		*(*int32)(unsafe.Add(b, offMaskDeviceid)) = dev
		*(*int32)(unsafe.Add(b, offMaskLen)) = int32(len(m))
		*(*unsafe.Pointer)(unsafe.Add(b, offMaskPtr)) = unsafe.Pointer(&m[0])
	}
	put(0, xiAllMasterDevices, raw)
	put(1, xiAllDevices, hier)
	xl.xiSelectEvents(d, root, unsafe.Pointer(&masks[0]), 2)
}

// close izleyiciyi uyandırıp durdurur; iş parçacığı Display'i kendisi kapatır. Bitişi en çok 1 sn bekler.
func (w *xi2Watcher) close() {
	if w.closed.Swap(true) {
		return
	}
	ev := make([]byte, sizeXEvent)
	p := unsafe.Pointer(&ev[0])
	*(*int32)(unsafe.Add(p, offCookieType)) = xClientMessage
	*(*uint64)(unsafe.Add(p, offClientWindow)) = w.win
	*(*int32)(unsafe.Add(p, offClientFormat)) = 32
	xl.sendEvent(w.d, w.win, 0, 0, p) // XInitThreads: başka iş parçacığından aynı Display'e gönderim güvenli
	xl.flush(w.d)
	select {
	case <-w.done:
	case <-time.After(time.Second):
	}
}

// --- kapatma kısayolu (AC-102) -------------------------------------------------------------------------------------

var (
	hotkeyCode atomic.Uint32 // yakalanan tuş kodu (0 = yok)
	hotkeyFn   atomic.Pointer[func()]
	filterCB   uintptr
)

// GdkFilterReturn
const (
	gdkFilterContinue = 0
	gdkFilterRemove   = 2
)

// FFI kuralı: GDK süzgeç geri çağrısı yalnız init'te bir kez; ana iş parçacığında çağrılır, yalnız atomik okur.
func init() {
	filterCB = purego.NewCallback(func(xev, _, _ uintptr) uintptr {
		if xev == 0 || at[int32](xev, offKeyType) != xKeyPress {
			return gdkFilterContinue
		}
		kc := hotkeyCode.Load()
		if kc == 0 || at[uint32](xev, offKeyKeycode) != kc || !hotkeyState(at[uint32](xev, offKeyState)) {
			return gdkFilterContinue
		}
		if f := hotkeyFn.Load(); f != nil {
			(*f)()
		}
		return gdkFilterRemove
	})
}

// hotkeyState Ctrl+Shift basılı (Lock/NumLock ve diğer bitler önemsiz).
func hotkeyState(st uint32) bool { return st&(xControlMask|xShiftMask) == xControlMask|xShiftMask }

// hotkeyVariants XGrabKey varyantları (CapsLock/NumLock açıkken de yakalansın).
var hotkeyVariants = []uint32{0, xLockMask, xMod2Mask, xLockMask | xMod2Mask}

var errGrab = errors.New("input: kısayol yakalanamadı")

// grabHotkey Ctrl+Shift+<k> kısayolunu GDK'nın X bağlantısında yakalar. ANA iş parçacığında çağrılır (GTK döngüsü
// başlamadan önce ya da döngü içinden). Varyantlardan biri başarısızsa hepsi geri alınır (BadAccess: başka istemci).
func grabHotkey(k control.Hotkey) error {
	sym := map[uint32]uint64{control.HotkeyPrimary.VK: xkF12, control.HotkeyFallback.VK: xkF11}[k.VK]
	if sym == 0 || bindX() != nil {
		return errGrab
	}
	d := x11.XDisplay()
	if d == 0 {
		return errGrab
	}
	kc := xl.keysymToKeycode(d, sym)
	if kc == 0 {
		return errGrab
	}
	root := xl.defaultRoot(d)
	mods := uint32(xControlMask | xShiftMask)
	if x11.Trap(func() {
		for _, v := range hotkeyVariants {
			xl.grabKey(d, int32(kc), mods|v, root, 0, grabModeAsync, grabModeAsync)
		}
	}) != 0 {
		x11.Trap(func() {
			for _, v := range hotkeyVariants {
				xl.ungrabKey(d, int32(kc), mods|v, root)
			}
		})
		return errGrab
	}
	if err := x11.AddRootFilter(filterCB); err != nil {
		return errGrab
	}
	hotkeyCode.Store(uint32(kc))
	return nil
}
