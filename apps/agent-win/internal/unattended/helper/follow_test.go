package helper

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
)

// K6b (mimari-p27 §5.5 r2, O-P27-4; AC-294, AC-342): sahte masaüstü izleyici + sahte gösterge gecikmesi; yayındaki
// kare ve enjekte edilen girdi sayılır.

type deskName struct {
	mu   sync.Mutex
	name string
}

func (d *deskName) set(n string) { d.mu.Lock(); d.name = n; d.mu.Unlock() }
func (d *deskName) get() (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.name, nil
}

type deskIndicator struct {
	fakeIndicator
	desk string
}

func (i *deskIndicator) Desktop() string { return i.desk }

// streamMedia kaynaktan kare çeker ve sayar (P28c: yayın eşten bağımsız).
type streamMedia struct {
	frames *atomic.Int32
}

func (streamMedia) SetLow(bool) {}

func (p streamMedia) Stream(ctx context.Context, src rtc.Source) error {
	for {
		if _, err := src.NextFrame(ctx); err != nil {
			return err
		}
		p.frames.Add(1)
	}
}

type tickSrc struct{}

func (tickSrc) NextFrame(ctx context.Context) (rtc.Frame, error) {
	select {
	case <-ctx.Done():
		return rtc.Frame{}, ctx.Err()
	case <-time.After(2 * time.Millisecond):
		return rtc.Frame{Data: []byte{1}}, nil
	}
}
func (tickSrc) Close() error { return nil }

type deskRig struct {
	*rig
	desk     *deskName
	frames   atomic.Int32
	injected atomic.Int32
	handlers chan rtc.Handlers
	shows    atomic.Int32
	resumed  atomic.Int32
	inds     chan *deskIndicator
}

// newDeskRig ikinci ve sonraki gösterge çizimleri rebindDelay sonra o anki masaüstüne bağlanır (delay<0: hiç dönmez).
func newDeskRig(rebindDelay time.Duration, timeout time.Duration) *deskRig {
	r := &deskRig{rig: newRig(nil), desk: &deskName{name: "Default"}, handlers: make(chan rtc.Handlers, 4),
		inds: make(chan *deskIndicator, 8)}
	r.d.InputDesktop = r.desk.get
	r.d.Gate = desktop.NewGate()
	r.d.FollowInterval, r.d.FollowTimeout = 10*time.Millisecond, timeout
	r.d.Resumed = func() { r.resumed.Add(1) }
	r.d.ShowIndicator = func(string) (Indicator, error) {
		if r.shows.Add(1) > 1 {
			if rebindDelay < 0 {
				select {}
			}
			time.Sleep(rebindDelay)
		}
		name, _ := r.desk.get()
		ind := &deskIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}, desk: name}
		r.inds <- ind
		return ind, nil
	}
	r.d.Flow.Capture = func(int) (rtc.Source, error) { return tickSrc{}, nil }
	r.d.Flow.Input = func([]byte) { r.injected.Add(1) }
	r.d.Flow.NewPeer = func(_ []signal.IceServer, _ []string, h rtc.Handlers) (flow.Peer, error) {
		r.handlers <- h
		return fakePeer{}, nil
	}
	r.d.Flow.Media = streamMedia{frames: &r.frames}
	return r
}

// startStreaming oturumu açar, yayının kare ürettiğini görür ve girdi alıcısını döner.
func (r *deskRig) startStreaming(t *testing.T) (chan uint32, rtc.Handlers) {
	t.Helper()
	done := runAsync(r.rig)
	r.conn.in <- hello()
	waitSent[signal.ShareState](t, r.conn)
	h := <-r.handlers
	until(t, func() bool { return r.frames.Load() > 0 })
	return done, h
}

func (r *deskRig) switchAndWaitPaused(t *testing.T, name string) int32 {
	t.Helper()
	r.desk.set(name)
	until(t, func() bool { _, open := r.d.Gate.State(); return !open })
	time.Sleep(15 * time.Millisecond) // kapanış anında süren NextFrame düşürülür
	return r.frames.Load()
}

func TestAC342DesktopChangeUnverifiedIndicatorNoFramesNoInputThenIndicatorFailed(t *testing.T) {
	r := newDeskRig(-1, desktop.DefaultTimeout)
	done, h := r.startStreaming(t)
	start := time.Now()
	paused := r.switchAndWaitPaused(t, "Winlogon")
	h.Input([]byte(`{"t":"key","code":"KeyA","down":true}`))
	waitSent[signal.SessionEnd](t, r.conn)
	if code := waitExit(t, done); code != helperio.ExitIndicatorFailed {
		t.Fatalf("çıkış %d, beklenen indicator_failed", code)
	}
	if el := time.Since(start); el > desktop.DefaultTimeout+DefaultEndGrace+500*time.Millisecond {
		t.Fatalf("oturum %v sonra bitti (2 sn bütçe)", el)
	}
	if got := r.frames.Load() - paused; got != 0 || r.injected.Load() != 0 {
		t.Fatalf("doğrulanmamış masaüstünde kare %d, girdi %d (beklenen 0/0)", got, r.injected.Load())
	}
	if r.resumed.Load() != 0 {
		t.Fatal("kapı açıldı")
	}
}

func TestAC294DesktopChangeRebuildsIndicatorThenResumes(t *testing.T) {
	r := newDeskRig(150*time.Millisecond, time.Second)
	done, h := r.startStreaming(t)
	first := <-r.inds
	paused := r.switchAndWaitPaused(t, "Winlogon")
	h.Input([]byte(`{"t":"key"}`))
	time.Sleep(60 * time.Millisecond) // gösterge hâlâ çiziliyor
	if got := r.frames.Load() - paused; got != 0 || r.injected.Load() != 0 {
		t.Fatalf("doğrulama öncesi kare %d, girdi %d", got, r.injected.Load())
	}
	second := <-r.inds
	until(t, func() bool { return r.frames.Load() > paused })
	if second.desk != "Winlogon" || r.resumed.Load() != 1 {
		t.Fatalf("yeni gösterge %q, Resumed %d", second.desk, r.resumed.Load())
	}
	until(t, first.closed.Load)
	h.Input([]byte(`{"t":"key"}`))
	if r.injected.Load() != 1 {
		t.Fatal("doğrulamadan sonra girdi iletilmedi")
	}
	close(first.failed) // eski (görünmeyen) göstergenin hatası oturumu bitirmez
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	if code := waitExit(t, done); code != helperio.ExitEnded {
		t.Fatalf("çıkış %d", code)
	}
	if !second.closed.Load() {
		t.Fatal("geçerli gösterge kapatılmadı")
	}
}

func TestAC294RebuiltIndicatorFailureEndsSession(t *testing.T) {
	r := newDeskRig(0, time.Second)
	done, _ := r.startStreaming(t)
	<-r.inds
	r.desk.set("Winlogon")
	second := <-r.inds
	until(t, func() bool { return r.resumed.Load() == 1 })
	close(second.failed)
	waitSent[signal.SessionEnd](t, r.conn)
	if code := waitExit(t, done); code != helperio.ExitIndicatorFailed {
		t.Fatalf("çıkış %d", code)
	}
}

func until(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("koşul gerçekleşmedi")
		}
		time.Sleep(time.Millisecond)
	}
}
