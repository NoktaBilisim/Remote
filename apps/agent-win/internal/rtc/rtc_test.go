package rtc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/signal"
)

// techPeer tarayıcı konsolunun eşi gibi davranır: recvonly video + ctl/file DC ile offer oluşturur.
type techPeer struct {
	pc    *webrtc.PeerConnection
	ctl   *webrtc.DataChannel
	track chan struct{}
	ctlIn chan string
	open  chan struct{}
	ssrc  atomic.Uint32
	input *webrtc.DataChannel
}

func newTech(t *testing.T) *techPeer {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo,
		webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		t.Fatal(err)
	}
	ctl, err := pc.CreateDataChannel(dc.LabelCtl, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pc.CreateDataChannel(dc.LabelFile, nil); err != nil {
		t.Fatal(err)
	}
	input, err := pc.CreateDataChannel(dc.LabelInput, nil)
	if err != nil {
		t.Fatal(err)
	}
	tp := &techPeer{pc: pc, ctl: ctl, input: input, track: make(chan struct{}, 1), ctlIn: make(chan string, 8), open: make(chan struct{})}
	pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if tr.Codec().MimeType == webrtc.MimeTypeH264 {
			tp.ssrc.Store(uint32(tr.SSRC()))
			select {
			case tp.track <- struct{}{}:
			default:
			}
		}
	})
	ctl.OnOpen(func() { close(tp.open) })
	ctl.OnMessage(func(m webrtc.DataChannelMessage) { tp.ctlIn <- string(m.Data) })
	t.Cleanup(func() { _ = pc.Close() })
	return tp
}

// relay mesajı sunucunun yapacağı gibi JSON'a çevirip misafir şemasıyla (ParseServer) doğrular.
func relay(t *testing.T, v any) signal.Inbound {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	m, err := signal.ParseServer(b)
	if err != nil {
		t.Fatalf("ParseServer(%s): %v", b, err)
	}
	return m
}

type fakeSource struct{ n int }

func (s *fakeSource) NextFrame(ctx context.Context) (Frame, error) {
	select {
	case <-ctx.Done():
		return Frame{}, ctx.Err()
	case <-time.After(33 * time.Millisecond):
	}
	s.n++
	// SPS + PPS + IDR dilimi (içerik anlamsız; paketleyici yalnız NAL sınırlarına bakar).
	return Frame{Data: []byte{0, 0, 0, 1, 0x67, 0x42, 0xe0, 0x1f, 0, 0, 0, 1, 0x68, 0xce, 0, 0, 0, 1, 0x65, 0x88, byte(s.n)},
		Duration: 33 * time.Millisecond}, nil
}

func (s *fakeSource) Close() error { return nil }

func wait[T any](t *testing.T, ch <-chan T, what string) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(15 * time.Second):
		t.Fatalf("zaman aşımı: %s", what)
	}
	var zero T
	return zero
}

func connect(t *testing.T, caps []string, ctlOut chan dc.Ctl) (*techPeer, *Peer) {
	t.Helper()
	return connectInput(t, caps, ctlOut, nil)
}

func connectInput(t *testing.T, caps []string, ctlOut chan dc.Ctl, input func([]byte)) (*techPeer, *Peer) {
	t.Helper()
	tech := newTech(t)
	guest, _ := dial(t, tech, caps, Handlers{Ctl: func(m dc.Ctl) { ctlOut <- m }, Input: input})
	return tech, guest
}

// dial misafir eşini kurar ve teknisyenin offer'ını sunucu şemalarından geçirerek misafire iletir; h.LocalICE
// teknisyene bağlanır. Dönen yanıt teknisyende uygulanmıştır.
func dial(t *testing.T, tech *techPeer, caps []string, h Handlers) (*Peer, signal.SdpAnswer) {
	t.Helper()
	return dialMedia(t, tech, caps, h, testMedia(t))
}

// dialMedia dial'ın verilen iz çiftiyle kurulan biçimi (P28g: codec testi).
func dialMedia(t *testing.T, tech *techPeer, caps []string, h Handlers, m *Media) (*Peer, signal.SdpAnswer) {
	t.Helper()
	var guest *Peer
	var err error
	h.LocalICE = func(m signal.Ice) {
		// misafir → sunucu: Encode doğrular; sunucu id'siz yeniden kurup teknisyene iletir.
		if _, err := signal.Encode(m); err != nil {
			t.Errorf("ice encode: %v", err)
			return
		}
		init := webrtc.ICECandidateInit{Candidate: m.Candidate, SDPMid: m.SdpMid}
		if m.SdpMLineIndex != nil {
			v := uint16(*m.SdpMLineIndex)
			init.SDPMLineIndex = &v
		}
		_ = tech.pc.AddICECandidate(init)
	}
	guest, err = New(nil, caps, h, m)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = guest.Close() })
	// closing guest.Close'dan önce kurulur (Cleanup LIFO). Kök neden (2026-11-19): teknisyenin aday toplaması test
	// gövdesi bittikten sonra da sürer; Cleanup misafiri kapatınca pion ICE ajanını nil'ler ve geç gelen aday
	// "ICEAgent does not exist" döner. Kapanış başladıktan sonraki hata beklenen sonuçtur, test hatası değildir.
	var closing atomic.Bool
	t.Cleanup(func() { closing.Store(true) })

	tech.pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil || closing.Load() {
			return
		}
		j := c.ToJSON()
		msg := map[string]any{"t": "ice", "candidate": j.Candidate}
		if j.SDPMid != nil {
			msg["sdpMid"] = *j.SDPMid
		}
		if j.SDPMLineIndex != nil {
			msg["sdpMLineIndex"] = *j.SDPMLineIndex
		}
		if err := guest.AddRemoteICE(relay(t, msg).(signal.RemoteIce)); err != nil && !closing.Load() {
			t.Errorf("AddRemoteICE: %v", err)
		}
	})
	return guest, negotiate(t, tech, guest, nil)
}

// negotiate teknisyenden yeni bir offer (opts: ör. ICE yeniden başlatma) üretir, misafire iletir, yanıtı uygular.
func negotiate(t *testing.T, tech *techPeer, guest *Peer, opts *webrtc.OfferOptions) signal.SdpAnswer {
	t.Helper()
	offer, err := tech.pc.CreateOffer(opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := tech.pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	in := relay(t, map[string]any{"t": "sdp.offer", "sdp": offer.SDP}).(signal.SdpOffer)
	ans, err := guest.HandleOffer(in.SDP)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := signal.Encode(ans); err != nil {
		t.Fatalf("answer encode: %v", err)
	}
	if err := tech.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: ans.SDP}); err != nil {
		t.Fatal(err)
	}
	return ans
}

func TestAC52SignalMappingVideoAndCtl(t *testing.T) {
	ctlOut := make(chan dc.Ctl, 8)
	tech, guest := connect(t, []string{"file_transfer"}, ctlOut)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = guest.media.Stream(ctx, &fakeSource{}) }()
	wait(t, tech.track, "teknisyende H.264 track")

	wait(t, tech.open, "ctl açılışı")
	// AC-264 / P22-G: DC `chat` tanınmaz (sohbet yalnız WS) — düşer, kanal açık kalır. Şema dışı mesaj da düşer;
	// ardından gelen geçerli mesaj yine ulaşır.
	if err := tech.ctl.SendText(`{"t":"chat","id":"m1","text":"Merhaba","ts":1}`); err != nil {
		t.Fatal(err)
	}
	_ = tech.ctl.SendText(`{"t":"control.request"}`)
	_ = tech.ctl.SendText(`{"t":"ping"}`)
	if m := wait(t, ctlOut, "ping"); m.T != "ping" {
		t.Fatalf("beklenen ping, gelen %q", m.T)
	}
	// Misafir → teknisyen ctl
	time.Sleep(100 * time.Millisecond)
	b, _ := json.Marshal(map[string]any{"t": "file.result", "fid": "f1", "ok": true})
	if err := guest.SendCtl(b); err != nil {
		t.Fatal(err)
	}
	if got := wait(t, tech.ctlIn, "misafir ctl"); got != string(b) {
		t.Fatalf("misafir ctl: %s", got)
	}
}

func TestAC119FileOfferRejectedWithoutCap(t *testing.T) {
	ctlOut := make(chan dc.Ctl, 8)
	tech, _ := connect(t, nil, ctlOut)
	wait(t, tech.open, "ctl açılışı")
	time.Sleep(100 * time.Millisecond) // misafirin ctl OnOpen'ı
	offer := `{"t":"file.offer","fid":"f1","idx":0,"name":"a.txt","size":3,"sha256":"` +
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" + `"}`
	if err := tech.ctl.SendText(offer); err != nil {
		t.Fatal(err)
	}
	if got := wait(t, tech.ctlIn, "otomatik ret"); got != `{"t":"file.reject","fid":"f1"}` {
		t.Fatalf("beklenen file.reject, gelen %s", got)
	}
	select {
	case m := <-ctlOut:
		t.Fatalf("yetenek dışı teklif uygulamaya ulaştı: %+v", m)
	case <-time.After(200 * time.Millisecond):
	}
}

func TestAddRemoteICEBeforeOfferIsQueued(t *testing.T) {
	p, err := New(nil, nil, Handlers{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	mid := "0"
	idx := 0
	if err := p.AddRemoteICE(signal.RemoteIce{T: "ice", Candidate: "candidate:1 1 udp 1 192.0.2.1 9 typ host",
		SdpMid: &mid, SdpMLineIndex: &idx}); err != nil {
		t.Fatal(err)
	}
	if len(p.pending) != 1 {
		t.Fatalf("aday kuyruğa alınmadı")
	}
	if !errors.Is(p.SendCtl([]byte(`{}`)), ErrNoCtl) {
		t.Fatal("ctl açık değilken gönderim reddedilmeli")
	}
}

// S6-7: offer gelmeden gelen adaylar sınırlı kuyrukta tutulur; fazlası hata vermeden düşer.
func TestS67PendingICEBounded(t *testing.T) {
	p, err := New(nil, nil, Handlers{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	mid := "0"
	for i := 0; i < MaxPendingICE*3; i++ {
		if err := p.AddRemoteICE(signal.RemoteIce{T: "ice", Candidate: "candidate:1 1 udp 1 192.0.2.1 9 typ host",
			SdpMid: &mid}); err != nil {
			t.Fatal(err)
		}
	}
	p.mu.Lock()
	n := len(p.pending)
	p.mu.Unlock()
	if n != MaxPendingICE {
		t.Fatalf("kuyruk %d, beklenen %d", n, MaxPendingICE)
	}
}

func TestICEConfigMapsServers(t *testing.T) {
	cfg := ICEConfig([]signal.IceServer{{URLs: []string{"turns:turn.example:443"}, Username: "u", Credential: "c"}})
	if len(cfg.ICEServers) != 1 || cfg.ICEServers[0].Username != "u" || cfg.ICEServers[0].Credential != "c" {
		t.Fatalf("%+v", cfg)
	}
}

// kfSource anahtar kare isteklerini sayar (capture kaynağının PLI/FIR kancası).
type kfSource struct {
	fakeSource
	req chan struct{}
}

func (s *kfSource) RequestKeyframe() {
	select {
	case s.req <- struct{}{}:
	default:
	}
}

func TestAC41KeyframeOnStreamStartAndPLI(t *testing.T) {
	tech, guest := connect(t, nil, make(chan dc.Ctl, 8))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	src := &kfSource{req: make(chan struct{}, 4)}
	go func() { _ = guest.media.Stream(ctx, src) }()
	wait(t, src.req, "yayın başında anahtar kare isteği")
	wait(t, tech.track, "teknisyende H.264 track")
	for _, pk := range []rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: tech.ssrc.Load()},
		&rtcp.FullIntraRequest{MediaSSRC: tech.ssrc.Load(), FIR: []rtcp.FIREntry{{SSRC: tech.ssrc.Load(), SequenceNumber: 1}}}} {
		if err := tech.pc.WriteRTCP([]rtcp.Packet{pk}); err != nil {
			t.Fatal(err)
		}
		wait(t, src.req, fmt.Sprintf("%T sonrası anahtar kare isteği", pk))
	}
}

// G-09 + P7: input kanalı yalnız remote_control yeteneğinde alıcıya ulaşır; caps.update ile daralınca düşer.
func TestAC115InputChannelFollowsCaps(t *testing.T) {
	got := make(chan string, 8)
	tech, guest := connectInput(t, []string{"remote_control"}, make(chan dc.Ctl, 8), func(b []byte) { got <- string(b) })
	inOpen := make(chan struct{})
	tech.input.OnOpen(func() { close(inOpen) })
	wait(t, inOpen, "input açılışı")
	if err := tech.input.SendText(`{"t":"m.move","x":0.5,"y":0.5}`); err != nil {
		t.Fatal(err)
	}
	if m := wait(t, got, "input iletimi"); m != `{"t":"m.move","x":0.5,"y":0.5}` {
		t.Fatalf("gelen %s", m)
	}
	guest.SetCaps([]string{"file_transfer"})
	_ = tech.input.SendText(`{"t":"m.move","x":0.1,"y":0.1}`)
	select {
	case m := <-got:
		t.Fatalf("yetenek kaldırıldıktan sonra input iletildi: %s", m)
	case <-time.After(300 * time.Millisecond):
	}
}

func testMedia(t *testing.T) *Media {
	t.Helper()
	m, err := NewMedia(H264)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// lowKfSource ana/düşük anahtar kare isteklerini ayırır (P28c ayrı saat).
type lowKfSource struct {
	kfSource
	low chan struct{}
}

func (s *lowKfSource) SetLowSink(func(Frame)) {}
func (s *lowKfSource) EnableLow(bool)         {}
func (s *lowKfSource) RequestLowKeyframe() {
	select {
	case s.low <- struct{}{}:
	default:
	}
}

// AC-367/AC-371: kontrol devrinde gönderici ReplaceTrack ile düşük ize geçer ve düşük kodlayıcıdan anahtar kare ister.
func TestAC367SetMainReplacesTrack(t *testing.T) {
	_, guest := connect(t, nil, make(chan dc.Ctl, 8))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	src := &lowKfSource{kfSource: kfSource{req: make(chan struct{}, 4)}, low: make(chan struct{}, 4)}
	go func() { _ = guest.media.Stream(ctx, src) }()
	wait(t, src.req, "yayın başı anahtar kare")
	if guest.sender == nil || guest.sender.Track() != guest.media.main {
		t.Fatal("ilk iz ana olmalı")
	}
	if err := guest.SetMain(false); err != nil {
		t.Fatal(err)
	}
	wait(t, src.low, "düşük anahtar kare")
	if guest.sender.Track() != guest.media.low {
		t.Fatal("ReplaceTrack düşük ize geçmedi")
	}
}
