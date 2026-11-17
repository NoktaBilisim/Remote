package input

import (
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
)

type fakeProbe struct {
	mouseKeys bool
	reads     int
	x, y      float64
	cursorOK  bool
}

func (f *fakeProbe) MouseKeys() bool { f.reads++; return f.mouseKeys }
func (f *fakeProbe) Cursor() (float64, float64, bool) {
	return f.x, f.y, f.cursorOK
}

// hostApplier macOS benzeri monitör kipi: 1000x1000 nokta monitör, kapı açık.
func hostApplier(t *testing.T, p *fakeProbe) (*Applier, *fakeInj, *time.Time) {
	t.Helper()
	g := &control.Gate{}
	inj := &fakeInj{}
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	a := NewApplier(g, inj, func() time.Time { return now })
	g.Open()
	a.SetTarget(Rect{Right: 1000, Bottom: 1000}, Rect{Right: 1000, Bottom: 1000})
	a.SetHostProbe(p)
	t.Cleanup(func() { SetOwnWindows(nil) })
	return a, inj, &now
}

// Y-P28f-K1 (a): Fare Tuşları açıkken tuş takımı ve tuş takımı olmayan karşılıkları (I = tıkla) düşer; diğer tuşlar ve
// fare geçer; ayar accessEvery'de bir okunur; kapalıyken tuş takımı geçer.
func TestYP28fK1MouseKeysDropsKeypad(t *testing.T) {
	p := &fakeProbe{mouseKeys: true, cursorOK: true, x: 500, y: 500}
	a, inj, now := hostApplier(t, p)
	for _, c := range []string{"Numpad5", "NumpadDecimal", "NumpadEnter", "NumLock", "KeyI", "Digit8", "Period"} {
		a.Handle([]byte(`{"t":"k","code":"` + c + `","down":true}`))
	}
	if n := int(inj.n.Load()); n != 0 {
		t.Fatalf("Fare Tuşları açıkken %d olay enjekte edildi", n)
	}
	a.Handle([]byte(`{"t":"k","code":"KeyA","key":"a","down":true}`))
	a.Handle([]byte(`{"t":"m.btn","b":"l","x":0.1,"y":0.1,"down":true}`))
	if int(inj.n.Load()) == 0 {
		t.Fatal("diğer tuş/fare geçmeli")
	}
	if p.reads != 1 {
		t.Fatalf("ayar bir kez okunmalı (önbellek), %d", p.reads)
	}
	p.mouseKeys = false
	*now = now.Add(accessEvery)
	before := int(inj.n.Load())
	a.Handle([]byte(`{"t":"k","code":"Numpad5","down":true}`))
	if int(inj.n.Load()) == before {
		t.Fatal("Fare Tuşları kapalıyken tuş takımı geçmeli")
	}
	if a.scopeDropped.Load() != 7 {
		t.Fatalf("düşen sayısı %d", a.scopeDropped.Load())
	}
}

// Y-P28f-K1 (b): imleç pencerelerimizin üstündeyken enjekte fare düğmesi basması ve tuş takımı düşer; bırakma düşmez
// (S7-13); imleç okunamazsa tuş takımı düşer; pencere dışında geçer.
func TestYP28fK1OwnWindowDropsClickAndKeypad(t *testing.T) {
	p := &fakeProbe{cursorOK: true, x: 150, y: 150}
	a, inj, _ := hostApplier(t, p)
	SetOwnWindows([]FRect{{X: 100, Y: 100, W: 200, H: 200}})
	a.Handle([]byte(`{"t":"m.btn","b":"l","x":0.15,"y":0.15,"down":true}`)) // ≈ (150,150): pencerede
	a.Handle([]byte(`{"t":"m.btn","b":"r","x":0.15,"y":0.15,"down":true}`))
	a.Handle([]byte(`{"t":"k","code":"Numpad5","down":true}`)) // imleç pencerede
	if n := int(inj.n.Load()); n != 0 {
		t.Fatalf("pencerede %d olay enjekte edildi", n)
	}
	a.Handle([]byte(`{"t":"m.btn","b":"l","x":0.5,"y":0.5,"down":true}`)) // dışarıda bas
	pressed := int(inj.n.Load())
	if pressed == 0 {
		t.Fatal("pencere dışı tıklama geçmeli")
	}
	a.Handle([]byte(`{"t":"m.btn","b":"l","x":0.15,"y":0.15,"down":false}`)) // pencerede bırak: düşmez
	if int(inj.n.Load()) == pressed {
		t.Fatal("basılı düğmenin bırakılması düşmemeli")
	}
	p.x, p.y = 600, 600
	a.Handle([]byte(`{"t":"m.move","x":0.6,"y":0.6}`)) // son enjekte hedef de dışarıda
	before := int(inj.n.Load())
	a.Handle([]byte(`{"t":"k","code":"Numpad5","down":true}`))
	if int(inj.n.Load()) == before {
		t.Fatal("imleç dışarıdayken tuş takımı geçmeli")
	}
	a.Handle([]byte(`{"t":"k","code":"Numpad5","down":false}`))
	p.cursorOK = false
	before = int(inj.n.Load())
	a.Handle([]byte(`{"t":"k","code":"Numpad6","down":true}`))
	if int(inj.n.Load()) != before {
		t.Fatal("imleç okunamazsa tuş takımı düşmeli (fail-closed)")
	}
	SetOwnWindows(nil)
	a.Handle([]byte(`{"t":"m.btn","b":"r","x":0.15,"y":0.15,"down":true}`))
	if int(inj.n.Load()) == before {
		t.Fatal("pencere kapanınca tıklama geçmeli")
	}
}

// Y-P28f-K1: HostProbe yokken (Windows) davranış değişmez; Fare Tuşları tercih yorumu fail-closed.
func TestYP28fK1NoProbeAndMouseKeysState(t *testing.T) {
	g := &control.Gate{}
	inj := &fakeInj{}
	a := NewApplier(g, inj, nil)
	g.Open()
	a.SetTarget(Rect{Right: 1000, Bottom: 1000}, Rect{Right: 1000, Bottom: 1000})
	SetOwnWindows([]FRect{{X: 0, Y: 0, W: 1000, H: 1000}})
	t.Cleanup(func() { SetOwnWindows(nil) })
	a.Handle([]byte(`{"t":"m.btn","b":"l","x":0.5,"y":0.5,"down":true}`))
	a.Handle([]byte(`{"t":"k","code":"Numpad5","down":true}`))
	if int(inj.n.Load()) == 0 {
		t.Fatal("HostProbe yokken kural uygulanmamalı")
	}
	for _, c := range []struct{ readable, set, val, want bool }{
		{false, false, false, true}, // alan okunamadı → açık
		{true, false, false, false}, // okunabiliyor, anahtar yok → kapalı
		{true, true, true, true},
		{true, true, false, false},
		{false, true, false, false},
	} {
		if got := mouseKeysState(c.readable, c.set, c.val); got != c.want {
			t.Errorf("%+v → %v", c, got)
		}
	}
}

// Y-P28f-K1r (1): Fare Tuşları "kapalı" okunmuş olsa da (önbellek / anahtar adı belirsizliği) imleç pencerelerimizdeyken
// Fare Tuşları harfleri (I = tıkla, 8, .) ve tuş takımı düşer; dışarıda harfler geçer.
func TestYP28fK1rOwnWindowDropsMouseKeysLettersWhenOff(t *testing.T) {
	p := &fakeProbe{mouseKeys: false, cursorOK: true, x: 150, y: 150}
	a, inj, _ := hostApplier(t, p)
	SetOwnWindows([]FRect{{X: 100, Y: 100, W: 200, H: 200}})
	for _, c := range []string{"KeyI", "Digit8", "Period", "KeyM", "Numpad5"} {
		a.Handle([]byte(`{"t":"k","code":"` + c + `","down":true}`))
	}
	if n := inj.n.Load(); n != 0 {
		t.Fatalf("kendi pencerede %d olay enjekte edildi", n)
	}
	if p.reads != 1 || a.scopeDropped.Load() != 5 {
		t.Fatalf("okuma=%d düşen=%d", p.reads, a.scopeDropped.Load())
	}
	p.x, p.y = 600, 600
	a.Handle([]byte(`{"t":"k","code":"KeyI","key":"i","down":true}`))
	if inj.n.Load() == 0 {
		t.Fatal("imleç dışarıdayken harf geçmeli")
	}
}

// Y-P28f-K1r (2): pencereye enjekte hareket + hemen Numpad5; canlı imleç henüz eski (dış) konumda → son hedef pencerede,
// düşer.
func TestYP28fK1rLastMoveTargetOverOwnWindow(t *testing.T) {
	p := &fakeProbe{cursorOK: true, x: 600, y: 600}
	a, inj, _ := hostApplier(t, p)
	SetOwnWindows([]FRect{{X: 100, Y: 100, W: 200, H: 200}})
	a.Handle([]byte(`{"t":"m.move","x":0.15,"y":0.15}`))
	moved := inj.n.Load()
	if moved == 0 {
		t.Fatal("hareket enjekte edilmeli")
	}
	a.Handle([]byte(`{"t":"k","code":"Numpad5","down":true}`))
	a.Handle([]byte(`{"t":"k","code":"KeyI","key":"i","down":true}`))
	if inj.n.Load() != moved {
		t.Fatal("son enjekte hedef pencerede: tuş takımı/Fare Tuşları harfi düşmeli")
	}
}
