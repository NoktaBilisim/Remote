package flow

import (
	"context"
	"sync/atomic"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// P28c çoklu teknisyen (mimari-p28c §4.4, §4.5, §5.1, §6.1, §11; ADR-0035): teknisyen başına ayrı PeerConnection
// (tid → eş, ≤ signal.MaxTechs). Eski (multi1 roster'ı gelmeyen) sokette tek eş vardır: tid "" — hello'da kurulur,
// From/To boştur ve kontrol sahibidir (tek yol: eş haritasının tek satırlı hâli).
//
// Kabul listesi (Y-PC-4): multi kipinde yalnız son roster'da olan ve RosterUI'nin ekranda/göstergede adıyla çizdiğini
// doğruladığı tid'in sdp.offer'ı kabul edilir; bilinmeyen/çizilmemiş `from` → offer düşer, PC kurulmaz. Roster'dan düşen
// ya da bağlantısı kopan (connected:false) tid'in eşi hemen kapanır. Girdi, dosya, pano, yazdırma, işaretleme yalnız
// kontrol sahibinin eşinden (§4.5). P22-G: sohbet DC'den geçmez (sunucu aktarımlı WS, chat.go).

// RosterTech müşteri listesindeki satır (ad + rol; userId yok — T10).
type RosterTech struct {
	TID, Name string
	Role      string // MultiTexts rol etiketi
	Owner     bool
	Connected bool
	Removable bool // "Çıkar" düğmesi (sahip ve gözetimsiz odada yok)
}

// RosterView müşteri arayüzüne giden roster. Controller AC-103 göstergesi ve kontrol diyaloğu adıdır.
type RosterView struct {
	Techs      []RosterTech
	Controller string
}

// RosterUI P28c arayüzü.
type RosterUI interface {
	// ShowRoster listeyi ekranda (oturum penceresi) ya da göstergede adlarıyla çizer ve çizim doğrulanınca true döner
	// (en geç ~2 sn; döngüyü kısa süre bekletebilir). false → yeni tid'lerin eşi kurulmaz.
	ShowRoster(v RosterView) bool
}

// techPeer bir teknisyenin eşi.
type techPeer struct {
	p    Peer
	main bool
	gen  uint64 // kapatılan eşin geç olaylarını süzer
}

// multiState roster durumu (yalnız döngüde; ctrl Pion goroutine'lerinin girdi kapısı için atomik).
type multiState struct {
	on     bool // roster alındı (multi1 soket)
	roster []signal.RosterEntry
	drawn  map[string]bool
	ctrl   atomic.Pointer[string] // kontrol sahibinin tid'i ("" = eski soket tek eşi)
}

func (s *session) ctrlTid() string {
	if p := s.multi.ctrl.Load(); p != nil {
		return *p
	}
	return ""
}

func (s *session) setCtrl(tid string) { s.multi.ctrl.Store(&tid) }

// mainPeer kontrol sahibinin eşi (dosya, pano, yazdırma yanıtları); yoksa nil.
func (s *session) mainPeer() Peer {
	if tp := s.peers[s.ctrlTid()]; tp != nil {
		return tp.p
	}
	return nil
}

// rosterEntry tid'in son roster satırı.
func (s *session) rosterEntry(tid string) *signal.RosterEntry {
	for i := range s.multi.roster {
		if s.multi.roster[i].TID == tid {
			return &s.multi.roster[i]
		}
	}
	return nil
}

// newPeer tid için eş kurar (ana iz yalnız kontrol sahibine).
func (s *session) newPeer(ctx context.Context, tid string) (*techPeer, error) {
	s.peerGen++
	p, err := s.d.NewPeer(s.ice, s.caps, s.handlers(ctx, tid, s.peerGen))
	if err != nil {
		return nil, err
	}
	main := tid == s.ctrlTid()
	if !main {
		_ = p.SetMain(false)
	}
	tp := &techPeer{p: p, main: main, gen: s.peerGen}
	s.peers[tid] = tp
	s.voicePeerAdded(tid, tp)
	s.updateLow()
	return tp, nil
}

// closePeer tid'in eşini kapatır; kontrol sahibininse kapı ve diyaloglar kapanır.
func (s *session) closePeer(ctx context.Context, tid string) {
	tp := s.peers[tid]
	if tp == nil {
		return
	}
	delete(s.peers, tid)
	s.voicePeerRemoved(tid)
	_ = tp.p.Close()
	if tid == s.ctrlTid() {
		s.closeControl(ctx, "SYSTEM", true)
		s.cancelLocalFile()
	}
	s.updateLow()
}

// updateLow düşük kodlayıcı yalnız ≥ 1 ikincil eş varken açık (§6.1).
func (s *session) updateLow() {
	if s.d.Media == nil {
		return
	}
	low := false
	for _, tp := range s.peers {
		low = low || !tp.main
	}
	s.d.Media.SetLow(low)
}

func (s *session) cancelLocalFile() {
	if s.files != nil {
		if r := s.files.CancelLocal(); r != nil {
			s.d.UI.FileResult(*r)
		}
	}
}

// onOffer teknisyenin offer'ı: eski sokette tek eş, multi kipinde kabul listesi (Y-PC-4).
func (s *session) onOffer(ctx context.Context, m signal.SdpOffer) {
	if m.From == "" {
		if tp := s.peers[""]; tp != nil && !s.multi.on {
			if ans, err := tp.p.HandleOffer(m.SDP); err == nil {
				s.send(ctx, ans)
			}
		}
		return
	}
	if !s.multi.on || !s.multi.drawn[m.From] || s.phase != phActive {
		return // roster'da olmayan ya da adı çizilmemiş teknisyen: PC kurulmaz
	}
	tp := s.peers[m.From]
	if tp == nil {
		if len(s.peers) >= signal.MaxTechs {
			return
		}
		var err error
		if tp, err = s.newPeer(ctx, m.From); err != nil {
			return
		}
	}
	ans, err := tp.p.HandleOffer(m.SDP)
	if err != nil {
		return
	}
	ans.To = m.From
	s.send(ctx, ans)
}

// onRemoteIce adayı gönderen teknisyenin eşine (eşi yoksa düşer).
func (s *session) onRemoteIce(m signal.RemoteIce) {
	if m.From == "" && s.multi.on {
		return
	}
	if tp := s.peers[m.From]; tp != nil {
		_ = tp.p.AddRemoteICE(m)
	}
}

// iceRestartPeer `ice.restart`'ın hedef eşi (P28c: multi1'de `from` ile): from boşsa yalnız eski soketin tek eşi; from
// doluysa yalnız multi kipinde, son roster'da olup adı çizilmiş (drawn yalnız son roster'dan kurulur) ve eşi kurulmuş tid.
// Diğer durumlar nil → yok sayılır; eş kurulmaz, kapanmaz. Yanıtlayan taraf olarak hedef eşte ek iş yoktur: teknisyen
// ardından iceRestart'lı yeni offer gönderir, yeni ICE kimliği onOffer → HandleOffer'da (aynı kabul listesiyle) uygulanır.
func (s *session) iceRestartPeer(m signal.IceRestart) *techPeer {
	if m.From == "" {
		if s.multi.on {
			return nil
		}
		return s.peers[""]
	}
	if !s.multi.on || !s.multi.drawn[m.From] {
		return nil
	}
	return s.peers[m.From]
}

// onRoster `techs.roster` (§4.4): eş kapanışları, kontrol sahibi değişimi (kapı kapanır, iz takası §5.1 adım 3),
// liste çizimi ve kabul listesi. Değişmez ihlali (signal.ValidRoster) → güvenli kopma.
func (s *session) onRoster(ctx context.Context, m signal.TechsRoster) (Outcome, bool) {
	if !signal.ValidRoster(m) {
		s.gate.Close()
		return Outcome{Message: msgProtocol, Failed: true}, true
	}
	if !s.multi.on {
		s.multi.on = true
		s.closePeer(ctx, "") // eski soket eşi multi1'de offer almaz
	}
	prev := s.ctrlTid()
	prevEntry := s.rosterEntry(prev)
	prevConnected := prevEntry != nil && *prevEntry.Connected
	s.multi.roster = append([]signal.RosterEntry(nil), m.Techs...)
	ctrl, name, connected := "", "", false
	for _, e := range m.Techs {
		if e.Role == "controller" {
			ctrl, name, connected = e.TID, e.Name, *e.Connected
		}
	}
	for tid := range s.peers {
		if e := s.rosterEntry(tid); e == nil || !*e.Connected {
			s.closePeer(ctx, tid)
		}
	}
	if ctrl != prev {
		s.setCtrl(ctrl)
		s.closeControl(ctx, "SYSTEM", true) // §5.1: devirde kapı kapanır (sunucu ayrıca control.revoke gönderir)
		s.cancelLocalFile()
		for tid, tp := range s.peers {
			if main := tid == ctrl; tp.main != main {
				tp.main = main
				_ = tp.p.SetMain(main)
			}
		}
		s.updateLow()
	} else if prevEntry != nil && prevConnected != connected {
		status := statusTechLeft // multi1'de peer.left/joined{tech} yok; kontrol sahibinin bağlantısı roster'dan
		if connected {
			status = statusTechBack
		}
		s.techChanged(ctx, false, status)
	}
	s.techName = name
	s.drawRoster()
	s.voiceRoster() // P28d D-PD-3: roster dışı tid yok sayılır; isteyen düştüyse diyalog kapanır
	return Outcome{}, false
}

// drawRoster listeyi arayüze çizdirir; yalnız çizimi doğrulanan tid'ler kabul listesine girer.
func (s *session) drawRoster() {
	view := RosterView{Controller: s.techName}
	for _, e := range s.multi.roster {
		view.Techs = append(view.Techs, RosterTech{TID: e.TID, Name: e.Name, Role: roleLabel(e.Role), Owner: *e.Owner,
			Connected: *e.Connected, Removable: !*e.Owner && !s.d.Unattended})
	}
	drawn := map[string]bool{}
	if s.d.RosterUI != nil && s.d.RosterUI.ShowRoster(view) {
		for _, e := range s.multi.roster {
			drawn[e.TID] = true
		}
	} else {
		for _, e := range s.multi.roster {
			drawn[e.TID] = s.multi.drawn[e.TID] // önceki çizim sürer; yeni ad çizilemedi → kabul yok
		}
	}
	s.multi.drawn = drawn
}

// onTechRemove müşterinin "Çıkar"ı (AC-366): yalnız multi kipinde, sahip olmayan ve roster'daki tid; gözetimsizde yok.
func (s *session) onTechRemove(ctx context.Context, tid string) {
	if s.d.Unattended || !s.multi.on {
		return
	}
	if e := s.rosterEntry(tid); e != nil && !*e.Owner {
		s.send(ctx, signal.TechRemove{T: "tech.remove", TID: tid})
	}
}

// ctlAllowed §4.5 misafir kapısı: kontrol sahibinden her şey; diğerlerinden yalnız ping (P22-G: DC sohbeti yok).
func (s *session) ctlAllowed(tid, t string) bool {
	return tid == s.ctrlTid() || t == "ping"
}

// peerInput girdi yalnız kontrol sahibinin eşinden (Pion goroutine'inde; atomik denetim, §4.5).
func (s *session) peerInput(tid string) func(raw []byte) {
	if s.d.Input == nil {
		return nil
	}
	in := s.d.Input
	return func(raw []byte) {
		if s.ctrlTid() == tid {
			in(raw)
		}
	}
}

// handlers tid'e bağlı eş olayları; gen kapatılmış eşin geç olaylarını ayırır.
func (s *session) handlers(ctx context.Context, tid string, gen uint64) rtc.Handlers {
	push := func(e peerEvent) {
		e.tid, e.gen = tid, gen
		select {
		case s.peerEv <- e:
		case <-ctx.Done():
		}
	}
	return rtc.Handlers{
		LocalICE: func(m signal.Ice) {
			m.To = tid
			push(peerEvent{ice: &m})
		},
		Ctl:       func(m dc.Ctl) { push(peerEvent{ctl: &m}) },
		FileChunk: func(c dc.Chunk, ok bool) { push(peerEvent{chunk: &c, ok: ok}) },
		State:     func(st string) { push(peerEvent{state: st}) },
		Input:     s.peerInput(tid),
		Audio:     s.voiceAudio(tid), // P28d: yalnız canlı motora (voice.go); voice1 yoksa nil
	}
}
