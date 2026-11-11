// Package rtc misafir tarafı WebRTC eşidir (Pion v4, MIT; mimari-protokol §3–4). Offer'ı teknisyen oluşturur
// (recvonly video + `ctl`/`file` DataChannel'ları); bu paket answer verir, ekran görüntüsünü sendonly H.264 track ile
// gönderir ve DC mesajlarını sözleşmeye göre doğrulayıp (internal/dc) yetenek filtresinden (G-09) geçirir.
// `input` kanalı P7'dedir: bu pakette açılırsa yok sayılır (mesajları okunmaz).
package rtc

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"

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
	// State bağlantı durumu: "connected", "disconnected", "failed", "closed".
	State func(string)
}

// Peer tek PeerConnection. Yeniden bağlanmada (AC-24) yenisi kurulur.
type Peer struct {
	pc    *webrtc.PeerConnection
	track *webrtc.TrackLocalStaticSample
	h     Handlers

	mu      sync.Mutex
	caps    []string
	ctl     *webrtc.DataChannel
	pending []webrtc.ICECandidateInit // remote description gelmeden gelen adaylar
	hasDesc bool
	added   bool
	kf      KeyframeRequester // yayındaki kaynak (Stream süresince)
}

// Option test ve ayar kancası.
type Option func(*webrtc.SettingEngine)

// MaxPendingICE offer'dan önce kuyruğa alınan uzak aday üst sınırı (S6-7); fazlası düşürülür. Normal bir eş
// birkaç düzine aday üretir; sınır, offer göndermeden aday yağdıran eşin istemci belleğini büyütmesini engeller.
const MaxPendingICE = 64

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

// New eşi kurar. caps hello.caps'tir (yetenek filtresi, G-09).
func New(iceServers []signal.IceServer, caps []string, h Handlers, opts ...Option) (*Peer, error) {
	se := webrtc.SettingEngine{}
	for _, o := range opts {
		o(&se)
	}
	api := webrtc.NewAPI(webrtc.WithSettingEngine(se))
	pc, err := api.NewPeerConnection(ICEConfig(iceServers))
	if err != nil {
		return nil, err
	}
	track, err := webrtc.NewTrackLocalStaticSample(h264, "video", "noktadestek")
	if err != nil {
		_ = pc.Close()
		return nil, err
	}
	p := &Peer{pc: pc, track: track, h: h, caps: append([]string(nil), caps...)}
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
	default:
		// `input` (P7) ve bilinmeyen kanallar: mesaj okunmaz, kanal kapatılır.
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

// SetCaps yetenek listesini günceller (caps.update P7'de sözleşmeye eklenince).
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
// (yerel yön sendonly). ICE yeniden başlatmada (ice.restart sonrası yeni offer) aynı yol kullanılır.
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
		sender, err := p.pc.AddTrack(p.track)
		if err != nil {
			return signal.SdpAnswer{}, err
		}
		go p.readRTCP(sender)
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

func (p *Peer) requestKeyframe() {
	p.mu.Lock()
	kf := p.kf
	p.mu.Unlock()
	if kf != nil {
		kf.RequestKeyframe()
	}
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

// Stream kaynaktan kareleri ctx bitene veya kaynak hata verene kadar track'e yazar. Kaynağı kapatmaz.
// Kaynak KeyframeRequester ise yayın başında anahtar kare istenir (yeniden bağlanmada yeni eş IDR'siz başlamasın).
func (p *Peer) Stream(ctx context.Context, src Source) error {
	if kf, ok := src.(KeyframeRequester); ok {
		p.mu.Lock()
		p.kf = kf
		p.mu.Unlock()
		defer func() {
			p.mu.Lock()
			p.kf = nil
			p.mu.Unlock()
		}()
		kf.RequestKeyframe()
	}
	for {
		f, err := src.NextFrame(ctx)
		if err != nil {
			return err
		}
		if err := p.track.WriteSample(media.Sample{Data: f.Data, Duration: f.Duration}); err != nil {
			return err
		}
	}
}

// Close eşi kapatır.
func (p *Peer) Close() error {
	return p.pc.Close()
}
