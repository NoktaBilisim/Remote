package helper

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
)

// --- sahteler ---

type fakeConn struct {
	in     chan signal.Inbound
	sent   chan signal.Outbound
	closed chan struct{}
	once   sync.Once
}

func newConn() *fakeConn {
	return &fakeConn{in: make(chan signal.Inbound, 8), sent: make(chan signal.Outbound, 32), closed: make(chan struct{})}
}

func (c *fakeConn) Read(ctx context.Context) (signal.Inbound, error) {
	select {
	case m := <-c.in:
		return m, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.closed:
		return nil, errors.New("kapalı")
	}
}

func (c *fakeConn) Send(_ context.Context, m signal.Outbound) error {
	if _, ok := m.(signal.EnvState); !ok {
		c.sent <- m
	}
	return nil
}

func (c *fakeConn) Close() error { c.once.Do(func() { close(c.closed) }); return nil }

type fakePeer struct{}

func (fakePeer) HandleOffer(string) (signal.SdpAnswer, error) { return signal.SdpAnswer{}, nil }
func (fakePeer) AddRemoteICE(signal.RemoteIce) error          { return nil }
func (fakePeer) SetICEServers([]signal.IceServer) error       { return nil }
func (fakePeer) SendCtl([]byte) error                         { return nil }
func (fakePeer) SetCaps([]string)                             {}
func (fakePeer) SetMain(bool) error                           { return nil }
func (fakePeer) Close() error                                 { return nil }

// fakeMedia P28c paylaşılan iz çifti: yayın ctx bitene dek sürer.
type fakeMedia struct{}

func (fakeMedia) Stream(ctx context.Context, _ rtc.Source) error {
	<-ctx.Done()
	return ctx.Err()
}
func (fakeMedia) SetLow(bool) {}

type fakeSrc struct{}

func (fakeSrc) NextFrame(ctx context.Context) (rtc.Frame, error) {
	<-ctx.Done()
	return rtc.Frame{}, ctx.Err()
}
func (fakeSrc) Close() error { return nil }

type fakeIndicator struct {
	failed chan struct{}
	closed atomic.Bool
}

func (i *fakeIndicator) Failed() <-chan struct{} { return i.failed }
func (i *fakeIndicator) Desktop() string         { return "Default" }
func (i *fakeIndicator) Close()                  { i.closed.Store(true) }

type rig struct {
	conn  *fakeConn
	dials atomic.Int32
	ind   *fakeIndicator
	d     Deps
}

func newRig(indErr error) *rig {
	r := &rig{conn: newConn(), ind: &fakeIndicator{failed: make(chan struct{})}}
	r.d = Deps{
		ShowIndicator: func(string) (Indicator, error) {
			if indErr != nil {
				return nil, indErr
			}
			return r.ind, nil
		},
		InputDesktop: func() (string, error) { return "Default", nil },
		Flow: flow.Deps{
			Dial: func(context.Context, signal.Credential) (flow.Conn, error) {
				r.dials.Add(1)
				return r.conn, nil
			},
			NewPeer:     func([]signal.IceServer, []string, rtc.Handlers) (flow.Peer, error) { return fakePeer{}, nil },
			Media:       fakeMedia{},
			Monitors:    func() ([]signal.Monitor, error) { return []signal.Monitor{{ID: 0, Primary: true}}, nil },
			Capture:     func(int) (rtc.Source, error) { return fakeSrc{}, nil },
			DownloadDir: func() (string, error) { return "", errors.New("yok") },
			MOTW:        func(string) error { return nil },
		},
		EndGrace: 200 * time.Millisecond,
	}
	return r
}

func testInput() helperio.Input {
	return helperio.Input{V: 1, SessionID: "01JX0000000000000000000000", Ticket: "tabcdefghijklmnopqrstuvwxyz0123456789ABCDEF",
		TechName: "Ali", TenantName: "Acme", IndicatorText: "TEST — imzasız · Uzaktan bağlantı: Ali — Acme", ExpiresInSec: 60}
}

func runAsync(r *rig) chan uint32 {
	done := make(chan uint32, 1)
	go func() { done <- Run(context.Background(), r.d, testInput()) }()
	return done
}

func waitExit(t *testing.T, done chan uint32) uint32 {
	t.Helper()
	select {
	case c := <-done:
		return c
	case <-time.After(5 * time.Second):
		t.Fatal("yardımcı bitmedi")
		return 0
	}
}

// waitSent tür eşleşen ilk giden mesaj.
func waitSent[T signal.Outbound](t *testing.T, c *fakeConn) T {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case m := <-c.sent:
			if v, ok := m.(T); ok {
				return v
			}
		case <-deadline:
			var zero T
			t.Fatalf("%T gönderilmedi", zero)
			return zero
		}
	}
}

func hello() signal.Hello {
	return signal.Hello{T: "hello", Role: "guest", SessionID: "s", Caps: []string{"remote_control"}}
}

// --- testler ---

func TestAC294IndicatorFailureNeverDialsGuest(t *testing.T) {
	r := newRig(errors.New("çizilemedi"))
	if code := Run(context.Background(), r.d, testInput()); code != helperio.ExitIndicatorFailed {
		t.Fatalf("çıkış %d, beklenen %d", code, helperio.ExitIndicatorFailed)
	}
	if n := r.dials.Load(); n != 0 {
		t.Fatalf("/ws/guest %d kez çağrıldı", n)
	}
	if helperio.Reason(helperio.ExitIndicatorFailed) != "indicator_failed" {
		t.Fatal("neden eşlemesi")
	}
}

func TestAC294IndicatorShownWithServerTextBeforeDial(t *testing.T) {
	r := newRig(nil)
	var got string
	var dialsAtShow int32 = -1
	show := r.d.ShowIndicator
	r.d.ShowIndicator = func(text string) (Indicator, error) {
		got, dialsAtShow = text, r.dials.Load()
		return show(text)
	}
	done := runAsync(r)
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	if code := waitExit(t, done); code != helperio.ExitEnded {
		t.Fatalf("çıkış %d", code)
	}
	if got != testInput().IndicatorText || dialsAtShow != 0 {
		t.Fatalf("gösterge metni %q (AC-342 TEST öneki sunucudan aynen), çizimde dial=%d", got, dialsAtShow)
	}
	if !r.ind.closed.Load() {
		t.Fatal("gösterge kapatılmadı")
	}
}

func TestAC273ControlRequestGrantedUnattendedWithoutUI(t *testing.T) {
	r := newRig(nil)
	done := runAsync(r)
	r.conn.in <- hello()
	r.conn.in <- signal.ControlRequest{T: "control.request"}
	st := waitSent[signal.ControlState](t, r.conn)
	if st.State != "GRANTED" || st.Source != "UNATTENDED" {
		t.Fatalf("control.state %+v", st)
	}
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	if code := waitExit(t, done); code != helperio.ExitEnded {
		t.Fatalf("çıkış %d", code)
	}
}

func TestAC294IndicatorLostDuringSessionEndsWithIndicatorFailed(t *testing.T) {
	r := newRig(nil)
	done := runAsync(r)
	r.conn.in <- hello()
	waitSent[signal.ShareState](t, r.conn)
	close(r.ind.failed)
	waitSent[signal.SessionEnd](t, r.conn)
	if code := waitExit(t, done); code != helperio.ExitIndicatorFailed {
		t.Fatalf("çıkış %d", code)
	}
}

func TestAC273DialFailureBeforeJoinIsHelperFailed(t *testing.T) {
	r := newRig(nil)
	r.d.Flow.Dial = func(context.Context, signal.Credential) (flow.Conn, error) { return nil, errors.New("ağ") }
	if code := Run(context.Background(), r.d, testInput()); code != helperio.ExitHelperFailed {
		t.Fatalf("çıkış %d", code)
	}
}

func TestAC273UnattendedDepsStripUserFacingParts(t *testing.T) {
	d := flow.Deps{Hotkey: "Ctrl+Shift+F12", WindowCapture: func() bool { return true }}
	got := unattendedDeps(d, &headless{}, make(chan flow.Event), func() {})
	if !got.Unattended || got.Hotkey != "" || got.WindowCapture != nil || got.API != nil || got.Binding != nil {
		t.Fatalf("gözetimsiz bağımlılıklar: %+v", got)
	}
}
