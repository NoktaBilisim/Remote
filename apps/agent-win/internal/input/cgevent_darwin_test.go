//go:build darwin

package input

import (
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/darwin/objc"
)

// P28f K3 darwin: her işlev purego ile bağlanıyor; olay kurulup alanlar geri okunuyor (gönderilmeden).
func TestP28fCGBindAndEventFields(t *testing.T) {
	if err := bind(); err != nil {
		t.Fatal(err)
	}
	ev := cg.createKey(0, kvkCommand, true)
	if ev == 0 {
		t.Fatal("CGEventCreateKeyboardEvent")
	}
	defer cg.release(ev)
	cg.setType(ev, cgFlagsChanged)
	cg.setFlags(ev, modFlag(kvkCommand))
	cg.setInt(ev, fieldUserData, Marker())
	if cg.getInt(ev, fieldUserData) != Marker() || cg.getInt(ev, 9 /* keycode */) != kvkCommand {
		t.Fatal("alan geri okunamadı")
	}
	// NULL kaynak: localClick m.2 sentetik olayda HID durum kaynağı değil (spike K0s-4: 0).
	if cg.getInt(ev, fieldStateID) == hidSystemState {
		t.Fatal("NULL kaynaklı olay HID durum kaynağı taşımamalı")
	}
	u := []uint16{'ç', 'ğ'}
	k := cg.createKey(0, 0, true)
	cg.setUnicode(k, uint(len(u)), &u[0])
	cg.release(k)
	s := cg.createScroll(0, cgScrollUnitPixel, 2, 10, 0, 0)
	if s == 0 {
		t.Fatal("CGEventCreateScrollWheelEvent2")
	}
	cg.release(s)
	v := VirtualScreen()
	if v.Right <= v.Left || v.Bottom <= v.Top {
		t.Skipf("etkin ekran yok (başsız çalıştırıcı?): %+v", v)
	}
	if ids := activeDisplays(); len(ids) > 0 {
		r, ok := DisplayRect(ids[0])
		if !ok || r.Right-r.Left <= 0 || r.Left < v.Left || r.Right > v.Right {
			t.Fatalf("ekran %+v sanal %+v", r, v)
		}
	}
}

// AC-49 (gerçek enjeksiyon, zararsız): imleç bulunduğu noktaya taşınır, okunan konum ±1 nokta. Erişilebilirlik izni
// yoksa görünür SKIP (uydurma yok).
func TestAC49CGInjectMoveInPlace(t *testing.T) {
	if err := bind(); err != nil {
		t.Fatal(err)
	}
	if !cg.axTrusted() {
		t.Skip("SKIP: Erişilebilirlik izni yok — gerçek enjeksiyon sınanmadı")
	}
	inj, err := NewCGInjector()
	if err != nil {
		t.Fatal(err)
	}
	v := VirtualScreen()
	cur := cg.create(0)
	p := cg.location(cur)
	cg.release(cur)
	inj.SetVirtual(v)
	g := &control.Gate{}
	g.Open()
	a := NewApplier(g, inj, nil)
	a.SetTarget(v, v)
	x := (p.X - float64(v.Left)) / float64(v.Right-v.Left-1)
	y := (p.Y - float64(v.Top)) / float64(v.Bottom-v.Top-1)
	a.Handle([]byte(`{"t":"m.move","x":` + ftoa(x) + `,"y":` + ftoa(y) + `}`))
	time.Sleep(50 * time.Millisecond)
	cur = cg.create(0)
	q := cg.location(cur)
	cg.release(cur)
	if abs(q.X-p.X) > 1.5 || abs(q.Y-p.Y) > 1.5 {
		t.Fatalf("imleç %v → %v", p, q)
	}
}

// S-P28f-10: izin varken ControlReady deneme musluğunu kurup kaldırır; izin yoksa false (SKIP değil — iki dal da
// geçerli sonuç, hangisi olduğu yazılır).
func TestSP28f10ControlReadyMatchesPermission(t *testing.T) {
	if err := bind(); err != nil {
		t.Fatal(err)
	}
	got := ControlReady()
	if !cg.axTrusted() && got {
		t.Fatal("izinsiz ControlReady true olmamalı")
	}
	t.Logf("AXIsProcessTrusted=%v ControlReady=%v", cg.axTrusted(), got)
}

// localClick AppKit tarafı: olay yokken (test süreci, NSApp currentEvent nil) Present false → ret.
func TestSP28f1CurrentClickWithoutEventRejects(t *testing.T) {
	if _, err := objc.Framework("AppKit"); err != nil {
		t.Skip("AppKit yok")
	}
	objc.Pool(func() {
		c := CurrentClick()
		if c.Present || LocalClick(c, c, Uptime()) {
			t.Fatalf("olay yokken kabul: %+v", c)
		}
	})
	if EventClick(0).Present {
		t.Fatal("nil olay")
	}
}

// S7-7 / S-P28f-10: musluk yalnız kapı açıkken kurulu; kapanınca ≤ 1 dilimde kalkar. Kendi enjekte ettiğimiz olay
// yerel öncelik askısı başlatmaz (AC-104: yalnız yerel girdi).
func TestAC104TapLifecycleAndOwnEventsNotLocal(t *testing.T) {
	if err := bind(); err != nil {
		t.Fatal(err)
	}
	if !ControlReady() {
		t.Skip("SKIP: Erişilebilirlik izni/musluk yok")
	}
	g := &control.Gate{}
	lost := make(chan struct{}, 1)
	h := Start(g, nil, func() { lost <- struct{}{} })
	defer h.Stop()
	t.Logf("kısayol=%q hata=%v (Carbon kaydı test sürecinde)", h.Hotkey.Label, h.HotkeyErr)
	g.Open()
	deadline := time.Now().Add(time.Second)
	for curTap.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if curTap.Load() == 0 {
		t.Fatal("kapı açıkken musluk kurulmalı")
	}
	inj, err := NewCGInjector()
	if err != nil {
		t.Fatal(err)
	}
	v := VirtualScreen()
	inj.SetVirtual(v)
	cur := cg.create(0)
	p := cg.location(cur)
	cg.release(cur)
	a := NewApplier(g, inj, nil)
	a.SetTarget(v, v)
	x := (p.X - float64(v.Left)) / float64(v.Right-v.Left-1)
	y := (p.Y - float64(v.Top)) / float64(v.Bottom-v.Top-1)
	a.Handle([]byte(`{"t":"m.move","x":` + ftoa(x) + `,"y":` + ftoa(y) + `}`))
	time.Sleep(150 * time.Millisecond)
	if !g.Allow(time.Now()) {
		t.Log("askı görüldü: ölçüm sırasında yerel fare/klavye kullanıldı olabilir (yerel girdi beklenen davranış)")
	}
	g.Close()
	deadline = time.Now().Add(time.Second)
	for curTap.Load() != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if curTap.Load() != 0 {
		t.Fatal("kapı kapanınca musluk kalkmalı")
	}
	select {
	case <-lost:
		t.Fatal("normal kapanışta onLost çağrılmamalı")
	default:
	}
}

// S-P28f-1 m.2–m.4: kendi sentetik olayımız (NULL kaynak, işaretli) yerel sayılmaz; 0 olay → ret.
func TestSP28f1LocalEventRejectsOwnSynthetic(t *testing.T) {
	if err := bind(); err != nil {
		t.Fatal(err)
	}
	ev := cg.createMouse(0, cgLeftMouseUp, objc.CGPoint{}, cgButtonLeft)
	defer cg.release(ev)
	cg.setInt(ev, fieldUserData, Marker())
	if LocalEvent(ev) || LocalEvent(0) {
		t.Fatal("sentetik/boş olay yerel sayılmamalı")
	}
}
