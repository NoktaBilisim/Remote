package helper

import (
	"context"
	"testing"
	"time"

	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

func nextEvent(t *testing.T, ch <-chan flow.Event) flow.Event {
	t.Helper()
	select {
	case ev := <-ch:
		return ev
	case <-time.After(2 * time.Second):
		t.Fatal("olay yok")
		return flow.Event{}
	}
}

// AC-273 (kapsam notu): dosya teklifi ve monitör isteği arayüzsüz otomatik kabul; kontrol isteği arayüze düşerse ret.
func TestAC273HeadlessAutoDecisions(t *testing.T) {
	ch := make(chan flow.Event, 4)
	h := newHeadless(context.Background(), ch)
	h.FileOffer(transfer.Prompt{FID: "f1"})
	if ev := nextEvent(t, ch); ev.Kind != flow.EvFileAccept || ev.FID != "f1" {
		t.Fatalf("dosya: %+v", ev)
	}
	h.MonitorRequest(signal.Monitor{ID: 2})
	if ev := nextEvent(t, ch); ev.Kind != flow.EvMonitorAccept || ev.Monitor != 2 {
		t.Fatalf("monitör: %+v", ev)
	}
	h.ControlRequest(flow.ControlPrompt{})
	if ev := nextEvent(t, ch); ev.Kind != flow.EvControlDeny {
		t.Fatalf("kontrol: %+v", ev)
	}
	c, ok := h.ChooseShare(context.Background(), nil, 3, true)
	if !ok || c.Monitor != 3 || c.Window != 0 {
		t.Fatalf("paylaşım: %+v %v", c, ok)
	}
	if _, ok := h.AskCode(context.Background(), ""); ok {
		t.Fatal("kod sorulmamalı")
	}
}

func TestHeadlessPushStopsAfterContextEnd(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	h := newHeadless(ctx, make(chan flow.Event)) // alıcısız
	cancel()
	h.FileOffer(transfer.Prompt{FID: "x"}) // goroutine bağlamla biter (race/leak yok)
}
