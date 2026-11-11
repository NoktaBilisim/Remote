package flow

import (
	"context"
	"slices"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/signal"
)

// P7 uzaktan kontrol akışı (mimari-protokol §3, §4.3; akış A3/A5). İzin kararı istemcidedir: kapı yalnız yerel
// "İzin ver" olayıyla (EvControlGrant) açılır; kapatan her yol (düğme, kısayol, revoke, caps daralması, teknisyen
// kopması, WS/PeerConnection kopması, yeniden bağlanma, oturum sonu) önce kapıyı kapatır, sonra bildirir.

const capRemoteControl = "remote_control"

// ControlPrompt kontrol izni diyaloğu verisi. Hotkey boşsa (G-21) "İzin ver" devre dışıdır ve neden gösterilir.
type ControlPrompt struct {
	TechName string
	Hotkey   string
}

// Durum satırı metinleri (P7).
const (
	statusControlOff      = "Uzaktan kontrol kapatıldı."
	statusControlRevoked  = "Uzaktan kontrol sunucu tarafından kapatıldı."
	statusControlReleased = "Teknisyen kontrolü bıraktı"
	statusControlCancel   = "Teknisyen isteği geri çekti"
	statusControlTechLost = "Teknisyenin bağlantısı koptu — uzaktan kontrol kapatıldı"
	statusMonitorFail     = "Seçilen ekran paylaşılamadı; önceki ekran paylaşılıyor."
)

func (s *session) hasCap(c string) bool { return slices.Contains(s.caps, c) }

func (s *session) sendControl(ctx context.Context, state, source string) {
	s.send(ctx, signal.ControlState{T: "control.state", State: state, Source: source})
}

// closed closeControl'ün kapattıkları: kullanıcıya hangi metnin gösterileceğine bunlara göre karar verilir.
type closed struct {
	granted   bool // kapı açıktı
	ctlPrompt bool // kontrol izni diyaloğu açıktı
	monPrompt bool // monitör izni diyaloğu açıktı
}

func (c closed) any() bool { return c.granted || c.ctlPrompt || c.monPrompt }

// closeControl kapıyı kapatır ve açık kontrol diyaloğunu (monitor true ise monitör diyaloğunu da) karar verilmeden
// kaldırır. source boş değilse ve kapı açıktıysa control.state{VIEW, source} gönderilir (sunucu VIEW'daysa no-op).
// Kapanış gate.Close ile aynı anda olur; bildirim sonradan gider.
func (s *session) closeControl(ctx context.Context, source string, monitor bool) closed {
	s.gate.Close()
	c := closed{granted: s.granted, ctlPrompt: s.ctlReq.Pending(), monPrompt: monitor && s.monReq.Pending()}
	s.granted = false
	if c.ctlPrompt {
		s.ctlReq.Cancel()
		s.d.UI.ControlPromptClosed()
	}
	if c.monPrompt {
		s.monReq.Cancel()
		s.pendingMon = -1
		s.d.UI.MonitorPromptClosed()
	}
	if c.granted {
		s.d.UI.ControlState(false, s.d.Hotkey)
		if source != "" {
			s.sendControl(ctx, "VIEW", source)
		}
	}
	return c
}

func (s *session) onControlServer(ctx context.Context, m signal.Inbound) {
	switch m := m.(type) {
	case signal.ControlRequest:
		// AC-99: yalnız görüntülemeden istek; kontrol zaten verilmişse veya yetenek yoksa yok sayılır.
		if s.phase != phActive || s.granted || !s.hasCap(capRemoteControl) || !s.ctlReq.Admit(s.d.Now()) {
			return
		}
		s.d.UI.ControlRequest(ControlPrompt{TechName: s.techName, Hotkey: s.d.Hotkey})
	case signal.MonitorRequest:
		s.onMonitorRequest(m.MonitorID)
	case signal.ControlRelease, signal.ControlCancel:
		// K1/K2: durumdan bağımsız kapı ve kontrol diyaloğu kapanır; yanıt yok (sunucu zaten VIEW).
		c := s.closeControl(ctx, "", false)
		switch {
		case c.granted:
			s.d.UI.Status(statusControlReleased)
		case c.ctlPrompt:
			s.d.UI.Status(statusControlCancel)
		}
	case signal.ControlRevoke:
		// G-04/G-15/K3: her reason için kapı kapanır (açamaz), kontrol ve monitör diyaloğu kapanır; kapı açıktıysa
		// control.state{VIEW, SYSTEM}.
		c := s.closeControl(ctx, "SYSTEM", true)
		switch {
		case m.Reason == "reconnect":
			if c.any() {
				s.d.UI.Status(statusControlTechLost)
				s.techLost = true // ardından gelen peer.left/joined{tech} bu metni ezmesin
			}
		case c.granted:
			s.d.UI.Status(statusControlRevoked)
		}
	case signal.CapsUpdate:
		s.caps = append([]string(nil), m.Caps...)
		if s.peer != nil {
			s.peer.SetCaps(s.caps)
		}
		if !s.hasCap(capRemoteControl) {
			if c := s.closeControl(ctx, "SYSTEM", false); c.granted {
				s.d.UI.Status(statusControlRevoked)
			}
		}
	}
}

func (s *session) onControlUser(ctx context.Context, ev Event) {
	now := s.d.Now()
	switch ev.Kind {
	case EvControlGrant:
		// Son savunma: bekleyen istek, yetenek, etkin oturum ve kapatma kısayolu (G-21) şart.
		if !s.ctlReq.Pending() || s.phase != phActive || !s.hasCap(capRemoteControl) || s.d.Hotkey == "" {
			s.ctlReq.Cancel()
			return
		}
		s.ctlReq.Granted()
		s.gate.Open()
		s.granted = true
		s.d.UI.ControlState(true, s.d.Hotkey)
		s.sendControl(ctx, "GRANTED", "UI")
	case EvControlDeny:
		if s.ctlReq.Pending() {
			s.ctlReq.Denied(now)
			s.sendControl(ctx, "VIEW", "DENIED")
		}
	case EvControlClose, EvControlHotkey:
		src := "UI"
		if ev.Kind == EvControlHotkey {
			src = "HOTKEY"
		}
		if c := s.closeControl(ctx, src, false); c.granted {
			s.d.UI.Status(statusControlOff)
		}
	case EvMonitorAccept:
		if s.monReq.Pending() && ev.Monitor == s.pendingMon {
			s.monReq.Granted()
			s.pendingMon = -1
			s.switchMonitor(ctx, ev.Monitor)
		}
	case EvMonitorDeny:
		// K4: Reddet, Esc veya pencere kapatma → monitor.denied (teknisyen 30 sn beklemez; ret audit'lenir).
		if s.monReq.Pending() {
			s.monReq.Denied(now)
			id := s.pendingMon
			s.pendingMon = -1
			s.send(ctx, signal.MonitorDenied{T: "monitor.denied", MonitorID: id})
		}
	}
}

// onMonitorRequest AC-43: yalnız çoklu monitörde, farklı ve bilinen kimlik için diyalog (G-03 kuralları).
func (s *session) onMonitorRequest(id int) {
	if s.phase != phActive || len(s.monitors) < 2 || (s.monitor != nil && *s.monitor == id) {
		return
	}
	mon, ok := s.monitorByID(id)
	if !ok || !s.monReq.Admit(s.d.Now()) {
		return
	}
	s.pendingMon = id
	s.d.UI.MonitorRequest(mon)
}

func (s *session) monitorByID(id int) (signal.Monitor, bool) {
	for _, m := range s.monitors {
		if m.ID == id {
			return m, true
		}
	}
	return signal.Monitor{}, false
}

// switchMonitor paylaşılan monitörü değiştirir; yeni kaynak açılamazsa önceki sürer.
func (s *session) switchMonitor(ctx context.Context, id int) {
	src, err := s.d.Capture(id)
	if err != nil {
		s.d.UI.Status(statusMonitorFail)
		return
	}
	s.stopStream()
	if s.src != nil {
		_ = s.src.Close()
	}
	s.src, s.monitor = src, &id
	s.setInputMonitor()
	s.d.UI.MonitorChanged(s.activeMonitor())
	if s.peer != nil {
		s.startStream(ctx)
	}
	s.sendShare(ctx, "sharing")
}

func (s *session) setInputMonitor() {
	if s.d.SetInputMonitor != nil && s.monitor != nil {
		s.d.SetInputMonitor(*s.monitor)
	}
}

// startEnv AC-105: ortam yoklayıcısı oturum boyunca çalışır; değişiklik akış döngüsüne gelir.
func (s *session) startEnv(ctx context.Context) {
	if s.d.EnvProbe == nil || s.envCh != nil {
		return
	}
	s.envCh = make(chan env.State, 4)
	ch := s.envCh
	go env.Watch(ctx, s.d.EnvProbe, env.Every, func(st env.State) {
		select {
		case ch <- st:
		case <-ctx.Done():
		}
	})
}

// onEnv izleyicinin olayı: yalnız son gönderilenden farklıysa env.state (izleyicinin ilk olayı genelde hello'da
// gönderilen değerle aynıdır; tekrar gönderilmez).
func (s *session) onEnv(ctx context.Context, st env.State) {
	if st == s.env {
		return
	}
	s.env = st
	s.sendEnv(ctx)
}

// helloEnv K8: her hello'dan (ilk ve yeniden bağlanma) hemen sonra tek env.state — izleyici beklenmez, alanlar o an
// eşzamanlı ölçülür (yoklayıcı yoksa false). Aynı WS'de sıralı olduğundan sunucu GRANTED'den önce selfElevated'ı bilir.
func (s *session) helloEnv(ctx context.Context) {
	var st env.State
	if s.d.EnvProbe != nil {
		st = s.d.EnvProbe()
	}
	s.env = st
	s.sendEnv(ctx)
}

func (s *session) sendEnv(ctx context.Context) {
	s.send(ctx, signal.EnvState{T: "env.state", ElevatedForeground: s.env.ElevatedForeground,
		SecureDesktop: s.env.SecureDesktop, SelfElevated: s.d.SelfElevated})
}

// techChanged K3 ikinci katman: teknisyen koptu/döndü (peer.left/joined{tech}). Sunucu önce control.revoke{reconnect}
// gönderir; o kaçsa bile kapı ve diyaloglar burada kapanır. lost: kontrol/diyalog az önce (revoke ile veya burada)
// kapandı → durum satırında "Teknisyenin bağlantısı koptu — uzaktan kontrol kapatıldı" gösterilir.
func (s *session) techChanged(ctx context.Context, lost bool, otherwise string) {
	if c := s.closeControl(ctx, "SYSTEM", true); c.any() || lost {
		s.d.UI.Status(statusControlTechLost)
		return
	}
	s.d.UI.Status(otherwise)
}

// newGate Deps.Gate yoksa (test) yeni kapı.
func newGate(g *control.Gate) *control.Gate {
	if g == nil {
		return &control.Gate{}
	}
	return g
}
