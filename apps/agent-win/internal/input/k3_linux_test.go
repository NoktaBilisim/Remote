//go:build linux

package input

import (
	"bufio"
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/portal"
)

// fakeNotifier portal.Session'ın girdi yüzü.
type fakeNotifier struct {
	mu    sync.Mutex
	calls []string
	err   error
}

func (f *fakeNotifier) rec(s string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, s)
	return f.err
}

func (f *fakeNotifier) PointerMotionAbsolute(x, y float64) error {
	return f.rec("move:" + strconv.Itoa(int(x)) + "," + strconv.Itoa(int(y)))
}
func (f *fakeNotifier) PointerButton(b int32, d bool) error {
	return f.rec("btn:" + strconv.Itoa(int(b)) + ":" + strconv.FormatBool(d))
}
func (f *fakeNotifier) PointerAxisDiscrete(a uint32, s int32) error {
	return f.rec("axis:" + strconv.Itoa(int(a)) + ":" + strconv.Itoa(int(s)))
}
func (f *fakeNotifier) KeyboardKeycode(c int32, d bool) error {
	return f.rec("key:" + strconv.Itoa(int(c)) + ":" + strconv.FormatBool(d))
}
func (f *fakeNotifier) KeyboardKeysym(s int32, d bool) error {
	return f.rec("sym:" + strconv.Itoa(int(s)) + ":" + strconv.FormatBool(d))
}

func (f *fakeNotifier) got() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

// AC-49 / AC-48 (Wayland): işlemler portal Notify* karşılıklarına (BTN_* evdev, tekerlek ekseni, evdev tuş, keysym).
func TestAC48P28gK3PortalSinkMapping(t *testing.T) {
	n := &fakeNotifier{}
	p := newPortalSink(nil)
	p.setSession(n)
	err := p.apply([]linOp{{kind: opMove, x: 10, y: 20}, {kind: opButton, button: btnLeft, down: true},
		{kind: opButton, button: btnRight}, {kind: opButton, button: btnMiddle, down: true},
		{kind: opWheel, axis: 1, steps: -2}, {kind: opKey, code: 29, down: true}, {kind: opSym, sym: 0x1ba, down: true}})
	if err != nil {
		t.Fatal(err)
	}
	want := "move:10,20 btn:272:true btn:273:false btn:274:true axis:1:-2 key:29:true sym:442:true"
	if got := strings.Join(n.got(), " "); got != want {
		t.Fatalf("%s\nbeklenen %s", got, want)
	}
}

// §5.2b m.5 (D-P28g-T2-3): ısınma yalnız çağrıldığında (kontrol verildiği an) Shift bas-bırak; 1 sn tuş basmaları düşer,
// bırakma ve fare geçer; sonra tuşlar geçer.
func TestAC399P28gK3WarmupOnGrantOnly(t *testing.T) {
	n := &fakeNotifier{}
	now := time.Unix(1000, 0)
	p := newPortalSink(nil)
	p.now = func() time.Time { return now }
	p.setSession(n)
	if len(n.got()) != 0 {
		t.Fatal("oturum başında enjeksiyon olmamalı")
	}
	p.warm()
	_ = p.apply([]linOp{{kind: opKey, code: 30, down: true}, {kind: opKey, code: 30}, {kind: opMove, x: 1, y: 1}})
	now = now.Add(warmDelay)
	_ = p.apply([]linOp{{kind: opKey, code: 30, down: true}})
	want := "key:42:true key:42:false key:30:false move:1,1 key:30:true"
	if got := strings.Join(n.got(), " "); got != want {
		t.Fatalf("%s\nbeklenen %s", got, want)
	}
}

// §14 m.6: Notify hatası çökme değil "kontrol yok": onFail bir kez, sonraki partiler de hata.
func TestAC399P28gK3NotifyErrorClosesOnce(t *testing.T) {
	n := &fakeNotifier{err: portal.ErrNotAllowed}
	var fails atomic.Int32
	done := make(chan struct{}, 4)
	p := newPortalSink(func() { fails.Add(1); done <- struct{}{} })
	p.setSession(n)
	for range 3 {
		if err := p.apply([]linOp{{kind: opMove}}); !errors.Is(err, portal.ErrNotAllowed) {
			t.Fatalf("hata: %v", err)
		}
	}
	<-done
	time.Sleep(20 * time.Millisecond)
	if fails.Load() != 1 {
		t.Fatalf("onFail %d kez", fails.Load())
	}
	if (&portalSink{now: time.Now}).apply([]linOp{{kind: opMove}}) == nil {
		t.Fatal("oturumsuz enjeksiyon hata vermeli")
	}
}

// X11 XKB düzey değiştiricileri ve tekerlek düğmeleri.
func TestAC48P28gK3LevelModsAndWheel(t *testing.T) {
	if m := levelMods(0, 50, 92); len(m) != 0 {
		t.Fatal(m)
	}
	if m := levelMods(1, 50, 92); len(m) != 1 || m[0] != 50 {
		t.Fatal(m)
	}
	if m := levelMods(3, 50, 92); len(m) != 2 || m[0] != 50 || m[1] != 92 {
		t.Fatal(m)
	}
	if levelMods(2, 50, 0) != nil || levelMods(1, 0, 92) != nil {
		t.Fatal("eksik değiştirici: karakter düşmeli")
	}
	for _, c := range []struct {
		axis  uint8
		steps int32
		btn   uint32
		n     int32
	}{{0, 2, 5, 2}, {0, -1, 4, 1}, {1, 3, 7, 3}, {1, -2, 6, 2}} {
		if b, n := wheelButton(c.axis, c.steps); b != c.btn || n != c.n {
			t.Fatalf("%+v → %d %d", c, b, n)
		}
	}
}

// AC-102 / AC-104: kısayol durumu (Lock/NumLock önemsiz), XTEST kimliği yerel sayılmaz, ad eşleşmesi.
func TestAC104P28gK3SourceAndHotkeyState(t *testing.T) {
	ids := []int32{4, 5}
	if isLocalSource(4, ids) || isLocalSource(5, ids) || !isLocalSource(9, ids) || !isLocalSource(4, nil) {
		t.Fatal("kaynak sınıflaması")
	}
	for st, ok := range map[uint32]bool{5: true, 5 | xLockMask: true, 5 | xMod2Mask: true, 4: false, 1: false, 0: false} {
		if hotkeyState(st) != ok {
			t.Fatalf("state %#x", st)
		}
	}
	if !isXTestName("Virtual core XTEST pointer") || isXTestName("Xvfb mouse") {
		t.Fatal("ad")
	}
}

// §5.2a m.3–m.5: XTEST kimliği / okunamayan aygıt / kimlik listesi yok → ret; enjektör duraklatılmamış → ret; son
// enjeksiyondan < 1,5 sn → ret; a11y kapalı→açık mandalı.
func TestAC399P28gK3LocalClickGuard(t *testing.T) {
	ids := []int32{4, 5}
	g := NewLinuxClickGuard(func() []int32 { return ids })
	now := time.Unix(5000, 0)
	g.now = func() time.Time { return now }
	lastInject.Store(0)
	if !g.Decide(10, 10) {
		t.Fatal("gerçek aygıt kabul edilmeli (enjektör yok)")
	}
	for _, c := range [][2]int32{{4, 10}, {10, 5}, {-1, 10}, {10, -1}} {
		if g.Decide(c[0], c[1]) {
			t.Fatalf("%v kabul edildi", c)
		}
	}
	if NewLinuxClickGuard(func() []int32 { return nil }).Decide(10, 10) {
		t.Fatal("kimlik listesi yokken kabul")
	}
	gate := &control.Gate{}
	g.SetInjector(gate)
	if !g.Decide(10, 10) {
		t.Fatal("kapı kapalıyken (enjeksiyon yok) kabul edilmeli")
	}
	gate.Open()
	if g.Decide(10, 10) {
		t.Fatal("kapı açık ve enjektör duraklatılmamışken kabul")
	}
	if !g.MouseKeys() {
		t.Fatal("Fare Tuşları bilinmiyorken açık sayılmalı (fail-closed)")
	}
	g.setMouseKeys(portal.A11yState{Known: true})
	if g.MouseKeys() {
		t.Fatal("kapalı okunmuşken açık")
	}
	g.SetPaused(true)
	lastInject.Store(now.Add(-time.Second).UnixNano())
	if g.Decide(10, 10) {
		t.Fatal("son enjeksiyondan < 1,5 sn kabul")
	}
	now = now.Add(600 * time.Millisecond)
	if !g.Decide(10, 10) {
		t.Fatal("≥ 1,5 sn sonra kabul edilmeli")
	}
	lastInject.Store(0)
	off, on := portal.A11yState{Known: true}, portal.A11yState{Known: true, On: true}
	if !a11yTurnedOn(off, on) || a11yTurnedOn(on, on) || a11yTurnedOn(off, portal.A11yState{}) {
		t.Fatal("a11y geçişi")
	}
}

// D-P28g-K1-1 (§5.2a m.5, fail-closed): başlangıç okunamadıysa kapalı varsayılır; sonraki bilinen "açık" okuma mandalı
// kurar (Wayland'de m.3 portal enjeksiyonunu ayıramaz, m.5 asıl ayırıcıdır).
func TestP28gK10A11yUnknownBaseFailClosed(t *testing.T) {
	unknown, off, on := portal.A11yState{}, portal.A11yState{Known: true}, portal.A11yState{Known: true, On: true}
	if !a11yTurnedOn(unknown, on) {
		t.Fatal("bilinmeyen başlangıç + açık → mandal kurulmalı")
	}
	if a11yTurnedOn(unknown, off) || a11yTurnedOn(unknown, unknown) {
		t.Fatal("bilinmeyen başlangıç + kapalı/bilinmeyen → mandal yok")
	}
	g := NewLinuxClickGuard(func() []int32 { return []int32{4} })
	var n atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	g.WatchA11y(ctx, func() portal.A11yState {
		if n.Add(1) == 1 {
			return unknown // başlangıç okunamadı
		}
		return on
	})
	deadline := time.Now().Add(5 * a11yPoll)
	for !g.A11yChanged() && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if !g.A11yChanged() {
		t.Fatal("başlangıç bilinmiyorken açılan a11y mandalı kurmadı")
	}
}

type fakeSess struct{ ok bool }

func (f fakeSess) CanControl() bool { return f.ok }

// §5.2b m.1, m.2, m.6; D-P28g-T2-1: kontrol koşulları ve kilit → REVOKED (kapı kapanır, OnLost).
func TestAC399P28gK3HostConditions(t *testing.T) {
	g := &control.Gate{}
	lock := portal.LockState{Known: true}
	guard := portal.LockGuard{Known: true, Shortcut: true}
	lost := make(chan struct{}, 4)
	h := &LinuxHost{cfg: LinuxHostConfig{Gate: g, Wayland: true, BusOK: true,
		Lock: func() portal.LockState { return lock }, Guard: func() portal.LockGuard { return guard },
		OnLost: func() { lost <- struct{}{} }}, stop: make(chan struct{})}
	h.ps = newPortalSink(h.lose)
	h.inj = newLinuxInjector(h.ps, true)
	if h.ControlReady() {
		t.Fatal("portal oturumu yokken hazır")
	}
	h.sess = fakeSess{ok: false}
	if h.ControlReady() {
		t.Fatal("devices=0 iken hazır (WAYLAND_NO_CONTROL olmalı)")
	}
	h.sess = fakeSess{ok: true}
	if !h.ControlReady() || !h.Arm() {
		t.Fatal("koşullar sağlanınca hazır olmalı")
	}
	for name, set := range map[string]func(){
		"kısayol boş":         func() { guard.Shortcut = false },
		"disable-lock-screen": func() { guard.Disabled = true },
		"ayar okunamadı":      func() { guard.Known = false },
		"kilit bilinmiyor":    func() { lock.Known = false },
		"kilitli":             func() { lock.Locked = true },
		"veri yolu":           func() { h.cfg.BusOK = false },
	} {
		lock, guard, h.cfg.BusOK = portal.LockState{Known: true}, portal.LockGuard{Known: true, Shortcut: true}, true
		set()
		if h.ControlReady() {
			t.Fatalf("%s: hazır", name)
		}
	}
	g.Open()
	h.LockChanged(portal.LockState{Known: true, Locked: true})
	if g.IsOpen() {
		t.Fatal("kilitte kapı kapanmalı")
	}
	select {
	case <-lost:
	case <-time.After(time.Second):
		t.Fatal("OnLost çağrılmadı")
	}
	g.Open()
	h.LockChanged(portal.LockState{})
	if g.IsOpen() {
		t.Fatal("kilit durumu okunamayınca kapı kapanmalı (fail-closed)")
	}
	// X11: XTEST kimliği ve kısayol olmadan hazır değil.
	x := &LinuxHost{cfg: LinuxHostConfig{Gate: g, BusOK: true, Lock: func() portal.LockState { return portal.LockState{Known: true} }},
		inj: newLinuxInjector(&recSink{}, false), HotkeyErr: control.ErrNoHotkey}
	if x.ControlReady() {
		t.Fatal("X11 kısayolsuz hazır")
	}
}

// D-P28g-T2-2 (K8a zorunlu adı): kullanılan her ofset/boyut sabiti imajdaki libx11-dev/libxi-dev başlıklarından
// üretilen P28G_XI2_OFFSETS dosyasıyla aynı. Değişken boşsa (imaj dışı) SKIP.
func TestP28gK3XI2OffsetsMatchHeaders(t *testing.T) {
	path := os.Getenv("P28G_XI2_OFFSETS")
	if path == "" {
		t.Skip("SKIP: P28G_XI2_OFFSETS (test-linux-gui imajı) gerekir")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got := map[string]int{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		k, v, ok := strings.Cut(strings.TrimSpace(sc.Text()), "=")
		if n, err := strconv.Atoi(v); ok && err == nil {
			got[k] = n
		}
	}
	want := map[string]int{
		"sizeof.XEvent": sizeXEvent, "XGenericEventCookie.type": offCookieType,
		"XGenericEventCookie.extension": offCookieExtension, "XGenericEventCookie.evtype": offCookieEvtype,
		"XGenericEventCookie.data": offCookieData, "XIRawEvent.evtype": offRawEvtype, "XIRawEvent.sourceid": offRawSourceid,
		"sizeof.XIEventMask": sizeEventMask, "XIEventMask.deviceid": offMaskDeviceid, "XIEventMask.mask_len": offMaskLen,
		"XIEventMask.mask": offMaskPtr, "sizeof.XIDeviceInfo": sizeDeviceInfo, "XIDeviceInfo.deviceid": offInfoDeviceid,
		"XIDeviceInfo.name": offInfoName, "XIDeviceInfo.use": offInfoUse, "XIDeviceInfo.attachment": offInfoAttachment,
		"XClientMessageEvent.window": offClientWindow, "XClientMessageEvent.format": offClientFormat,
		"XKeyEvent.type": offKeyType, "XKeyEvent.state": offKeyState, "XKeyEvent.keycode": offKeyKeycode,
	}
	for k, v := range want {
		g, ok := got[k]
		if !ok {
			t.Errorf("%s dosyada yok (xi2-offsets.c'ye satır eklenmeli)", k)
		} else if g != v {
			t.Errorf("%s: başlık %d, Go sabiti %d", k, g, v)
		}
	}
}
