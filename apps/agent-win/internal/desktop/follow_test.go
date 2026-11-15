package desktop

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/rtc"
)

// --- sahteler ---

type fakeDesk struct {
	mu   sync.Mutex
	name string
	err  error
}

func (d *fakeDesk) set(name string, err error) {
	d.mu.Lock()
	d.name, d.err = name, err
	d.mu.Unlock()
}

func (d *fakeDesk) Name() (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.name, d.err
}

// frameSrc her 2 ms'de bir kare üretir; açılış sayısı ve kapanış izlenir.
type frameSrc struct{ closed atomic.Bool }

func (s *frameSrc) NextFrame(ctx context.Context) (rtc.Frame, error) {
	select {
	case <-ctx.Done():
		return rtc.Frame{}, ctx.Err()
	case <-time.After(2 * time.Millisecond):
		return rtc.Frame{Data: []byte{1}}, nil
	}
}
func (s *frameSrc) Close() error { s.closed.Store(true); return nil }

func newFollower(d *fakeDesk, g *Gate, bind func() (string, error)) *Follower {
	return &Follower{Name: d.Name, Bind: bind, Gate: g, Interval: 10 * time.Millisecond, Timeout: 300 * time.Millisecond}
}

func waitClosed(t *testing.T, g *Gate) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if _, open := g.State(); !open {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("kapı kapanmadı")
}

// --- testler ---

func TestAC342GateClosesBeforeIndicatorRebuildAndOpensWithNewEpoch(t *testing.T) {
	d := &fakeDesk{name: "Default"}
	g := NewGate()
	var openAtBind atomic.Bool
	var resumed atomic.Int32
	f := newFollower(d, g, func() (string, error) {
		_, open := g.State()
		openAtBind.Store(open)
		return d.Name()
	})
	f.Resumed = func() { resumed.Add(1) }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- f.Run(ctx, "Default") }()
	d.set("Winlogon", nil)
	waitFor(t, func() bool { ep, open := g.State(); return open && ep == 2 })
	ep, err := g.Wait(ctxTimeout(t, time.Second))
	if err != nil || ep != 2 {
		t.Fatalf("dönem %d, hata %v", ep, err)
	}
	if openAtBind.Load() {
		t.Fatal("gösterge yeniden çizilirken kapı açıktı (O-P27-4 sırası)")
	}
	if resumed.Load() != 1 {
		t.Fatalf("Resumed %d kez", resumed.Load())
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run: %v", err)
	}
}

func TestAC342IndicatorNotVerifiedWithinDefaultTwoSecondsIsIndicatorFailed(t *testing.T) {
	d := &fakeDesk{name: "Default"}
	g := NewGate()
	block := make(chan struct{})
	defer close(block)
	f := &Follower{Name: d.Name, Gate: g, Bind: func() (string, error) { <-block; return "Winlogon", nil }}
	start := make(chan time.Time, 1)
	done := make(chan error, 1)
	go func() { done <- f.Run(context.Background(), "Default") }()
	d.set("Winlogon", nil)
	waitClosed(t, g)
	start <- time.Now()
	select {
	case err := <-done:
		el := time.Since(<-start)
		if !errors.Is(err, ErrIndicator) || el > DefaultTimeout+500*time.Millisecond || el < DefaultTimeout-100*time.Millisecond {
			t.Fatalf("hata %v, süre %v (beklenen ≈ %v)", err, el, DefaultTimeout)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("zaman aşımı uygulanmadı")
	}
	if _, open := g.State(); open {
		t.Fatal("başarısızlıktan sonra kapı açık")
	}
}

func TestAC342UnreadableDesktopKeepsGateClosedThenFails(t *testing.T) {
	d := &fakeDesk{name: "Default"}
	g := NewGate()
	var binds atomic.Int32
	f := newFollower(d, g, func() (string, error) { binds.Add(1); return "", errors.New("giriş masaüstü yok") })
	done := make(chan error, 1)
	go func() { done <- f.Run(context.Background(), "Default") }()
	d.set("", errors.New("OpenInputDesktop"))
	if err := <-done; !errors.Is(err, ErrIndicator) {
		t.Fatalf("hata %v", err)
	}
	if binds.Load() == 0 {
		t.Fatal("yeniden bağlanma denenmedi")
	}
	if _, open := g.State(); open {
		t.Fatal("kapı açık")
	}
}

func TestAC342BindOnStaleDesktopDoesNotOpenGate(t *testing.T) {
	d := &fakeDesk{name: "Default"}
	g := NewGate()
	f := newFollower(d, g, func() (string, error) { return "Default", nil }) // hep eski masaüstüne bağlanır
	done := make(chan error, 1)
	go func() { done <- f.Run(context.Background(), "Default") }()
	d.set("Winlogon", nil)
	if err := <-done; !errors.Is(err, ErrIndicator) {
		t.Fatalf("hata %v", err)
	}
}

func TestAC342FramesAndInputDroppedWhileDesktopChanges(t *testing.T) {
	g := NewGate()
	var opens atomic.Int32
	srcs := make(chan *frameSrc, 4)
	src, err := Source(g, func() (rtc.Source, error) {
		opens.Add(1)
		s := &frameSrc{}
		srcs <- s
		return s, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var injected atomic.Int32
	in := Input(g, func([]byte) { injected.Add(1) })
	first := <-srcs
	var frames atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pull(ctx, src, &frames)
	time.Sleep(20 * time.Millisecond)
	g.pause()
	time.Sleep(10 * time.Millisecond) // kapanış anında süren NextFrame düşürülür
	paused := frames.Load()
	in([]byte(`{"t":"key"}`))
	time.Sleep(60 * time.Millisecond)
	if frames.Load() != paused || injected.Load() != 0 {
		t.Fatalf("kapalı kapıda kare +%d, girdi %d", frames.Load()-paused, injected.Load())
	}
	g.resume()
	waitFor(t, func() bool { return frames.Load() > paused })
	if opens.Load() != 2 || !first.closed.Load() {
		t.Fatalf("yeni dönemde kaynak yeniden açılmadı: açılış %d, eski kapalı %v", opens.Load(), first.closed.Load())
	}
	in([]byte(`{"t":"key"}`))
	if injected.Load() != 1 {
		t.Fatal("açık kapıda girdi iletilmedi")
	}
	cancel()
	_ = src.Close()
}

func TestAC342ReopenFailureEndsSourceWithError(t *testing.T) {
	g := NewGate()
	n := 0
	src, _ := Source(g, func() (rtc.Source, error) {
		n++
		if n > 1 {
			return nil, errors.New("açılamadı")
		}
		return &frameSrc{}, nil
	})
	g.pause()
	g.resume()
	if _, err := src.NextFrame(context.Background()); err == nil {
		t.Fatal("yeniden açılış hatası dönmedi")
	}
	if _, err := src.NextFrame(context.Background()); !errors.Is(err, errSourceClosed) {
		t.Fatalf("hata %v", err)
	}
	if err := src.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestInputNilStaysNil(t *testing.T) {
	if Input(NewGate(), nil) != nil {
		t.Fatal("nil girdi kanalı açılmamalı (akış kanalı kapatır)")
	}
}

func pull(ctx context.Context, src rtc.Source, frames *atomic.Int32) {
	for ctx.Err() == nil {
		if _, err := src.NextFrame(ctx); err == nil {
			frames.Add(1)
		}
	}
}

func ctxTimeout(t *testing.T, d time.Duration) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	t.Cleanup(cancel)
	return ctx
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("koşul gerçekleşmedi")
		}
		time.Sleep(time.Millisecond)
	}
}
