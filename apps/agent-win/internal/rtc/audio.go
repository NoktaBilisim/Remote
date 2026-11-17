package rtc

import (
	"errors"
	"strings"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// P28d (mimari-p28d §4.3, ADR-0036 m.5): konsol `guestVoice=true` iken ilk offer'a izsiz bir ses transceiver'ı koyar
// (sahip/katılımcıda sendrecv, izleyicide recvonly). Misafir eş başına bir Opus izi bağlar; yanıtta sendrecv/sendonly
// olur, yeniden müzakere gerekmez. Bu paket kodlamaz/çözmez: Opus yükü taşır (kodlayıcı internal/voice'tadır).

// ErrNoAudio eşin ses izi yok (teklifte gönderilebilir ses m-line'ı yoktu: eski konsol ya da ses kapalı oturum).
var ErrNoAudio = errors.New("rtc: ses izi yok")

// opus yerel ses izinin yeteneği (pion varsayılan Opus kaydıyla aynı: PT 111).
var opus = webrtc.RTPCodecCapability{
	MimeType:    webrtc.MimeTypeOpus,
	ClockRate:   48000,
	Channels:    2,
	SDPFmtpLine: "minptime=10;useinbandfec=1",
}

// offerWantsAudio uzak teklifte misafirin gönderebileceği bir ses bölümü (reddedilmemiş, yönü recvonly/sendrecv) var
// mı. Transceiver.Direction() uzak sendrecv ile sendonly'yi ayırmadığı için SDP okunur; uygun bölüm yokken AddTrack
// yanıta girmeyen yeni bir transceiver kurardı. Teklif metni yerel kopyadan ayrıştırılır: pc.RemoteDescription()
// pion'un iç nesnesidir ve Unmarshal önbelleğine yazar (pion goroutine'leriyle veri yarışı).
func offerWantsAudio(offerSDP string) bool {
	desc := webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offerSDP}
	sd, err := desc.Unmarshal()
	if err != nil {
		return false
	}
	for _, md := range sd.MediaDescriptions {
		if md.MediaName.Media != "audio" || md.MediaName.Port.Value == 0 {
			continue
		}
		dir := "sendrecv"
		for _, a := range []string{"sendrecv", "sendonly", "recvonly", "inactive"} {
			if _, ok := md.Attribute(a); ok {
				dir = a
				break
			}
		}
		if dir == "sendrecv" || dir == "recvonly" {
			return true
		}
	}
	return false
}

// addAudio ilk teklifte eşin Opus izini teklifteki ses transceiver'ına bağlar ve gönderici RTCP'sini okur.
func (p *Peer) addAudio() error {
	track, err := webrtc.NewTrackLocalStaticSample(opus, "audio", "noktadestek")
	if err != nil {
		return err
	}
	before := len(p.pc.GetTransceivers())
	sender, err := p.pc.AddTrack(track)
	if err != nil {
		return err
	}
	if len(p.pc.GetTransceivers()) != before {
		// Teklifteki bölüm yeniden kullanılamadı; yanıta girmeyecek iz bırakılmaz.
		_ = p.pc.RemoveTrack(sender)
		return errors.New("rtc: ses izi teklifteki transceiver'a bağlanamadı")
	}
	p.mu.Lock()
	p.audio = track
	p.mu.Unlock()
	go drainRTCP(sender)
	return nil
}

// drainRTCP interceptor'ların (rapor, NACK) çalışması için ses göndericisinin RTCP'sini okuyup atar.
func drainRTCP(s *webrtc.RTPSender) {
	for {
		if _, _, err := s.ReadRTCP(); err != nil {
			return
		}
	}
}

// onTrack uzak ses izini okur. Opus olmasa ya da Handlers.Audio nil olsa da okunur (alım arabelleği birikmesin);
// döngü eş kapanınca ReadRTP hatasıyla biter. Video (teknisyenden gelmez) yok sayılır.
func (p *Peer) onTrack(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
	if tr.Kind() != webrtc.RTPCodecTypeAudio {
		return
	}
	isOpus := strings.EqualFold(tr.Codec().MimeType, webrtc.MimeTypeOpus)
	go func() {
		for {
			pkt, _, err := tr.ReadRTP()
			if err != nil {
				return
			}
			if isOpus && p.h.Audio != nil && len(pkt.Payload) > 0 {
				p.h.Audio(pkt.SequenceNumber, pkt.Payload) // ReadRTP her pakette yeni arabellek ayırır
			}
		}
	}()
}

// WriteAudio kodlanmış tek Opus çerçevesini (dur: çerçeve süresi, ör. 20 ms) bu eşin ses izine yazar. Eşin ses izi
// yoksa ErrNoAudio döner. Bağlantı kurulmadan yazılan örnek sessizce düşer.
func (p *Peer) WriteAudio(payload []byte, dur time.Duration) error {
	p.mu.Lock()
	track := p.audio
	p.mu.Unlock()
	if track == nil {
		return ErrNoAudio
	}
	return track.WriteSample(media.Sample{Data: payload, Duration: dur})
}
