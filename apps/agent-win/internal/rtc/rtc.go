// Package rtc misafir tarafı WebRTC eşidir (Pion v4, MIT; mimari-protokol §3–4). Offer'ı teknisyen oluşturur
// (recvonly video + `ctl`/`file` DataChannel'ları); bu paket answer verir, ekran görüntüsünü sendonly H.264 track ile
// gönderir ve DC mesajlarını sözleşmeye göre doğrulayıp (internal/dc) yetenek filtresinden (G-09) geçirir.
// `input` kanalı (P7) yalnız `remote_control` yeteneği varken Handlers.Input'a iletilir; izin kararı alıcıdaki kapıdadır.
package rtc

import (
	"context"
	"errors"
	"slices"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/signal"
)

// Frame tek H.264 erişim birimi (Annex-B, başlangıç kodlu NAL'ler) ve görüntülenme süresi.
type Frame struct {
	Data     []byte
	Duration time.Duration
}

// Source video kaynağı (Windows'ta DXGI + Media Foundation H.264; testte sahte kaynak).
// NextFrame bir sonraki kareyi bekler; ctx iptal edilince veya kaynak kapanınca hata döner.
type Source interface {
	NextFrame(ctx context.Context) (Frame, error)
	Close() error
}

// KeyframeRequester kaynağın isteğe bağlı yeteneği: yayın başında ve alıcıdan PLI/FIR gelince anahtar kare (IDR)
// istenir. Çağrı RTCP goroutine'inden gelir; uygulama bloklamamalıdır.
type KeyframeRequester interface {
	RequestKeyframe()
}

// Handlers eş olaylarının alıcıları. Çağrılar Pion goroutine'lerinden gelir; alıcı UI iş parçacığına aktarır.
type Handlers struct {
	// LocalICE yerel ICE adayı (WS `ice` mesajı olarak teknisyene gider).
	LocalICE func(signal.Ice)
	// Ctl doğrulanmış ve yetenek filtresinden geçmiş `ctl` mesajı.
	Ctl func(dc.Ctl)
	// FileChunk `file` kanalının çözülmüş çerçevesi; bozuk çerçeve ok=false ile bildirilir (alıcı transferi iptal eder).
	FileChunk func(c dc.Chunk, ok bool)
	// Input `input` kanalının ham metin mesajı. Pion goroutine'inden eşzamanlı çağrılır (gecikme için akışa
	// aktarılmaz); alıcı (input.Applier) doğrular ve kapıyı SendInput'tan hemen önce denetler. nil ise kanal kapatılır.
	Input func(raw []byte)
	// State bağlantı durumu: "connected", "disconnected", "failed", "closed".
	State func(string)
	// Audio P28d: teknisyenin uzak Opus ses izinden gelen RTP yükü (seq: RTP sıra numarası). Yük alıcıya aittir
	// (her pakette yeni arabellek). İz başına tek okuma goroutine'inden sırayla, farklı eşlerden eşzamanlı çağrılır;
	// bloklamamalıdır. nil ise paketler okunup atılır.
	Audio func(seq uint16, payload []byte)
}

// Peer tek PeerConnection (P28c: teknisyen başına bir tane). Yeniden bağlanmada (AC-24) yenisi kurulur. Video izi
// paylaşılan Media'dan gelir: ana ya da düşük (SetMain → RTPSender.ReplaceTrack; ADR-0035).
type Peer struct {
	pc    *webrtc.PeerConnection
	media *Media
	h     Handlers

	mu      sync.Mutex
	caps    []string
	ctl     *webrtc.DataChannel
	pending []webrtc.ICECandidateInit // remote description gelmeden gelen adaylar
	hasDesc bool
	added   bool
	main    bool              // gönderici ana izde (kontrol sahibi) mı
	sender  *webrtc.RTPSender // ilk offer'da kurulur

	audio *webrtc.TrackLocalStaticSample // P28d: eşe giden Opus izi (teklifte ses yoksa nil)
}

// Option test ve ayar kancası.
type Option func(*webrtc.SettingEngine)

// MaxPendingICE offer'dan önce kuyruğa alınan uzak aday üst sınırı (S6-7); fazlası düşürülür. Normal bir eş
// birkaç düzine aday üretir; sınır, offer göndermeden aday yağdıran eşin istemci belleğini büyütmesini engeller.
const MaxPendingICE = 64

const capRemoteControl = "remote_control"

// ErrNoCtl `ctl` kanalı henüz açık değil.
var ErrNoCtl = errors.New("rtc: ctl kanalı açık değil")

// H264 RTP yeteneği: Baseline/Constrained Baseline, packetization-mode=1 (MF encoder Baseline üretir).
var h264 = webrtc.RTPCodecCapability{
	MimeType:    webrtc.MimeTypeH264,
	ClockRate:   90000,
	SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
}

// ICEConfig hello.iceServers / ice.servers → Pion yapılandırması.
func ICEConfig(list []signal.IceServer) webrtc.Configuration {
	servers := make([]webrtc.ICEServer, 0, len(list))
	for _, s := range list {
		srv := webrtc.ICEServer{URLs: append([]string(nil), s.URLs...), Username: s.Username}
		if s.Credential != "" {
			srv.Credential = s.Credential
		}
		servers = append(servers, srv)
	}
	return webrtc.Configuration{ICEServers: servers}
}

// New eşi kurar. caps hello.caps'tir (yetenek filtresi, G-09). m paylaşılan iz çiftidir (nil → yalnız bu eşe ait
// yeni çift); eş ana izle başlar (SetMain ile değişir).
func New(iceServers []signal.IceServer, caps []string, h Handlers, m *Media, opts ...Option) (*Peer, error) {
	if m == nil {
		nm, err := NewMedia()
		if err != nil {
			return nil, err
		}
		m = nm
	}
	se := webrtc.SettingEngine{}
	for _, o := range opts {
		o(&se)
	}
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
	pc, err := api.NewPeerConnection(ICEConfig(iceServers))
	if err != nil {
		return nil, err
	}
	p := &Peer{pc: pc, media: m, h: h, caps: append([]string(nil), caps...), main: true}
	pc.OnICECandidate(p.onLocalICE)
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		if h.State == nil {
			return
		}
		switch s {
		case webrtc.PeerConnectionStateConnected, webrtc.PeerConnectionStateDisconnected,
			webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			h.State(s.String())
		}
	})
	pc.OnDataChannel(p.onDataChannel)
	pc.OnTrack(p.onTrack)
	return p, nil
}

func (p *Peer) onLocalICE(c *webrtc.ICECandidate) {
	if c == nil || p.h.LocalICE == nil {
		return
	}
	init := c.ToJSON()
	m := signal.Ice{T: "ice", Candidate: init.Candidate, SdpMid: init.SDPMid}
	if init.SDPMLineIndex != nil {
		idx := int(*init.SDPMLineIndex)
		m.SdpMLineIndex = &idx
	}
	p.h.LocalICE(m)
}

func (p *Peer) onDataChannel(ch *webrtc.DataChannel) {
	switch ch.Label() {
	case dc.LabelCtl:
		ch.OnOpen(func() {
			p.mu.Lock()
			p.ctl = ch
			p.mu.Unlock()
		})
		ch.OnMessage(func(msg webrtc.DataChannelMessage) {
			if msg.IsString {
				p.handleCtl(msg.Data)
			}
		})
	case dc.LabelFile:
		ch.OnMessage(func(msg webrtc.DataChannelMessage) {
			if msg.IsString || p.h.FileChunk == nil {
				return
			}
			c, ok := dc.DecodeChunk(msg.Data)
			if ok {
				// Pion arabelleği yeniden kullanabilir; alıcı goroutine'e geçerken kopya gerekir.
				c.Payload = append([]byte(nil), c.Payload...)
			}
			p.h.FileChunk(c, ok)
		})
	case dc.LabelInput:
		if p.h.Input == nil {
			ch.OnOpen(func() { _ = ch.Close() })
			return
		}
		ch.OnMessage(func(msg webrtc.DataChannelMessage) {
			if !msg.IsString {
				return
			}
			p.mu.Lock()
			allowed := slices.Contains(p.caps, capRemoteControl) // G-09: yetenek yoksa düşür
			p.mu.Unlock()
			if allowed {
				p.h.Input(msg.Data)
			}
		})
	default:
		// Bilinmeyen kanallar: mesaj okunmaz, kanal kapatılır.
		ch.OnOpen(func() { _ = ch.Close() })
	}
}

// handleCtl doğrula → yetenek filtresi → alıcı. Yetenek dışı `file.offer` otomatik reddedilir (G-09).
func (p *Peer) handleCtl(raw []byte) {
	m, err := dc.ParseCtl(raw)
	if err != nil {
		return
	}
	p.mu.Lock()
	allowed := dc.Allowed(m.T, p.caps)
	p.mu.Unlock()
	if !allowed {
		if m.T == "file.offer" {
			if b, err := dc.FileReply("file.reject", m.FID); err == nil {
				_ = p.SendCtl(b)
			}
		}
		return
	}
	if p.h.Ctl != nil {
		p.h.Ctl(m)
	}
}

// SetCaps yetenek listesini günceller (caps.update, G-09).
func (p *Peer) SetCaps(caps []string) {
	p.mu.Lock()
	p.caps = append([]string(nil), caps...)
	p.mu.Unlock()
}

// SetICEServers ice.servers ile gelen yeni TURN kimlik bilgisini uygular (G-13).
func (p *Peer) SetICEServers(list []signal.IceServer) error {
	return p.pc.SetConfiguration(ICEConfig(list))
}

// HandleOffer teknisyenin offer'ına answer üretir. Video track'i offer'daki recvonly video transceiver'ına bağlanır
// (yerel yön sendonly). P28d: ilk offer'da gönderilebilir ses bölümü varsa eşin Opus izi de bağlanır (yön sendonly ya da
// sendrecv); yoksa eski konsol yolu aynen sürer. ICE yeniden başlatmada (ice.restart sonrası yeni offer) aynı yol
// kullanılır; izler yalnız ilk offer'da eklenir, çoğalmaz.
func (p *Peer) HandleOffer(sdp string) (signal.SdpAnswer, error) {
	if err := p.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: sdp}); err != nil {
		return signal.SdpAnswer{}, err
	}
	p.mu.Lock()
	p.hasDesc = true
	queued := p.pending
	p.pending = nil
	needTrack := !p.added
	p.added = true
	p.mu.Unlock()
	for _, c := range queued {
		_ = p.pc.AddICECandidate(c)
	}
	if needTrack {
		p.mu.Lock()
		track := p.media.track(p.main)
		p.mu.Unlock()
		sender, err := p.pc.AddTrack(track)
		if err != nil {
			return signal.SdpAnswer{}, err
		}
		p.mu.Lock()
		p.sender = sender
		p.mu.Unlock()
		go p.readRTCP(sender)
		p.requestKeyframe() // yeni eş IDR'siz başlamasın
		if offerWantsAudio(sdp) {
			if err := p.addAudio(); err != nil {
				return signal.SdpAnswer{}, err
			}
		}
	}
	answer, err := p.pc.CreateAnswer(nil)
	if err != nil {
		return signal.SdpAnswer{}, err
	}
	if err := p.pc.SetLocalDescription(answer); err != nil {
		return signal.SdpAnswer{}, err
	}
	return signal.SdpAnswer{T: "sdp.answer", SDP: p.pc.LocalDescription().SDP}, nil
}

// readRTCP interceptor'ların (NACK, rapor) çalışması için gelen RTCP'yi okur; PLI/FIR kaynaktan anahtar kare ister.
func (p *Peer) readRTCP(s *webrtc.RTPSender) {
	for {
		pkts, _, err := s.ReadRTCP()
		if err != nil {
			return
		}
		for _, pk := range pkts {
			switch pk.(type) {
			case *rtcp.PictureLossIndication, *rtcp.FullIntraRequest:
				p.requestKeyframe()
			}
		}
	}
}

// requestKeyframe eşin o anki izinin kodlayıcısından anahtar kare ister (PLI/FIR doğru saate gider).
func (p *Peer) requestKeyframe() {
	p.mu.Lock()
	main := p.main
	p.mu.Unlock()
	p.media.requestKeyframe(main)
}

// SetMain P28c (§6.1, AC-367): göndericiyi ana (true) ya da düşük (false) ize taşır (RTPSender.ReplaceTrack) ve yeni
// izden anahtar kare ister. Offer'dan önce çağrılırsa ilk AddTrack seçilen izi kullanır.
func (p *Peer) SetMain(main bool) error {
	p.mu.Lock()
	if p.main == main {
		p.mu.Unlock()
		return nil
	}
	p.main = main
	sender := p.sender
	p.mu.Unlock()
	if sender != nil {
		if err := sender.ReplaceTrack(p.media.track(main)); err != nil {
			return err
		}
	}
	p.media.requestKeyframe(main)
	return nil
}

// AddRemoteICE teknisyenin adayını ekler; remote description yoksa kuyruğa alır.
func (p *Peer) AddRemoteICE(m signal.RemoteIce) error {
	init := webrtc.ICECandidateInit{Candidate: m.Candidate, SDPMid: m.SdpMid}
	if m.SdpMLineIndex != nil {
		idx := uint16(*m.SdpMLineIndex)
		init.SDPMLineIndex = &idx
	}
	p.mu.Lock()
	if !p.hasDesc {
		if len(p.pending) < MaxPendingICE {
			p.pending = append(p.pending, init)
		}
		p.mu.Unlock()
		return nil
	}
	p.mu.Unlock()
	return p.pc.AddICECandidate(init)
}

// SendCtl doğrulanmış ctl çerçevesini gönderir (chat, file.accept/reject/result).
func (p *Peer) SendCtl(b []byte) error {
	p.mu.Lock()
	ch := p.ctl
	p.mu.Unlock()
	if ch == nil || ch.ReadyState() != webrtc.DataChannelStateOpen {
		return ErrNoCtl
	}
	return ch.SendText(string(b))
}

// Close eşi kapatır.
func (p *Peer) Close() error {
	return p.pc.Close()
}
