package helper

import (
	"context"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

// headless flow.UI'nin gözetimsiz uygulaması (mimari-p27 §5.6): ekran yok; kararlar otomatiktir ve akışa olay olarak
// döner. Dosya teklifi → kabul (hedef `Gelen`), monitör isteği → kabul, paylaşım seçimi → birincil monitör. Kontrol
// isteği akışta (flow.Deps.Unattended) doğrudan GRANTED{UNATTENDED} olur; buraya düşerse fail-closed ret.
// Sohbet ve işaretleme gösterilmez (sohbet paneli yok — §5.6).
type headless struct {
	ctx    context.Context
	events chan<- flow.Event
}

func newHeadless(ctx context.Context, events chan<- flow.Event) *headless {
	return &headless{ctx: ctx, events: events}
}

// push olayı akış döngüsüne iletir. UI çağrıları döngünün kendisinden geldiği için gönderim ayrı goroutine'dedir
// (döngü kendi kanalına yazarken kilitlenmez); bağlam bitince bırakılır.
func (h *headless) push(ev flow.Event) {
	go func() {
		select {
		case h.events <- ev:
		case <-h.ctx.Done():
		}
	}()
}

func (h *headless) AskCode(context.Context, string) (string, bool)       { return "", false }
func (h *headless) Welcome(context.Context, flow.Welcome) (string, bool) { return "", false }
func (h *headless) Lobby(string, string)                                 {}
func (h *headless) Connecting(string)                                    {}
func (h *headless) Active(string, signal.Monitor)                        {}
func (h *headless) Status(string)                                        {}
func (h *headless) Chat(string)                                          {}
func (h *headless) Annot(dc.Ctl)                                         {}
func (h *headless) FileOfferWithdrawn(string)                            {}
func (h *headless) FileProgress(int64, int64)                            {}
func (h *headless) FileResult(transfer.Result)                           {}
func (h *headless) Ended(flow.Message)                                   {}
func (h *headless) ControlPromptClosed()                                 {}
func (h *headless) MonitorPromptClosed()                                 {}
func (h *headless) ControlState(bool, string)                            {}
func (h *headless) MonitorChanged(signal.Monitor)                        {}
func (h *headless) FileOffer(p transfer.Prompt) {
	h.push(flow.Event{Kind: flow.EvFileAccept, FID: p.FID})
}
func (h *headless) MonitorRequest(m signal.Monitor) {
	h.push(flow.Event{Kind: flow.EvMonitorAccept, Monitor: m.ID})
}
func (h *headless) ControlRequest(flow.ControlPrompt) { h.push(flow.Event{Kind: flow.EvControlDeny}) }

// ChooseShare yalnız çoklu monitörde çağrılır (pencere modu kapalı): varsayılan = birincil monitör.
func (h *headless) ChooseShare(_ context.Context, _ []signal.Monitor, def int, _ bool) (flow.ShareChoice, bool) {
	return flow.ShareChoice{Monitor: def}, true
}
