//go:build linux

package input

import (
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
)

type recSink struct{ ops []linOp }

func (r *recSink) apply(ops []linOp) error {
	r.ops = append(r.ops, ops...)
	return nil
}

// AC-48 / AC-49: DOM code → evdev tablosu (input-event-codes.h örnekleri) ve VK eşlemesinde çakışma yok.
func TestAC48P28gEvdevTable(t *testing.T) {
	want := map[string]uint16{"KeyQ": 16, "KeyA": 30, "KeyZ": 44, "KeyM": 50, "Digit1": 2, "Digit0": 11, "Enter": 28,
		"NumpadEnter": 96, "ControlLeft": 29, "AltRight": 100, "MetaLeft": 125, "F1": 59, "F10": 68, "F11": 87, "F12": 88,
		"Numpad0": 82, "Numpad7": 71, "ArrowUp": 103, "Delete": 111, "IntlBackslash": 86, "Quote": 40, "Comma": 51}
	for code, ev := range want {
		if codeEvdev[code] != ev {
			t.Fatalf("%s: %d (beklenen %d)", code, codeEvdev[code], ev)
		}
	}
	for code := range codeVK {
		if _, ok := codeEvdev[code]; !ok {
			t.Fatalf("Windows tablosundaki %s Linux tablosunda yok", code)
		}
	}
	if len(linuxKey) != len(codeEvdev) {
		t.Fatalf("VK çakışması: %d / %d", len(linuxKey), len(codeEvdev))
	}
}

func TestAC48P28gKeysymTurkish(t *testing.T) {
	for r, s := range map[rune]uint32{'a': 'a', 'ç': 0xe7, 'ö': 0xf6, 'ü': 0xfc, 'ğ': 0x2bb, 'ı': 0x2b9, 'İ': 0x2a9,
		'ş': 0x1ba, 'Ş': 0x1aa, '@': '@', '€': 0x20ac, '😀': 0x0100_0000 + 0x1F600} {
		if keysymOf(r) != s {
			t.Fatalf("%q: %#x", r, keysymOf(r))
		}
	}
}

// AC-49: normalize koordinat → monitör → sanal (0..65535) → piksel gidiş-dönüşü ±2 px; tekerlek ve düğmeler.
func TestAC49P28gTranslateMouse(t *testing.T) {
	g := &control.Gate{}
	sink := &recSink{}
	inj := newLinuxInjector(sink, false)
	virt := Rect{Left: 0, Top: 0, Right: 3840, Bottom: 1080}
	inj.SetVirtual(virt)
	a := NewApplier(g, inj, nil)
	a.SetTarget(Rect{Left: 1920, Top: 0, Right: 3840, Bottom: 1080}, virt)
	g.Open()
	a.Handle([]byte(`{"t":"m.move","x":0.5,"y":0.25}`))
	a.Handle([]byte(`{"t":"m.btn","b":"l","down":true,"x":1,"y":1}`))
	a.Handle([]byte(`{"t":"m.btn","b":"l","down":false,"x":1,"y":1}`))
	a.Handle([]byte(`{"t":"m.wheel","dx":0,"dy":120}`))
	var moves []linOp
	var btns, wheels int
	for _, op := range sink.ops {
		switch op.kind {
		case opMove:
			moves = append(moves, op)
		case opButton:
			btns++
		case opWheel:
			wheels++
			if op.axis != 0 || op.steps != 1 {
				t.Fatalf("tekerlek aşağı +1: %+v", op)
			}
		}
	}
	if len(moves) < 2 || btns != 2 || wheels != 1 {
		t.Fatalf("işlemler: %+v", sink.ops)
	}
	if dx, dy := moves[0].x-(1920+0.5*1919), moves[0].y-0.25*1079; dx*dx > 4 || dy*dy > 4 {
		t.Fatalf("±2 px: %+v", moves[0])
	}
	if dx, dy := moves[1].x-3839, moves[1].y-1079; dx*dx > 4 || dy*dy > 4 {
		t.Fatalf("köşe ±2 px: %+v", moves[1])
	}
}

// AC-48: kısayol tuşları evdev, metin keysym; Win+L iletilmez.
func TestAC48P28gTranslateKeys(t *testing.T) {
	g := &control.Gate{}
	sink := &recSink{}
	a := NewApplier(g, newLinuxInjector(sink, false), nil)
	a.SetTarget(Rect{Right: 100, Bottom: 100}, Rect{Right: 100, Bottom: 100})
	g.Open()
	for _, m := range []string{`{"t":"k","code":"KeyS","key":"ş","down":true}`, `{"t":"k","code":"KeyS","key":"ş","down":false}`,
		`{"t":"k","code":"ControlLeft","key":"Control","down":true}`, `{"t":"k","code":"KeyC","key":"c","down":true}`,
		`{"t":"k","code":"KeyC","key":"c","down":false}`, `{"t":"k","code":"ControlLeft","key":"Control","down":false}`,
		`{"t":"k","code":"MetaLeft","key":"Meta","down":true}`, `{"t":"k","code":"KeyL","key":"l","down":true}`} {
		a.Handle([]byte(m))
	}
	want := []linOp{{kind: opSym, sym: 0x1ba, down: true}, {kind: opSym, sym: 0x1ba}, {kind: opKey, code: 29, down: true},
		{kind: opKey, code: 46, down: true}, {kind: opKey, code: 46}, {kind: opKey, code: 29},
		{kind: opKey, code: 125, down: true}}
	if len(sink.ops) != len(want) {
		t.Fatalf("işlemler: %+v", sink.ops)
	}
	for i := range want {
		if sink.ops[i] != want[i] {
			t.Fatalf("%d: %+v (beklenen %+v)", i, sink.ops[i], want[i])
		}
	}
}

// §5.2b m.3 (r3, Y-P28g-T2-1): "1,9 sn tut / 1 ms bırak / yeniden bas" dizisi 10 sn → her 3 sn penceresinde
// değiştiricisiz toplam ≥ 1 sn; bütçe dolunca bırakma + 1 sn soğuma.
func TestAC399P28gModifierBudget(t *testing.T) {
	t0 := time.Unix(1000, 0)
	now := t0
	sink := &recSink{}
	inj := newLinuxInjector(sink, true)
	inj.now = func() time.Time { return now }
	ctrl := func(down bool) []Event {
		f := uint32(0)
		if !down {
			f = KeyUp
		}
		return []Event{{VK: 0xA2, Flags: f}} // ControlLeft
	}
	const ms = time.Millisecond
	held := make([]bool, 10_000) // ms başına "değiştirici sistemde basılı"
	pressed := false
	inject := func(evs []Event) {
		n := len(sink.ops)
		_ = inj.Inject(evs)
		for _, op := range sink.ops[n:] {
			pressed = op.down
		}
	}
	// teknisyen dizisi: 0'da bas, 1900 ms tut, 1 ms bırak, yeniden bas …
	next, down := time.Duration(0), false
	for i := range 10_000 {
		now = t0.Add(time.Duration(i) * ms)
		el := time.Duration(i) * ms
		if el == next {
			down = !down
			inject(ctrl(down))
			if down {
				next += 1900 * ms
			} else {
				next += ms
			}
		}
		// zamanlayıcının yerine: her ms'de bütçe denetimi (gerçekte deadline'da tetiklenir)
		inj.mu.Lock()
		if rel := inj.budget.expire(now); len(rel) > 0 {
			_ = sink.apply(rel)
			pressed = false
		}
		inj.mu.Unlock()
		held[i] = pressed
	}
	if inj.timer != nil {
		inj.timer.Stop()
	}
	for start := 0; start+3000 <= len(held); start++ {
		free := 0
		for _, h := range held[start : start+3000] {
			if !h {
				free++
			}
		}
		if free < 1000 {
			t.Fatalf("pencere %d ms: değiştiricisiz %d ms (< 1000)", start, free)
		}
	}
	// soğuma: bütçe bırakmasından hemen sonra basış düşer
	b := newModBudget()
	b.filter(linOp{kind: opKey, code: evLeftShift, down: true}, t0)
	if rel := b.expire(t0.Add(budgetLimit)); len(rel) != 1 || rel[0].down {
		t.Fatalf("bütçe bırakması: %+v", rel)
	}
	if b.filter(linOp{kind: opKey, code: evLeftShift, down: true}, t0.Add(budgetLimit+500*ms)) {
		t.Fatal("soğumada basış geçti")
	}
	if b.filter(linOp{kind: opKey, code: evLeftShift}, t0.Add(budgetLimit+600*ms)) {
		t.Fatal("basılı olmayan bırakma iletilmemeli")
	}
	if !b.filter(linOp{kind: opKey, code: 30, down: true}, t0.Add(budgetLimit+600*ms)) {
		t.Fatal("değiştirici olmayan tuş soğumada geçmeli")
	}
}

// Zamanlayıcı gerçek saatle basılı değiştiriciyi ≈ 2 sn'de bırakır (mesaj gelmese de).
func TestAC399P28gModifierBudgetTimer(t *testing.T) {
	sink := &recSink{}
	inj := newLinuxInjector(sink, true)
	done := make(chan struct{})
	ls := &lockedSink{inner: sink, done: done}
	inj.sink = ls
	t0 := time.Now()
	_ = inj.Inject([]Event{{VK: 0xA0}}) // ShiftLeft basılı
	select {
	case <-done:
		if d := time.Since(t0); d < 1900*time.Millisecond || d > 2300*time.Millisecond {
			t.Fatalf("bırakma süresi %v", d)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("zamanlayıcı bırakmadı")
	}
}

type lockedSink struct {
	inner *recSink
	done  chan struct{}
	n     int
}

func (l *lockedSink) apply(ops []linOp) error {
	l.n++
	if l.n == 2 && len(ops) == 1 && !ops[0].down {
		close(l.done)
	}
	return l.inner.apply(ops)
}
