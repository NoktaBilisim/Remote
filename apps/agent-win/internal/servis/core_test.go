package servis

import (
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/servis/helperio"
)

type memSwitch struct {
	mu sync.Mutex
	on bool
}

func (s *memSwitch) Enabled() (bool, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.on, nil }
func (s *memSwitch) Disable() error         { s.mu.Lock(); s.on = false; s.mu.Unlock(); return nil }

type fakeProc struct {
	done chan uint32
	once sync.Once
}

func (p *fakeProc) Wait() uint32 { return <-p.done }
func (p *fakeProc) Kill() error {
	p.once.Do(func() { p.done <- helperio.ExitKilledByService })
	return nil
}
func (p *fakeProc) exit(code uint32) { p.once.Do(func() { p.done <- code }) }

type fakeLauncher struct {
	mu       sync.Mutex
	procs    []*fakeProc
	inputs   []helperio.Input
	err      error
	launched atomic.Int32
}

func (l *fakeLauncher) Launch(in helperio.Input) (Process, error) {
	if l.err != nil {
		return nil, l.err
	}
	p := &fakeProc{done: make(chan uint32, 1)}
	l.mu.Lock()
	l.procs, l.inputs = append(l.procs, p), append(l.inputs, in)
	l.mu.Unlock()
	l.launched.Add(1)
	return p, nil
}

type memEvents struct {
	mu  sync.Mutex
	evs []Event
}

func (m *memEvents) Write(e Event) { m.mu.Lock(); m.evs = append(m.evs, e); m.mu.Unlock() }
func (m *memEvents) ids() []uint32 {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []uint32
	for _, e := range m.evs {
		out = append(out, e.ID)
	}
	return out
}

type sent struct {
	mu   sync.Mutex
	msgs []any
}

func (s *sent) send(m any) { s.mu.Lock(); s.msgs = append(s.msgs, m); s.mu.Unlock() }
func (s *sent) all() []any { s.mu.Lock(); defer s.mu.Unlock(); return append([]any(nil), s.msgs...) }

func newCore(on bool) (*Core, *fakeLauncher, *memSwitch, *sent, *memEvents) {
	sw, l, out, ev := &memSwitch{on: on}, &fakeLauncher{}, &sent{}, &memEvents{}
	c := &Core{Switch: sw, Launch: l, Events: ev, Send: out.send}
	c.Init()
	return c, l, sw, out, ev
}

const sid = "01JD0000000000000000000002"

func connectMsg() *Connect {
	return &Connect{SessionID: sid, Ticket: "OSTHxpIxRYOEvsy1t7jssmOfVM9-lMgf5dSNuly4uso", TechName: "Mehmet",
		TenantName: "Nokta Destek", TechIP: "203.0.113.7", ExpiresInSec: 60, IndicatorText: "Uzaktan bağlantı: Mehmet — Nokta Destek"}
}

func waitInactive(t *testing.T, c *Core) {
	t.Helper()
	for i := 0; i < 200 && c.Active(); i++ {
		time.Sleep(5 * time.Millisecond)
	}
	if c.Active() {
		t.Fatal("yardımcı kaydı temizlenmedi")
	}
}

func TestAC273ConnectLaunchesHelperWithPipeInput(t *testing.T) {
	c, l, _, _, ev := newCore(true)
	c.Connect(connectMsg())
	if l.launched.Load() != 1 || !c.Active() {
		t.Fatal("yardımcı başlamadı")
	}
	in := l.inputs[0]
	if in.Ticket == "" || in.IndicatorText == "" || in.Validate() != nil {
		t.Fatalf("yardımcı girdisi: %+v", in)
	}
	if ids := ev.ids(); len(ids) != 1 || ids[0] != EvStarted {
		t.Fatalf("olay 1001 yok: %v", ids)
	}
	for _, e := range ev.evs {
		if strings.Contains(e.Text, in.Ticket) {
			t.Fatal("bilet olay günlüğüne yazıldı")
		}
	}
	l.procs[0].exit(helperio.ExitEnded)
	waitInactive(t, c)
}

func TestAC295ConnectRejectedWhenLocalDisabled(t *testing.T) {
	c, l, _, out, _ := newCore(false)
	c.Connect(connectMsg())
	if l.launched.Load() != 0 {
		t.Fatal("kapalıyken yardımcı başladı")
	}
	r, ok := out.all()[0].(*ConnectResult)
	if !ok || r.OK || r.Reason != RejectLocalDisabled {
		t.Fatalf("ret = %+v", out.all())
	}
}

func TestAC338SecondConnectBusyAndNoConsole(t *testing.T) {
	c, l, _, out, _ := newCore(true)
	c.Connect(connectMsg())
	c.Connect(connectMsg())
	if r, ok := out.all()[0].(*ConnectResult); !ok || r.Reason != RejectBusy {
		t.Fatalf("ikinci istek = %+v", out.all())
	}
	l.procs[0].exit(helperio.ExitEnded)
	waitInactive(t, c)
	// watch kaydı Closed gönderilmeden önce temizler: Closed'ı bekle, yoksa üçüncü isteğin yanıtıyla yarışır.
	waitSent(t, out, func(m any) bool { _, ok := m.(*Closed); return ok })
	l.err = ErrNoConsole
	c.Connect(connectMsg())
	msgs := out.all()
	if r, ok := msgs[len(msgs)-1].(*ConnectResult); !ok || r.Reason != helperio.ReasonNoConsole {
		t.Fatalf("konsolsuz = %+v", msgs)
	}
}

// waitSent match eden bir mesaj gönderilene kadar bekler (≤ 1 sn).
func waitSent(t *testing.T, out *sent, match func(any) bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		for _, m := range out.all() {
			if match(m) {
				return
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("beklenen mesaj gelmedi: %+v", out.all())
}

func TestAC294IndicatorFailedReportsConnectResult(t *testing.T) {
	c, l, _, out, _ := newCore(true)
	c.Connect(connectMsg())
	l.procs[0].exit(helperio.ExitIndicatorFailed)
	waitInactive(t, c)
	waitSent(t, out, func(m any) bool { _, ok := m.(*Closed); return ok })
	msgs := out.all()
	r, ok1 := msgs[0].(*ConnectResult)
	cl, ok2 := msgs[1].(*Closed)
	if !ok1 || !ok2 || r.Reason != helperio.ReasonIndicatorFailed || cl.Reason != helperio.ReasonIndicatorFailed {
		t.Fatalf("mesajlar = %+v", msgs)
	}
}

// O-P27-2 d: "kapatıldı" yanıtından sonra yeni yardımcı başlayamaz (sahte başlatıcı + eşzamanlı disable).
func TestAC295DisableRaceNoHelperAfterDisable(t *testing.T) {
	for i := 0; i < 200; i++ {
		c, l, _, _, _ := newCore(true)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); c.Connect(connectMsg()) }()
		var afterDisable int32
		go func() {
			defer wg.Done()
			if err := c.Disable(`PC\kullanici`); err != nil {
				t.Error(err)
			}
			afterDisable = l.launched.Load()
		}()
		wg.Wait()
		c.Connect(connectMsg())
		if l.launched.Load() != afterDisable {
			t.Fatal("disable sonrası yardımcı başladı")
		}
		waitInactive(t, c) // başlamışsa disable kesti
	}
}

func TestAC295DisableKillsHelperAndNotifies(t *testing.T) {
	c, _, sw, out, ev := newCore(true)
	c.Connect(connectMsg())
	start := time.Now()
	if err := c.Disable(`PC\ayse`); err != nil {
		t.Fatal(err)
	}
	waitInactive(t, c)
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("kesme %v sürdü (≤ 2 sn)", d)
	}
	if on, _ := sw.Enabled(); on {
		t.Fatal("değer yazılmadı")
	}
	var state, closed bool
	for _, m := range out.all() {
		switch v := m.(type) {
		case *State:
			state = !v.LocalEnabled
		case *Closed:
			closed = v.Reason == KillLocalDisabled
		}
	}
	if !state || !closed {
		t.Fatalf("device.state/session.closed eksik: %+v", out.all())
	}
	c.LocalChanged() // izleyici aynı değişikliği bildirir: çift olay yok
	n := 0
	for _, id := range ev.ids() {
		if id == EvLocal {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("olay 1003 sayısı %d", n)
	}
}

func TestAC295RegistryChangeEnables(t *testing.T) {
	c, _, sw, out, _ := newCore(false)
	sw.on = true
	c.LocalChanged()
	if s, ok := out.all()[0].(*State); !ok || !s.LocalEnabled {
		t.Fatalf("açılma bildirilmedi: %+v", out.all())
	}
}

func TestDisconnectAndKillReasons(t *testing.T) {
	c, _, _, out, _ := newCore(true)
	c.Connect(connectMsg())
	c.Disconnect(&Disconnect{SessionID: "01JD0000000000000000000009", Reason: "server"})
	if !c.Active() {
		t.Fatal("başka oturumun disconnect'i yardımcıyı kesti")
	}
	c.Disconnect(&Disconnect{SessionID: sid, Reason: "device_revoked"})
	waitInactive(t, c)
	waitSent(t, out, func(m any) bool { _, ok := m.(*Closed); return ok })
	msgs := out.all()
	if cl, ok := msgs[len(msgs)-1].(*Closed); !ok || cl.Reason != KillServer {
		t.Fatalf("mesajlar = %+v", msgs)
	}
	if st, tech := c.Status(); st != "offline" || tech != "" {
		t.Fatalf("status = %s %s", st, tech)
	}
}

func TestUnregisterNeedsHook(t *testing.T) {
	c, _, _, _, _ := newCore(true)
	if err := c.Unregister(); err == nil {
		t.Fatal("kancasız unregister başarılı")
	}
	called := false
	c.OnUnregister = func() error { called = true; return nil }
	if err := c.Unregister(); err != nil || !called {
		t.Fatal("kanca çağrılmadı")
	}
	c.Switch = errSwitch{}
	if c.LocalEnabled() {
		t.Fatal("okunamayan değer açık sayıldı (fail-closed)")
	}
}

type errSwitch struct{}

func (errSwitch) Enabled() (bool, error) { return true, errors.New("okunamadı") }
func (errSwitch) Disable() error         { return errors.New("yazılamadı") }
