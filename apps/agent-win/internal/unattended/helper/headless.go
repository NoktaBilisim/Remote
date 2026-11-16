package helper

import (
	"context"
	"sync/atomic"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

// headless flow.UI'nin gözetimsiz uygulaması (mimari-p27 §5.6): ekran yok; kararlar otomatiktir ve akışa olay olarak
// döner. Dosya teklifi → kabul (hedef `Gelen`), monitör isteği → kabul, paylaşım seçimi → birincil monitör. Kontrol
// isteği akışta (flow.Deps.Unattended) doğrudan GRANTED{UNATTENDED} olur; buraya düşerse fail-closed ret.
// Sohbet ve işaretleme gösterilmez (sohbet paneli yok — §5.6).
// P28u (mimari-p28u §7.5, §7.6): kontrol her açılıp kapandığında durum borusuna `control` yazılır; silent kipte
// gösterge etiketi izleme ↔ kontrol metni arasında değişir ve kontrol kapalıyken dosya teklifi reddedilir.
type headless struct {
	ctx    context.Context
	events chan<- flow.Event

	mode                  string // helperio.Mode*; "" = P27
	st                    *statusPipe
	live                  liveLabel
	viewText, controlText string
	techName              string // P28c: sunucu gösterge metnindeki ad (tek sahipte ek yazılmaz)
	granted               atomic.Bool
}

// liveLabel göstergenin etiketi (liveIndicator).
type liveLabel interface {
	SetText(string)
	SetNames(suffix string) bool
}

// ShowRoster flow.RosterUI (P28c §6, V-PC-5): göstergede bağlı teknisyen adları (silent dahil); "Çıkar" yok. Ad
// güvensizse ya da çizim doğrulanamazsa false → o teknisyenin eşi kurulmaz (Y-PC-4).
func (h *headless) ShowRoster(v flow.RosterView) bool {
	if h.live == nil {
		return false
	}
	suffix, ok := namesSuffix(v, h.techName)
	return ok && h.live.SetNames(suffix)
}

// TechChat sohbet paneli yok (§5.6).
func (h *headless) TechChat(string, string) {}

// namesSuffix gösterge eki: yalnız sunucu metnindeki tek sahip bağlıysa boş; değilse " · Bağlı: A, B".
func namesSuffix(v flow.RosterView, techName string) (string, bool) {
	if len(v.Techs) == 1 && v.Techs[0].Name == techName {
		return "", true
	}
	out := ""
	for i, t := range v.Techs {
		if !helperio.Text(t.Name, 100) {
			return "", false
		}
		name := t.Name
		if r := []rune(name); len(r) > nameMaxRunes {
			name = string(r[:nameMaxRunes-1]) + "…"
		}
		if i > 0 {
			out += flow.MultiTexts.NameSep
		}
		out += name
	}
	return flow.MultiTexts.IndicatorList + out, true
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
func (h *headless) MonitorChanged(signal.Monitor)                        {}
func (h *headless) silent() bool                                         { return h.mode == helperio.ModeSilent }

// ControlState kontrol açıldı/kapandı (akış döngüsünden).
func (h *headless) ControlState(granted bool, _ string) {
	if h.granted.Swap(granted) == granted {
		return
	}
	if h.st != nil {
		h.st.setControl(granted)
	}
	if h.silent() && h.live != nil {
		text := h.viewText
		if granted {
			text = h.controlText
		}
		h.live.SetText(text)
	}
}

// FileOffer P27: kabul (hedef `Gelen`). P28u silent ∧ kontrol kapalı (izleme kipi, AC-439) → ret.
func (h *headless) FileOffer(p transfer.Prompt) {
	if h.silent() && !h.granted.Load() {
		h.push(flow.Event{Kind: flow.EvFileReject, FID: p.FID})
		return
	}
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
