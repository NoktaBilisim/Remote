package flow

import (
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/signal"
)

// startControlReady startControl gibi; ControlReady/AccessGuide (P28f K3) bağlı.
func startControlReady(t *testing.T, ready *atomic.Bool, guides *atomic.Int32) *ctlSession {
	t.Helper()
	h := newHarness(t)
	cs := &ctlSession{h: h, gate: &control.Gate{}, clk: &clock{t: time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)}}
	h.deps.Gate, h.deps.Hotkey, h.deps.Now = cs.gate, "Control+Shift+F12", cs.clk.now
	h.deps.ControlReady = ready.Load
	h.deps.AccessGuide = func() { guides.Add(1) }
	cs.out = start(h, "12345678")
	recv(t, h.creds)
	cs.c = recv(t, h.conns)
	hl := hello(token)
	hl.Caps = []string{"remote_control"}
	cs.c.toClient <- hl
	cs.peer = recv(t, h.peers)
	if sh := recv(t, cs.c.sent).(signal.ShareState); sh.State != "sharing" {
		t.Fatalf("%+v", sh)
	}
	return cs
}

// AC-391 / S-P28f-10: izin (ya da musluk) yoksa kontrol diyaloğu açılmaz, teknisyene VIEW{OS_PERMISSION} gider, rehber
// açılır; ret sayılmaz → izin verilince yeni istek 30 sn beklemeden diyalog açar.
func TestAC391NoOSPermissionSendsOSPermissionWithoutCooldown(t *testing.T) {
	var ready atomic.Bool
	var guides atomic.Int32
	cs := startControlReady(t, &ready, &guides)
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectControl(t, cs.c, "VIEW", "OS_PERMISSION")
	if guides.Load() != 1 {
		t.Fatalf("izin rehberi bir kez açılmalı, %d", guides.Load())
	}
	cs.h.events <- Event{Kind: EvControlGrant} // bekleyen istek yok → yok sayılır
	noSend(t, cs.c)
	if cs.gate.IsOpen() {
		t.Fatal("izinsiz kapı açılmamalı")
	}
	ready.Store(true)
	cs.clk.add(time.Second) // 30 sn ret beklemesi YOK
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:Control+Shift+F12")
	cs.h.events <- Event{Kind: EvControlGrant}
	expectControl(t, cs.c, "GRANTED", "UI")
}

// AC-391: izin istek ile "İzin ver" arasında geri alındıysa kapı açılmaz, OS_PERMISSION gider.
func TestAC391PermissionRevokedBeforeGrant(t *testing.T) {
	var ready atomic.Bool
	var guides atomic.Int32
	ready.Store(true)
	cs := startControlReady(t, &ready, &guides)
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:Control+Shift+F12")
	ready.Store(false)
	cs.h.events <- Event{Kind: EvControlGrant}
	expectControl(t, cs.c, "VIEW", "OS_PERMISSION")
	if cs.gate.IsOpen() || guides.Load() != 1 {
		t.Fatalf("kapı açık=%v rehber=%d", cs.gate.IsOpen(), guides.Load())
	}
}

// S-P28f-10 / AC-101: musluk sistemce kapatılıp açılamayınca input.Host kapıyı kapatır; akış VIEW{SYSTEM} bildirir.
func TestAC101ControlSystemCloseReportsSystem(t *testing.T) {
	var ready atomic.Bool
	var guides atomic.Int32
	ready.Store(true)
	cs := startControlReady(t, &ready, &guides)
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:Control+Shift+F12")
	cs.h.events <- Event{Kind: EvControlGrant}
	expectControl(t, cs.c, "GRANTED", "UI")
	cs.gate.Shut(nil) // input.Host: kapı atomik kapanır
	cs.h.events <- Event{Kind: EvControlSystem}
	expectControl(t, cs.c, "VIEW", "SYSTEM")
	expectCall(t, cs.h.ui, "status:"+MacTexts.ControlLost)
	// kontrol verilmemişken gelen olay bildirim üretmez
	cs.h.events <- Event{Kind: EvControlSystem}
	noSend(t, cs.c)
}
