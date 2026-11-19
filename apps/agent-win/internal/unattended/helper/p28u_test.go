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

// directInput r3 servis girdisi: tek kip no_user (kullanıcıya sorulmaz).
func directInput() helperio.Input {
	in := testInput()
	in.Consent, in.Mode = helperio.ConsentNone, helperio.ModeNoUser
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

// AC-433 / AC-438 (r3): diyalog yok; gösterge sunucu metniyle /ws/guest'ten önce çizilir, kontrol isteği anında
// GRANTED; etiket kontrolle değişmez; durum borusuna yalnız control olayları yazılır (consent yok); gözetimsizde
// K-P28u-16 geçiş sınırı yok.
func TestAC433NoDialogIndicatorFirstControlGrantedLabelFixed(t *testing.T) {
	r := newRig(nil)
	ind := &labelIndicator{fakeIndicator: fakeIndicator{failed: make(chan struct{})}}
	var shown string
	r.d.ShowIndicator = func(s string) (Indicator, error) {
		if r.dials.Load() != 0 {
			t.Error("gösterge öncesi dial")
		}
		shown = s
		return ind, nil
	}
	st := &syncBuf{}
	r.d.Status = st
	in := directInput()
	done := make(chan uint32, 1)
	go func() { done <- Run(context.Background(), r.d, in) }()
	r.conn.in <- hello()
	for i := 0; i < 7; i++ {
		r.conn.in <- signal.ControlRequest{T: "control.request"}
		if s := waitSent[signal.ControlState](t, r.conn); s.State != "GRANTED" {
			t.Fatalf("%d: %+v", i, s)
		}
		r.conn.in <- signal.ControlRelease{T: "control.release"}
		waitLines(t, st, 2*(i+1))
	}
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	if code := waitExit(t, done); code != helperio.ExitEnded {
		t.Fatalf("çıkış %d", code)
	}
	if shown != in.IndicatorText {
		t.Fatalf("ilk etiket %q", shown)
	}
	if len(ind.texts) != 0 {
		t.Fatalf("etiket kontrolle değişti: %v", ind.texts)
	}
	l := st.lines()
	if len(l) != 14 || l[0] != `{"ev":"control","on":true}` || l[1] != `{"ev":"control","on":false}` {
		t.Fatalf("durum satırları %d: %v", len(l), l)
	}
	for _, x := range l {
		if strings.Contains(x, "consent") {
			t.Fatalf("consent olayı yazıldı: %v", l)
		}
	}
}

func waitLines(t *testing.T, st *syncBuf, n int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for len(st.lines()) < n || st.lines()[0] == "" {
		if time.Now().After(deadline) {
			t.Fatalf("durum satırı %d, beklenen %d: %v", len(st.lines()), n, st.lines())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// AC-438 (r3, KORUNUR): gösterge çizilemezse bağlantı açılmaz — kullanıcı durumu ne olursa olsun.
func TestAC438IndicatorFailureNoDial(t *testing.T) {
	r := newRig(errors.New("çizilemedi"))
	if code := Run(context.Background(), r.d, directInput()); code != helperio.ExitIndicatorFailed || r.dials.Load() != 0 {
		t.Fatalf("çıkış %d dial %d", code, r.dials.Load())
	}
}

// AC-433 (r3): izleme kipi yok — dosya teklifi kontrol açık olmasa da kabul edilir (P27).
func TestAC433FileOfferAcceptedWithoutControl(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := make(chan flow.Event, 4)
	h := newHeadless(ctx, events)
	h.st = newStatusPipe(nil)
	h.FileOffer(transfer.Prompt{FID: "f1"})
	if ev := <-events; ev.Kind != flow.EvFileAccept {
		t.Fatalf("dosya reddedildi: %+v", ev)
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
	serveCommands(context.Background(), bufio.NewReader(strings.NewReader(in)), lk, newStatusPipe(st), nil)
	l := st.lines()
	if lk.calls.Load() != 2 || len(l) != 2 ||
		l[0] != `{"ev":"lock","id":"01JX0000000000000000000001","ok":true}` ||
		!strings.Contains(l[1], "01JX0000000000000000000002") {
		t.Fatalf("%d %v", lk.calls.Load(), l)
	}
	st2 := &syncBuf{}
	serveCommands(context.Background(), bufio.NewReader(strings.NewReader(
		"{\"cmd\":\"lock\",\"id\":\"01JX0000000000000000000003\"}\n")), nil, newStatusPipe(st2), nil)
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

// AC-433 (r3): girdi yalnız kontrol verildikten sonra uygulanır (kapı korunur); kontrol isteği anında verilir.
func TestAC433InputAppliedOnlyAfterImmediateGrant(t *testing.T) {
	r := newRig(nil)
	inj, handlers := inputRig(r)
	done := make(chan uint32, 1)
	go func() { done <- Run(context.Background(), r.d, directInput()) }()
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
		t.Fatalf("kontrol isteği olmadan girdi uygulandı: %d", inj.n.Load())
	}
	r.conn.in <- signal.ControlRequest{T: "control.request"}
	if s := waitSent[signal.ControlState](t, r.conn); s.State != "GRANTED" {
		t.Fatalf("kontrol %+v", s)
	}
	send(moveMsg)
	if inj.n.Load() == 0 {
		t.Fatal("kontrol verildikten sonra girdi uygulanmadı")
	}
	r.conn.in <- signal.SessionEnded{T: "session.ended", Reason: "ENDED"}
	waitExit(t, done)
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
