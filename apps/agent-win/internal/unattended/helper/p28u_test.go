package helper

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

// syncBuf durum borusu sahtesi.
type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuf) lines() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.Split(strings.TrimSpace(s.b.String()), "\n")
}

func askInput() helperio.Input {
	in := testInput()
	in.Consent, in.Mode = helperio.ConsentAsk, helperio.ModeAsked
	return in
}

func silentInput() helperio.Input {
	in := testInput()
	in.Consent, in.Mode = helperio.ConsentNone, helperio.ModeSilent
	in.IndicatorText, in.IndicatorControl = "Uzaktan izleniyor: Ali — Acme", "Uzaktan kontrol: Ali — Acme"
	return in
}

// labelIndicator etiket değiştirebilen sahte gösterge.
type labelIndicator struct {
	fakeIndicator
	mu    sync.Mutex
	texts []string
}

func (i *labelIndicator) SetText(s string) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.texts = append(i.texts, s)
}

func (i *labelIndicator) last() string {
	i.mu.Lock()
	defer i.mu.Unlock()
	if len(i.texts) == 0 {
		return ""
	}
	return i.texts[len(i.texts)-1]
}

func TestAC431DeniedOrTimeoutNoIndicatorNoDialNoFrames(t *testing.T) {
	for dec, want := range map[string]uint32{helperio.DecisionDenied: helperio.ExitConsentDenied,
		helperio.DecisionTimeout: helperio.ExitConsentTimeout, "bozuk": helperio.ExitConsentDenied} {
		r := newRig(nil)
		var shows, captures atomic.Int32
		show := r.d.ShowIndicator
		r.d.ShowIndicator = func(s string) (Indicator, error) { shows.Add(1); return show(s) }
		r.d.Flow.Capture = func(int) (rtc.Source, error) { captures.Add(1); return fakeSrc{}, nil }
		st := &syncBuf{}
		r.d.Status = st
		r.d.AskConsent = func(context.Context, ConsentSpec) (string, time.Time) { return dec, time.Now() }
		if code := Run(context.Background(), r.d, askInput()); code != want {
			t.Fatalf("%s: çıkış %d, beklenen %d", dec, code, want)
		}
		if shows.Load() != 0 || r.dials.Load() != 0 || captures.Load() != 0 {
			t.Fatalf("%s: gösterge=%d dial=%d kare=%d (hepsi 0 olmalı)", dec, shows.Load(), r.dials.Load(), captures.Load())
		}
		if l := st.lines(); len(l) != 1 || !strings.Contains(l[0], `"ev":"consent"`) {
			t.Fatalf("%s: durum %v", dec, l)
		}
	}
}

func TestAC431GrantedWritesConsentBeforeIndicatorAndDial(t *testing.T) {
	r := newRig(nil)
	st := &syncBuf{}
	r.d.Status = st
	var spec ConsentSpec
	var linesAtShow []string
	show := r.d.ShowIndicator
	r.d.ShowIndicator = func(s string) (Indicator, error) { linesAtShow = st.lines(); return show(s) }
	r.d.AskConsent = func(_ context.Context, sp ConsentSpec) (string, time.Time) {
		spec = sp
		if r.dials.Load() != 0 {
			t.Error("karar öncesi dial")
		}
		return helperio.DecisionGranted, time.Now()
	}
	done := make(chan uint32, 1)
	go func() { done <- Run(context.Background(), r.d, askInput()) }()
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	if code := waitExit(t, done); code != helperio.ExitEnded {
		t.Fatalf("çıkış %d", code)
	}
	if spec.TenantName != "Acme" || spec.TechName != "Ali" || time.Until(spec.Deadline) > ConsentTimeout {
		t.Fatalf("diyalog içeriği %+v", spec)
	}
	if len(linesAtShow) != 1 || !strings.Contains(linesAtShow[0], `"decision":"granted"`) {
		t.Fatalf("gösterge çiziminde durum %v", linesAtShow)
	}
}

func TestAC431NoAskConsentFailsClosed(t *testing.T) {
	r := newRig(nil)
	if code := Run(context.Background(), r.d, askInput()); code != helperio.ExitHelperFailed || r.dials.Load() != 0 {
		t.Fatalf("çıkış %d dial %d", code, r.dials.Load())
	}
}

func TestAC431ConsentStatusWriteFailureNeverDials(t *testing.T) {
	r := newRig(nil)
	r.d.Status = failWriter{}
	r.d.AskConsent = func(context.Context, ConsentSpec) (string, time.Time) { return helperio.DecisionGranted, time.Now() }
	if code := Run(context.Background(), r.d, askInput()); code != helperio.ExitHelperFailed || r.dials.Load() != 0 {
		t.Fatalf("çıkış %d dial %d", code, r.dials.Load())
	}
}

type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New("boru kapalı") }

func TestAC431ConsentMsClampedAndTimeoutDeadline(t *testing.T) {
	t0 := time.Unix(1000, 0)
	clock := t0
	now := func() time.Time { return clock }
	ask := func(ctx context.Context, _ ConsentSpec) (string, time.Time) {
		dl, _ := ctx.Deadline()
		if !dl.Equal(t0.Add(60 * time.Second)) {
			t.Errorf("süre %v (60 sn olmalı)", dl.Sub(t0))
		}
		clock = t0.Add(70 * time.Second)
		return helperio.DecisionTimeout, time.Time{}
	}
	dec, ms := runConsent(context.Background(), ask, askInput(), now)
	if dec != helperio.DecisionTimeout || ms != helperio.MaxConsentMs {
		t.Fatalf("%s %d", dec, ms)
	}
}

func TestAC438SilentIndicatorFailureNoDialNoDialog(t *testing.T) {
	r := newRig(errors.New("çizilemedi"))
	r.d.AskConsent = func(context.Context, ConsentSpec) (string, time.Time) {
		t.Error("silent'ta diyalog açıldı")
		return helperio.DecisionGranted, time.Now()
	}
	if code := Run(context.Background(), r.d, silentInput()); code != helperio.ExitIndicatorFailed || r.dials.Load() != 0 {
		t.Fatalf("çıkış %d dial %d", code, r.dials.Load())
	}
}

func TestAC439SilentLabelControlStatusAndNoSessionLimit(t *testing.T) {
	r := newRig(nil)
	ind := &labelIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}}
	var shown string
	r.d.ShowIndicator = func(s string) (Indicator, error) { shown = s; return ind, nil }
	st := &syncBuf{}
	r.d.Status = st
	in := silentInput()
	done := make(chan uint32, 1)
	go func() { done <- Run(context.Background(), r.d, in) }()
	r.conn.in <- hello()
	for i := 0; i < 7; i++ { // K-P28u-16: 5 geçiş sınırı gözetimsizde yok
		r.conn.in <- signal.ControlRequest{T: "control.request"}
		if s := waitSent[signal.ControlState](t, r.conn); s.State != "GRANTED" {
			t.Fatalf("%d: %+v", i, s)
		}
		waitLabel(t, ind, in.IndicatorControl)
		r.conn.in <- signal.ControlRelease{T: "control.release"}
		waitLabel(t, ind, in.IndicatorText)
	}
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	if code := waitExit(t, done); code != helperio.ExitEnded {
		t.Fatalf("çıkış %d", code)
	}
	if shown != in.IndicatorText {
		t.Fatalf("ilk etiket %q", shown)
	}
	l := st.lines()
	if len(l) != 14 || l[0] != `{"ev":"control","on":true}` || l[1] != `{"ev":"control","on":false}` {
		t.Fatalf("durum satırları %d: %v", len(l), l)
	}
}

func waitLabel(t *testing.T, ind *labelIndicator, want string) {
	t.Helper()
	deadline := time.Now().Add(time.Second) // AC-439: ≤ 1 sn
	for ind.last() != want {
		if time.Now().After(deadline) {
			t.Fatalf("etiket %q, beklenen %q", ind.last(), want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestAC439SilentFileOfferRejectedUntilControl(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := make(chan flow.Event, 4)
	h := newHeadless(ctx, events)
	h.mode, h.st = helperio.ModeSilent, newStatusPipe(nil)
	h.FileOffer(transfer.Prompt{FID: "f1"})
	if ev := <-events; ev.Kind != flow.EvFileReject {
		t.Fatalf("izleme kipinde dosya kabul edildi: %+v", ev)
	}
	h.ControlState(true, "")
	h.FileOffer(transfer.Prompt{FID: "f2"})
	if ev := <-events; ev.Kind != flow.EvFileAccept {
		t.Fatalf("kontrolde dosya reddedildi: %+v", ev)
	}
	a := newHeadless(ctx, events)
	a.mode = helperio.ModeAsked
	a.FileOffer(transfer.Prompt{FID: "f3"})
	if ev := <-events; ev.Kind != flow.EvFileAccept {
		t.Fatalf("asked kipinde dosya reddedildi: %+v", ev)
	}
}

type fakeLocker struct {
	ok     bool
	reason string
	calls  atomic.Int32
}

func (l *fakeLocker) Lock(context.Context) (bool, string) { l.calls.Add(1); return l.ok, l.reason }

func TestAC443LockCommandsReplyWithServiceID(t *testing.T) {
	in := "{\"cmd\":\"lock\",\"id\":\"01JX0000000000000000000001\"}\nbozuk\n" +
		"{\"cmd\":\"lock\",\"id\":\"01JX0000000000000000000002\"}\n"
	st := &syncBuf{}
	lk := &fakeLocker{ok: true}
	serveCommands(context.Background(), bufio.NewReader(strings.NewReader(in)), lk, newStatusPipe(st))
	l := st.lines()
	if lk.calls.Load() != 2 || len(l) != 2 ||
		l[0] != `{"ev":"lock","id":"01JX0000000000000000000001","ok":true}` ||
		!strings.Contains(l[1], "01JX0000000000000000000002") {
		t.Fatalf("%d %v", lk.calls.Load(), l)
	}
	st2 := &syncBuf{}
	serveCommands(context.Background(), bufio.NewReader(strings.NewReader(
		"{\"cmd\":\"lock\",\"id\":\"01JX0000000000000000000003\"}\n")), nil, newStatusPipe(st2))
	if l := st2.lines(); len(l) != 1 || !strings.Contains(l[0], `"ok":false,"reason":"not_locked"`) {
		t.Fatalf("%v", l)
	}
}

func TestAC443StationLockerWaitsForWinlogon(t *testing.T) {
	var n atomic.Int32
	lk := stationLocker{lock: func() error { return nil }, wait: time.Second, interval: 5 * time.Millisecond,
		desktop: func() (string, error) {
			if n.Add(1) > 3 {
				return "Winlogon", nil
			}
			return "Default", nil
		}}
	if ok, r := lk.Lock(context.Background()); !ok || r != "" {
		t.Fatalf("%v %s", ok, r)
	}
	never := stationLocker{lock: func() error { return nil }, wait: 30 * time.Millisecond, interval: 5 * time.Millisecond,
		desktop: func() (string, error) { return "Default", nil }}
	if ok, r := never.Lock(context.Background()); ok || r != helperio.ReasonNotLocked {
		t.Fatalf("%v %s", ok, r)
	}
	fail := stationLocker{lock: func() error { return io.ErrClosedPipe }, wait: time.Second,
		desktop: func() (string, error) { return "Winlogon", nil }}
	if ok, _ := fail.Lock(context.Background()); ok {
		t.Fatal("LockWorkStation hatası başarı sayıldı")
	}
}

// countInjector girdi sayacı (gerçek input.Applier + kontrol kapısı arkasında).
type countInjector struct{ n atomic.Int32 }

func (c *countInjector) Inject(evs []input.Event) error { c.n.Add(int32(len(evs))); return nil }

// inputRig gerçek Applier'ı akışın kapısına bağlar ve peer'e verilen girdi işleyicisini yakalar.
func inputRig(r *rig) (*countInjector, chan func([]byte)) {
	gate := &control.Gate{}
	inj := &countInjector{}
	ap := input.NewApplier(gate, inj, nil)
	ap.SetTarget(control.Rect{Right: 1920, Bottom: 1080}, control.Rect{Right: 1920, Bottom: 1080})
	r.d.Flow.Gate, r.d.Flow.Input = gate, ap.Handle
	handlers := make(chan func([]byte), 1)
	r.d.Flow.NewPeer = func(_ []signal.IceServer, _ []string, h rtc.Handlers) (flow.Peer, error) {
		handlers <- h.Input
		return fakePeer{}, nil
	}
	return inj, handlers
}

var moveMsg = []byte(`{"t":"m.move","x":0.5,"y":0.5}`)

func TestAC439SilentMonitoringInputCountZeroUntilGranted(t *testing.T) {
	r := newRig(nil)
	r.d.ShowIndicator = func(string) (Indicator, error) {
		return &labelIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}}, nil
	}
	inj, handlers := inputRig(r)
	done := make(chan uint32, 1)
	go func() { done <- Run(context.Background(), r.d, silentInput()) }()
	r.conn.in <- hello()
	var send func([]byte)
	select {
	case send = <-handlers:
	case <-time.After(3 * time.Second):
		t.Fatal("peer kurulmadı")
	}
	for i := 0; i < 5; i++ {
		send(moveMsg)
	}
	if inj.n.Load() != 0 {
		t.Fatalf("izleme kipinde girdi uygulandı: %d", inj.n.Load())
	}
	r.conn.in <- signal.ControlRequest{T: "control.request"}
	waitSent[signal.ControlState](t, r.conn)
	send(moveMsg)
	if inj.n.Load() == 0 {
		t.Fatal("kontrol verildikten sonra girdi uygulanmadı (test düzeneği)")
	}
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	waitExit(t, done)
}

func TestAC431DeniedInputAndFrameCountZero(t *testing.T) {
	r := newRig(nil)
	inj, handlers := inputRig(r)
	var captures atomic.Int32
	r.d.Flow.Capture = func(int) (rtc.Source, error) { captures.Add(1); return fakeSrc{}, nil }
	r.d.AskConsent = func(context.Context, ConsentSpec) (string, time.Time) { return helperio.DecisionDenied, time.Now() }
	if code := Run(context.Background(), r.d, askInput()); code != helperio.ExitConsentDenied {
		t.Fatalf("çıkış %d", code)
	}
	if len(handlers) != 0 || inj.n.Load() != 0 || captures.Load() != 0 || r.dials.Load() != 0 {
		t.Fatalf("karar öncesi/ret: peer=%d girdi=%d kare=%d dial=%d", len(handlers), inj.n.Load(), captures.Load(), r.dials.Load())
	}
}

func TestAC431DialogFailedIsHelperFailedWithoutConsentEvent(t *testing.T) {
	r := newRig(nil)
	st := &syncBuf{}
	r.d.Status = st
	r.d.AskConsent = func(context.Context, ConsentSpec) (string, time.Time) { return decisionFailed, time.Time{} }
	if code := Run(context.Background(), r.d, askInput()); code != helperio.ExitHelperFailed || r.dials.Load() != 0 {
		t.Fatalf("çıkış %d", code)
	}
	if l := st.lines(); len(l) != 1 || l[0] != "" {
		t.Fatalf("durum yazıldı: %v", l)
	}
}

func TestAC439P27InputWritesNoStatusEvents(t *testing.T) {
	r := newRig(nil)
	st := &syncBuf{}
	r.d.Status = st
	done := runAsync(r) // testInput: Consent "" (eski sunucu)
	r.conn.in <- hello()
	r.conn.in <- signal.ControlRequest{T: "control.request"}
	waitSent[signal.ControlState](t, r.conn)
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	waitExit(t, done)
	if l := st.lines(); len(l) != 1 || l[0] != "" {
		t.Fatalf("P27 girdisinde durum yazıldı: %v", l)
	}
}
