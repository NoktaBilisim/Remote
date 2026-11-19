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
// Sohbet gösterilmez (sohbet paneli yok — §5.6). P30 (mimari-p30): işaretleme göstergenin katmanında gösterilir
// (Annot → liveIndicator; paylaşılan monitör Active/MonitorChanged ile izlenir).
// P28u (mimari-p28u §7.5): kontrol her açılıp kapandığında durum borusuna `control` yazılır (müdahale koşulu). r3: tek
// kip; gösterge etiketi kontrolle değişmez, dosya teklifi her zaman kabul (P27).
type headless struct {
	ctx    context.Context
	events chan<- flow.Event

	st       *statusPipe
	live     rosterLabel
	draw     annotSink // P30: çizim durumu (liveIndicator)
	ctrlTid  string    // P30: son roster'daki kontrol sahibi (değişince çizimler silinir)
	techName string    // P28c: sunucu gösterge metnindeki ad (tek sahipte ek yazılmaz)
	granted  atomic.Bool
}

// rosterLabel göstergenin ad eki (liveIndicator).
type rosterLabel interface {
	SetNames(suffix string) bool
}

// annotSink teknisyen çizimlerini ve paylaşılan monitörü alan gösterge (liveIndicator).
type annotSink interface {
	Annot(m dc.Ctl)
	SetSurface(id int)
}

// ShowRoster flow.RosterUI (P28c §6, V-PC-5): göstergede bağlı teknisyen adları; "Çıkar" yok. Ad
// güvensizse ya da çizim doğrulanamazsa false → o teknisyenin eşi kurulmaz (Y-PC-4).
func (h *headless) ShowRoster(v flow.RosterView) bool {
	h.controllerChanged(v)
	if h.live == nil {
		return false
	}
	suffix, ok := namesSuffix(v, h.techName)
	return ok && h.live.SetNames(suffix)
}

// controllerChanged P30 güvenlik turu: kontrol başka teknisyene geçince önceki sahibin çizimleri silinir (yeni sahip
// onları konsolunda görmez ve kimliğe göre geri alamaz). Yalnız akış döngüsünden çağrılır.
func (h *headless) controllerChanged(v flow.RosterView) {
	ctrl := ""
	for _, t := range v.Techs {
		if t.Role == flow.MultiTexts.RoleControl {
			ctrl = t.TID
		}
	}
	if h.ctrlTid != "" && ctrl != h.ctrlTid && h.draw != nil {
		h.draw.Annot(dc.Ctl{T: "annot.clear"})
	}
	h.ctrlTid = ctrl
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
func (h *headless) Status(string)                                        {}
func (h *headless) Chat(string)                                          {}
func (h *headless) FileOfferWithdrawn(string)                            {}
func (h *headless) FileProgress(int64, int64)                            {}
func (h *headless) FileResult(transfer.Result)                           {}
func (h *headless) Ended(flow.Message)                                   {}
func (h *headless) ControlPromptClosed()                                 {}
func (h *headless) MonitorPromptClosed()                                 {}

// Active P30: paylaşılan monitör katmanın yüzeyidir (K-P30-4).
func (h *headless) Active(_ string, mon signal.Monitor) { h.MonitorChanged(mon) }

// MonitorChanged P30: teknisyen monitör değiştirdi → katman yeni monitöre taşınır, çizimler korunur.
func (h *headless) MonitorChanged(mon signal.Monitor) {
	if h.draw != nil {
		h.draw.SetSurface(mon.ID)
	}
}

// Annot P30 (AC-494): yalnız kontrol sahibinin iletisi buraya ulaşır (flow ctlAllowed, AC-498).
func (h *headless) Annot(m dc.Ctl) {
	if h.draw != nil {
		h.draw.Annot(m)
	}
}

// ControlState kontrol açıldı/kapandı (akış döngüsünden).
func (h *headless) ControlState(granted bool, _ string) {
	if h.granted.Swap(granted) == granted {
		return
	}
	if h.st != nil {
		h.st.setControl(granted)
	}
}

// FileOffer P27: kabul (hedef `Gelen`).
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
