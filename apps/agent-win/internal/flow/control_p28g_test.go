package flow

import (
	"sync/atomic"
	"testing"

	"remote-support/agent-win/internal/signal"
)

// AC-399 / S-P28g-12: Linux'ta kontrol koşulları yoksa (Wayland izni, kilit kısayolu koruması, D-Bus, XTEST kimliği)
// teknisyene VIEW{WAYLAND_NO_CONTROL} gider (sunucu Linux'tan OS_PERMISSION'ı yok sayar); diyalog açılmaz.
func TestAC399P28gNoControlSourceLinux(t *testing.T) {
	var ready atomic.Bool
	var guides atomic.Int32
	cs := startControlReadyWith(t, &ready, &guides, func(h *harness) { h.deps.NoControlSource = "WAYLAND_NO_CONTROL" })
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectControl(t, cs.c, "VIEW", "WAYLAND_NO_CONTROL")
	if cs.gate.IsOpen() {
		t.Fatal("kapı açılmamalı")
	}
}

// §5.2b m.1: kilit ekranı → input kapıyı kapatır, akış VIEW{SYSTEM} ve Linux metni.
func TestAC399P28gControlLostTextLinux(t *testing.T) {
	var ready atomic.Bool
	var guides atomic.Int32
	ready.Store(true)
	cs := startControlReadyWith(t, &ready, &guides, func(h *harness) { h.deps.ControlLostText = LinuxTexts.ControlLost })
	cs.c.toClient <- signal.ControlRequest{T: "control.request"}
	expectCall(t, cs.h.ui, "ctlreq:Ali Teknisyen:Control+Shift+F12")
	cs.h.events <- Event{Kind: EvControlGrant}
	expectControl(t, cs.c, "GRANTED", "UI")
	cs.gate.Shut(nil)
	cs.h.events <- Event{Kind: EvControlSystem}
	expectControl(t, cs.c, "VIEW", "SYSTEM")
	expectCall(t, cs.h.ui, "status:"+LinuxTexts.ControlLost)
}
