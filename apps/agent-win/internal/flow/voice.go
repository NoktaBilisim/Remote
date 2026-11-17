package flow

import (
	"context"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/signal"
)

// P28d sesli görüşme — müşteri (Go misafir) tarafı (mimari-p28d r3 §4.2, §4.3, §5, §8; K-PD-2, O-PD-1, O-PD-3, D-PD-3,
// D-PD-5, Y-PD-3). flow ses motorunu (internal/voice) içe AKTARMAZ: gözetimsiz yardımcı da flow kurar ve wazero servis
// ikilisine girmemelidir. Motor ve arayüz Deps.OpenVoice / Deps.VoiceUI ile yalnız cmd/noktadestek'te bağlanır.
//
// K-PD-2 (bağlayıcı): mikrofon YALNIZ bu süreçte, o callId için yerel "Kabul et" olayından (EvVoiceAccept) sonra açılır.
// Rıza kaydı (consent) yalnız bellektedir; WS kopmasında, yeni hello'da, görüşme bitişinde ve callId değişiminde silinir.
// voice.request ve voice.state mikrofon AÇMAZ, yalnız kapatabilir: rızasız voice.state{active} → mikrofon açılmaz ve
// callId başına bir kez voice.end{callId, customer} gider. Misafir yalnız voice.answer ve voice.end{customer|device}
// gönderir; voice.end yalnız görüşme (sunucuda) etkinken anlamlıdır, pending'de sunucu düşürür (ret voice.answer{false}).
//
// D-PD-5 / O-PD-1: tek bırakma yolu releaseMic (idempotent): atomik çağrı nil (RTP goroutine'leri artık Push
// etmez) → sustur → Close (≤ 1 sn, motor) → rıza silinir → çubuk/gösterge kapanır. Çağrı yerleri: WS kopması
// (startReconnect), onHello, cleanup (oturum sonu), voice.state{idle} / başka callId, kullanıcı bitirmesi, aygıt hatası.

// VoiceUI P28d müşteri arayüzü (engellemez; UI iş parçacığına iletilir). Adlar roster'dan çözülmüştür.
type VoiceUI interface {
	// VoiceAsk kabul diyaloğu (G-03: odak Reddet, 1,5 sn kilit, imleç altında açılmaz). Aynı CallID ile yeniden
	// çağrılırsa diyalog yerinde güncellenir (dinleyecekler listesi).
	VoiceAsk(a VoiceAsk)
	// VoiceAskClosed diyalog karar verilmeden kapanır (görüşme bitti/değişti, WS koptu, isteyen roster'dan düştü).
	VoiceAskClosed(callID string)
	// VoiceBar oturum penceresindeki ses satırı, her zaman üstte gösterge şeridi ve tepsi göstergesi. On=false iken
	// hepsi kalkar (Note varsa kısa bilgi satırı).
	VoiceBar(v VoiceView)
}

// VoiceAsk diyalog verisi.
type VoiceAsk struct {
	CallID    string
	Name      string   // isteyen teknisyen (VoiceTexts.RequestTitle)
	Listeners []string // isteyen dışındaki dinleyecekler (boşsa satır yok)
}

// VoiceView görüşme çubuğu/göstergesi.
type VoiceView struct {
	On    bool // müşteri kabul etti; mikrofon açık ya da açılıyor (gösterge görünür)
	Muted bool
	// Talkers konuşan adlar; Listeners yalnız dinleyenler (listeners − talkers).
	Talkers, Listeners []string
	// Announce bu güncellemede yeni katılan dinleyicilerin adları (Y-PD-3: belirgin duyuru + sabit tepsi balonu); boşsa yok.
	Announce []string
	Note     string // On=false iken bilgi satırı (VoiceTexts.Ended / Device) ya da boş
}

// VoiceCall bir görüşmenin mikrofon/hoparlör/kodlayıcı motoru (internal/voice.Call). Push RTP goroutine'lerinden
// eşzamanlı çağrılır; diğerleri akış döngüsünden. Close'dan sonra tüm çağrılar etkisizdir.
type VoiceCall interface {
	// SetPeer tid'in giden ses yazıcısı (aynı tid için yeniden çağrı öncekinin yerine geçer).
	SetPeer(tid string, sink func(payload []byte, d time.Duration) error)
	RemovePeer(tid string)
	// SetRoles talker kapısı (yalnız talkers çözülür, D-PD-3) ve gönderim kapısı (yalnız listeners'a yazılır, Y-PD-3).
	SetRoles(talkers, listeners []string)
	SetMuted(on bool)
	// Push teknisyen tid'inden gelen Opus yükü (talker değilse çözülmeden atılır).
	Push(tid string, seq uint16, payload []byte)
	Close() error
}

// VoicePeer eşin giden ses izi (internal/rtc.Peer.WriteAudio). flow.Peer'i genişletmez; uygulamayan eşe ses yazılmaz.
type VoicePeer interface {
	WriteAudio(payload []byte, d time.Duration) error
}

// voiceOn `rs.cap.voice1` bildirilir mi (O-PD-3; A-PD-6: motor desteklenmiyorsa deps.go alanları nil bırakır).
func voiceOn(d Deps) bool {
	return !d.Unattended && d.VoiceUI != nil && d.OpenVoice != nil && d.RosterUI != nil
}

// voiceLive canlı motor (RTP goroutine'leri atomik okur).
type voiceLive struct{ call VoiceCall }

// voiceState oturumun ses durumu. mu yalnız gen + live devrini (açma goroutine'i ↔ döngü) korur; diğer alanlar yalnız
// akış döngüsünde değişir.
type voiceState struct {
	mu   sync.Mutex
	gen  uint64 // her kabul ve her releaseMic artırır; bayat açma sonucu kapatılır
	live atomic.Pointer[voiceLive]

	consent       string // yerel kabulün callId'si (K-PD-2; yalnız bellek)
	asked, askBy  string // açık diyaloğun callId'si ve isteyen tid
	phase, callID string // son voice.state
	talkers       []string
	listeners     []string
	heard         map[string]bool // duyurulmuş/diyalogda gösterilmiş dinleyiciler (Y-PD-3)
	refused       map[string]bool // voice.end gönderilmiş callId'ler (callId başına bir kez)
	muted         bool
}

func (s *session) voiceEnabled() bool { return voiceOn(s.d) }

// named roster'da olan tid'ler (D-PD-3: roster dışı tid yok sayılır).
func (s *session) named(tids []string) []string {
	var out []string
	for _, t := range tids {
		if s.rosterEntry(t) != nil {
			out = append(out, t)
		}
	}
	return out
}

func (s *session) names(tids []string) []string {
	var out []string
	for _, t := range tids {
		if e := s.rosterEntry(t); e != nil {
			out = append(out, e.Name)
		}
	}
	return out
}

func (s *session) onVoiceServer(ctx context.Context, m signal.Inbound) {
	if !s.voiceEnabled() {
		return // voice1 bildirilmedi: sunucu göndermez; gelirse yok sayılır
	}
	switch m := m.(type) {
	case signal.VoiceRequest:
		s.onVoiceRequest(m)
	case signal.VoiceState:
		s.onVoiceState(ctx, m)
	}
}

// onVoiceRequest diyalog açar; mikrofon AÇMAZ. Roster'da olmayan `by` yok sayılır (Y-PC-4 kalıbı).
func (s *session) onVoiceRequest(m signal.VoiceRequest) {
	v := &s.voice
	if s.rosterEntry(m.By) == nil {
		return
	}
	if v.consent != "" && v.consent != m.CallID {
		s.releaseMic(VoiceTexts.Ended)
	}
	if v.asked != "" && v.asked != m.CallID {
		s.closeAsk()
	}
	v.asked, v.askBy = m.CallID, m.By
	s.d.VoiceUI.VoiceAsk(s.voiceAsk())
}

func (s *session) voiceAsk() VoiceAsk {
	v := &s.voice
	a := VoiceAsk{CallID: v.asked}
	if e := s.rosterEntry(v.askBy); e != nil {
		a.Name = e.Name
	}
	if v.phase == "pending" && v.callID == v.asked {
		a.Listeners = s.names(slices.DeleteFunc(slices.Clone(v.listeners), func(t string) bool { return t == v.askBy }))
	}
	return a
}

// closeAsk açık diyaloğu kararsız kapatır.
func (s *session) closeAsk() {
	v := &s.voice
	if v.asked != "" {
		id := v.asked
		v.asked, v.askBy = "", ""
		s.d.VoiceUI.VoiceAskClosed(id)
	}
}

// onVoiceState sunucu durumu: yalnız kapatır, diyaloğu günceller, rızalı görüşmede rolleri uygular (açma çağrısı YOK).
func (s *session) onVoiceState(ctx context.Context, m signal.VoiceState) {
	v := &s.voice
	if v.asked != "" && (m.Phase != "pending" || m.CallID != v.asked) {
		s.closeAsk()
	}
	if v.consent != "" && m.CallID != v.consent {
		s.releaseMic(VoiceTexts.Ended)
	}
	if m.Phase == "idle" {
		if v.consent != "" {
			s.releaseMic(VoiceTexts.Ended)
		}
		v.phase, v.callID, v.talkers, v.listeners = "idle", "", nil, nil
		return
	}
	v.phase, v.callID = m.Phase, m.CallID
	v.talkers, v.listeners = slices.Clone(m.Talkers), slices.Clone(m.Listeners)
	switch {
	case m.Phase == "pending":
		if v.asked == m.CallID {
			v.heard = setOf(s.named(v.listeners)) // diyalogda gösterilenler duyurulmaz
			s.d.VoiceUI.VoiceAsk(s.voiceAsk())
		}
	case v.consent != m.CallID:
		// Rıza kaydı yok (yeniden bağlanma/yeniden başlama, bayat ya da sahte durum): mikrofon açılmaz, görüşme müşteri
		// adına biter (K-PD-2).
		s.voiceEndOnce(ctx, m.CallID, signal.VoiceEndCustomer)
	default:
		s.voiceApply()
	}
}

// voiceEndOnce callId başına en çok bir `voice.end` (soket yoksa gönderilmez ve sayılmaz).
func (s *session) voiceEndOnce(ctx context.Context, callID, reason string) {
	v := &s.voice
	if v.refused[callID] || s.conn == nil {
		return
	}
	if v.refused == nil {
		v.refused = map[string]bool{}
	}
	v.refused[callID] = true
	s.send(ctx, signal.VoiceEnd{T: "voice.end", CallID: callID, Reason: reason})
}

// voiceApply rızalı görüşmede rolleri motora, görünümü arayüze uygular; yeni dinleyiciyi duyurur (Y-PD-3).
func (s *session) voiceApply() {
	v := &s.voice
	if v.consent == "" {
		return
	}
	var talkers, listeners []string
	if v.phase == "active" && v.callID == v.consent {
		talkers, listeners = s.named(v.talkers), s.named(v.listeners)
	}
	if l := v.live.Load(); l != nil {
		l.call.SetRoles(talkers, listeners)
	}
	var fresh []string
	for _, t := range listeners {
		if !v.heard[t] {
			fresh = append(fresh, t)
			v.heard[t] = true
		}
	}
	s.d.VoiceUI.VoiceBar(VoiceView{On: true, Muted: v.muted, Talkers: s.names(talkers),
		Listeners: s.names(slices.DeleteFunc(slices.Clone(listeners), func(t string) bool { return slices.Contains(talkers, t) })),
		Announce:  s.names(fresh)})
}

// voiceRoster roster değişti: isteyen düştüyse diyalog kapanır; roller yeniden süzülür (D-PD-3).
func (s *session) voiceRoster() {
	if !s.voiceEnabled() {
		return
	}
	if v := &s.voice; v.asked != "" && s.rosterEntry(v.askBy) == nil {
		s.closeAsk()
	}
	s.voiceApply()
}

func (s *session) onVoiceUser(ctx context.Context, ev Event) {
	if !s.voiceEnabled() {
		return
	}
	v := &s.voice
	switch ev.Kind {
	case EvVoiceAccept:
		s.voiceAccept(ctx, ev.CallID)
	case EvVoiceReject:
		if v.asked == "" || v.asked != ev.CallID {
			return
		}
		v.asked, v.askBy = "", ""
		s.send(ctx, signal.VoiceAnswer{T: "voice.answer", CallID: ev.CallID, Accept: false})
	case EvVoiceEnd:
		if v.consent == "" {
			return
		}
		if v.phase == "active" && v.callID == v.consent {
			s.voiceEndOnce(ctx, v.consent, signal.VoiceEndCustomer)
		}
		s.releaseMic(VoiceTexts.Ended)
	case EvVoiceMute:
		if v.consent == "" {
			return
		}
		v.muted = ev.On // yalnız yerel: sunucuya mesaj gitmez
		if l := v.live.Load(); l != nil {
			l.call.SetMuted(ev.On)
		}
		s.voiceApply()
	}
}

// voiceAccept yerel "Kabul et": rıza kaydı + aynı turda voice.answer{true}, ardından mikrofon goroutine'de açılır.
// Yalnız açık diyaloğun callId'si ve canlı soketle (WS koptuysa diyalog zaten kapandı).
func (s *session) voiceAccept(ctx context.Context, callID string) {
	v := &s.voice
	if callID == "" || v.asked != callID || s.conn == nil {
		return
	}
	by := v.askBy
	v.asked, v.askBy = "", ""
	if v.consent != "" {
		s.releaseMic("")
	}
	v.consent = callID
	if v.phase != "pending" || v.callID != callID || v.heard == nil {
		v.heard = map[string]bool{}
	}
	v.heard[by] = true
	s.send(ctx, signal.VoiceAnswer{T: "voice.answer", CallID: callID, Accept: true})
	v.mu.Lock()
	v.gen++
	g := v.gen
	v.mu.Unlock()
	s.voiceApply()
	go s.openVoice(ctx, g)
}

// openVoice aygıtı açar (engelleyebilir). Sahiplik devri mu altında: bu arada releaseMic çalıştıysa (gen değişti) çağrı
// burada kapatılır; değilse live'a yazılır ve sonraki releaseMic (oturum sonundaki cleanup dahil) onu kapatır.
func (s *session) openVoice(ctx context.Context, g uint64) {
	post := func(f func()) {
		select {
		case s.peerEv <- peerEvent{run: f}:
		case <-ctx.Done():
		}
	}
	c, err := s.d.OpenVoice(func(error) { post(func() { s.voiceFailed(ctx, g) }) })
	if err == nil && c == nil {
		err = errNoVoice
	}
	v := &s.voice
	v.mu.Lock()
	stale := v.gen != g
	if !stale && err == nil {
		v.live.Store(&voiceLive{call: c})
	}
	v.mu.Unlock()
	switch {
	case stale:
		if err == nil {
			_ = c.Close()
		}
	case err != nil:
		post(func() { s.voiceFailed(ctx, g) })
	default:
		post(func() { s.voiceOpened(g) })
	}
}

// voiceOpened açılan motoru eşlere bağlar ve son durumu uygular.
func (s *session) voiceOpened(g uint64) {
	v := &s.voice
	l := v.live.Load()
	if g != v.gen || l == nil {
		return
	}
	for tid, tp := range s.peers {
		bindVoicePeer(l.call, tid, tp)
	}
	l.call.SetMuted(v.muted)
	s.voiceApply()
}

// voiceFailed mikrofon açılamadı ya da görüşmede aygıt koptu (V-PD-1): voice.end{device} + bırakma + yol tarifi.
func (s *session) voiceFailed(ctx context.Context, g uint64) {
	v := &s.voice
	if g != v.gen || v.consent == "" {
		return
	}
	s.voiceEndOnce(ctx, v.consent, signal.VoiceEndDevice)
	s.releaseMic(VoiceTexts.Device)
}

// releaseMic TEK bırakma yolu (idempotent; D-PD-5, O-PD-1).
func (s *session) releaseMic(note string) {
	if !s.voiceEnabled() {
		return
	}
	v := &s.voice
	v.mu.Lock()
	v.gen++
	l := v.live.Swap(nil)
	v.mu.Unlock()
	if l != nil {
		l.call.SetMuted(true)
		_ = l.call.Close()
	}
	had := v.consent != ""
	v.consent, v.muted, v.heard = "", false, nil
	if had || l != nil {
		s.d.VoiceUI.VoiceBar(VoiceView{Note: note})
	}
}

// voiceDrop soket/oturum sınırı (WS kopması, yeni hello, oturum sonu): diyalog kapanır, mikrofon bırakılır, sunucu
// durumu unutulur (yeniden bağlanınca sunucu yeniden yayar; eski görüşme `disconnect` ile bitmiştir, V-PD-7).
func (s *session) voiceDrop(note string) {
	if !s.voiceEnabled() {
		return
	}
	s.closeAsk()
	s.releaseMic(note)
	v := &s.voice
	v.phase, v.callID, v.talkers, v.listeners = "", "", nil, nil
}

// bindVoicePeer eşin giden ses izini motora bağlar (eski soketin tek eşi "" ve VoicePeer olmayan eş hariç).
func bindVoicePeer(c VoiceCall, tid string, tp *techPeer) {
	if tid == "" {
		return
	}
	if vp, ok := tp.p.(VoicePeer); ok {
		c.SetPeer(tid, vp.WriteAudio)
	}
}

// voicePeerAdded / voicePeerRemoved eş haritası değişimi (newPeer / closePeer / dropPeers).
func (s *session) voicePeerAdded(tid string, tp *techPeer) {
	if l := s.voice.live.Load(); l != nil {
		bindVoicePeer(l.call, tid, tp)
	}
}

func (s *session) voicePeerRemoved(tid string) {
	if l := s.voice.live.Load(); l != nil {
		l.call.RemovePeer(tid)
	}
}

// voiceAudio rtc.Handlers.Audio (RTP goroutine'i): yalnız canlı motora iletilir; s.voice'un başka alanına dokunulmaz.
func (s *session) voiceAudio(tid string) func(seq uint16, payload []byte) {
	if !s.voiceEnabled() {
		return nil
	}
	return func(seq uint16, payload []byte) {
		if l := s.voice.live.Load(); l != nil {
			l.call.Push(tid, seq, payload)
		}
	}
}

var errNoVoice = errors.New("flow: ses motoru açılamadı")

func setOf(a []string) map[string]bool {
	m := make(map[string]bool, len(a))
	for _, x := range a {
		m[x] = true
	}
	return m
}
