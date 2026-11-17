package rtc

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// opusSilence geçerli bir Opus çerçevesi (TOC 0xf8: CELT FB 20 ms, tek çerçeve; DTX sessizliği).
var opusSilence = []byte{0xf8, 0xff, 0xfe}

type audioPkt struct {
	seq     uint16
	payload []byte
}

// voiceTech konsolun guestVoice=true davranışı: video recvonly + DC'lere ek olarak ilk offer'da izsiz ses
// transceiver'ı (sahip/katılımcıda sendrecv, izleyicide recvonly). Gelen Opus yükleri gotAudio'ya düşer.
type voiceTech struct {
	*techPeer
	audioTr  *webrtc.RTPTransceiver
	gotAudio chan []byte
}

func newVoiceTech(t *testing.T, dir webrtc.RTPTransceiverDirection) *voiceTech {
	t.Helper()
	tp := newTech(t)
	vt := &voiceTech{techPeer: tp, gotAudio: make(chan []byte, 64)}
	tr, err := tp.pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{Direction: dir})
	if err != nil {
		t.Fatal(err)
	}
	vt.audioTr = tr
	tp.pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		switch tr.Codec().MimeType {
		case webrtc.MimeTypeH264:
			tp.ssrc.Store(uint32(tr.SSRC()))
			select {
			case tp.track <- struct{}{}:
			default:
			}
		case webrtc.MimeTypeOpus:
			for {
				pkt, _, err := tr.ReadRTP()
				if err != nil {
					return
				}
				select {
				case vt.gotAudio <- pkt.Payload:
				default:
				}
			}
		}
	})
	return vt
}

// audioSections yanıttaki ses m-line'larının yönü ve rtpmap satırları.
func audioSections(t *testing.T, sdpText string) (dirs []string, rtpmaps [][]string) {
	t.Helper()
	desc := webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: sdpText}
	sd, err := desc.Unmarshal()
	if err != nil {
		t.Fatal(err)
	}
	for _, md := range sd.MediaDescriptions {
		if md.MediaName.Media != "audio" {
			continue
		}
		dir := "sendrecv"
		var maps []string
		for _, a := range md.Attributes {
			switch a.Key {
			case "sendrecv", "sendonly", "recvonly", "inactive":
				dir = a.Key
			case "rtpmap":
				maps = append(maps, a.Value)
			}
		}
		dirs = append(dirs, dir)
		rtpmaps = append(rtpmaps, maps)
	}
	return dirs, rtpmaps
}

func hasOpus(maps []string) bool {
	for _, m := range maps {
		if strings.HasSuffix(strings.ToLower(m), " opus/48000/2") {
			return true
		}
	}
	return false
}

// AC-375: konsolun izsiz ses transceiver'ına yanıt Opus 48000/2 ile verilir; izleyicinin recvonly teklifine sendonly,
// konuşabilen teknisyenin sendrecv teklifine sendrecv. İz teklifteki transceiver'a bağlanır (yeni m-line açılmaz).
func TestAC375P28dAnswerOpusDirection(t *testing.T) {
	for _, tc := range []struct {
		offer webrtc.RTPTransceiverDirection
		want  string
	}{
		{webrtc.RTPTransceiverDirectionRecvonly, "sendonly"},
		{webrtc.RTPTransceiverDirectionSendrecv, "sendrecv"},
	} {
		t.Run(tc.offer.String(), func(t *testing.T) {
			tech := newVoiceTech(t, tc.offer)
			guest, ans := dial(t, tech.techPeer, nil, Handlers{})
			dirs, maps := audioSections(t, ans.SDP)
			if len(dirs) != 1 || dirs[0] != tc.want {
				t.Fatalf("ses bölümleri %v, beklenen [%s]", dirs, tc.want)
			}
			if !hasOpus(maps[0]) {
				t.Fatalf("yanıtta opus/48000/2 yok: %v", maps[0])
			}
			if n := len(guest.pc.GetTransceivers()); n != 2 {
				t.Fatalf("misafir transceiver sayısı %d, beklenen 2 (video + ses)", n)
			}
			if guest.audio == nil {
				t.Fatal("ses izi bağlanmadı")
			}
		})
	}
}

// Eski konsol (guestVoice=false) ya da ses kapalı oturum: teklifte ses yok → yanıtta ses m-line'ı yok, yazım ErrNoAudio.
func TestP28dSilentOfferNoAudioLine(t *testing.T) {
	tech := newTech(t)
	guest, ans := dial(t, tech, nil, Handlers{})
	if dirs, _ := audioSections(t, ans.SDP); len(dirs) != 0 {
		t.Fatalf("sessiz teklife ses bölümü eklendi: %v", dirs)
	}
	if n := len(guest.pc.GetTransceivers()); n != 1 {
		t.Fatalf("transceiver sayısı %d, beklenen 1", n)
	}
	if err := guest.WriteAudio(opusSilence, 20*time.Millisecond); !errors.Is(err, ErrNoAudio) {
		t.Fatalf("WriteAudio: %v, beklenen ErrNoAudio", err)
	}
}

// Teklifteki ses bölümü misafirin gönderemeyeceği yöndeyse (sendonly) iz bağlanmaz ve fazladan transceiver açılmaz.
func TestP28dSendonlyOfferNoGuestAudio(t *testing.T) {
	tech := newVoiceTech(t, webrtc.RTPTransceiverDirectionSendonly)
	guest, ans := dial(t, tech.techPeer, nil, Handlers{})
	if dirs, _ := audioSections(t, ans.SDP); len(dirs) != 1 || dirs[0] != "recvonly" {
		t.Fatalf("ses bölümleri %v, beklenen [recvonly]", dirs)
	}
	if n := len(guest.pc.GetTransceivers()); n != 2 {
		t.Fatalf("transceiver sayısı %d, beklenen 2", n)
	}
	if !errors.Is(guest.WriteAudio(opusSilence, 20*time.Millisecond), ErrNoAudio) {
		t.Fatal("gönderilemeyen teklifte ses izi bağlandı")
	}
}

func audioSender(t *testing.T, p *Peer) *webrtc.RTPSender {
	t.Helper()
	for _, tr := range p.pc.GetTransceivers() {
		if tr.Kind() == webrtc.RTPCodecTypeAudio {
			return tr.Sender()
		}
	}
	t.Fatal("ses transceiver'ı yok")
	return nil
}

// AC-375 / ADR-0036 m.5: ICE yeniden başlatma offer'ında ses izi çoğalmaz (tek ses m-line'ı, aynı gönderici ve iz).
func TestAC375P28dICERestartNoDuplicateTrack(t *testing.T) {
	tech := newVoiceTech(t, webrtc.RTPTransceiverDirectionSendrecv)
	state := make(chan string, 8)
	guest, _ := dial(t, tech.techPeer, nil, Handlers{State: func(s string) { state <- s }})
	for s := ""; s != "connected"; {
		s = wait(t, state, "bağlantı")
	}
	sender, track := audioSender(t, guest), guest.audio
	nTr, nSnd := len(guest.pc.GetTransceivers()), len(guest.pc.GetSenders())

	ans := negotiate(t, tech.techPeer, guest, &webrtc.OfferOptions{ICERestart: true})
	if dirs, _ := audioSections(t, ans.SDP); len(dirs) != 1 || dirs[0] != "sendrecv" {
		t.Fatalf("yeniden başlatma yanıtında ses bölümleri %v", dirs)
	}
	if len(guest.pc.GetTransceivers()) != nTr || len(guest.pc.GetSenders()) != nSnd {
		t.Fatalf("transceiver/gönderici çoğaldı: %d/%d → %d/%d", nTr, nSnd,
			len(guest.pc.GetTransceivers()), len(guest.pc.GetSenders()))
	}
	if audioSender(t, guest) != sender || guest.audio != track {
		t.Fatal("ses göndericisi/izi değişti")
	}
}

// AC-375: Opus yükü iki yönde taşınır — WriteAudio teknisyene ulaşır; teknisyenin (replaceTrack sonrası) yükü sıra
// numarasıyla Handlers.Audio'ya ulaşır.
func TestAC375P28dOpusBothWays(t *testing.T) {
	tech := newVoiceTech(t, webrtc.RTPTransceiverDirectionSendrecv)
	got := make(chan audioPkt, 64)
	guest, _ := dial(t, tech.techPeer, nil, Handlers{Audio: func(seq uint16, p []byte) {
		select {
		case got <- audioPkt{seq, p}:
		default:
		}
	}})

	// Misafir → teknisyen: bağlantı kurulana dek ilk örnekler düşebilir; alınana kadar 20 ms'de bir yazılır.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		tk := time.NewTicker(20 * time.Millisecond)
		defer tk.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tk.C:
				_ = guest.WriteAudio(opusSilence, 20*time.Millisecond)
			}
		}
	}()
	if p := wait(t, tech.gotAudio, "teknisyende Opus yükü"); !bytes.Equal(p, opusSilence) {
		t.Fatalf("teknisyende yük %x", p)
	}

	// Teknisyen → misafir: konsolun replaceTrack(track) davranışı.
	mic, err := webrtc.NewTrackLocalStaticSample(opus, "mic", "console")
	if err != nil {
		t.Fatal(err)
	}
	if err := tech.audioTr.Sender().ReplaceTrack(mic); err != nil {
		t.Fatal(err)
	}
	frame := []byte{0xf8, 0x01, 0x02, 0x03}
	go func() {
		tk := time.NewTicker(20 * time.Millisecond)
		defer tk.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tk.C:
				_ = mic.WriteSample(media.Sample{Data: frame, Duration: 20 * time.Millisecond})
			}
		}
	}()
	a := wait(t, got, "Handlers.Audio")
	if !bytes.Equal(a.payload, frame) {
		t.Fatalf("Handlers.Audio yükü %x", a.payload)
	}
	b := wait(t, got, "ikinci paket")
	if b.seq != a.seq+1 {
		t.Fatalf("sıra numarası %d → %d (ardışık değil)", a.seq, b.seq)
	}
}

// Handlers.Audio nil iken uzak ses izi yine okunur (çökme yok); gönderim yolu etkilenmez.
func TestP28dNilAudioHandlerStillReads(t *testing.T) {
	tech := newVoiceTech(t, webrtc.RTPTransceiverDirectionSendrecv)
	guest, _ := dial(t, tech.techPeer, nil, Handlers{})
	mic, err := webrtc.NewTrackLocalStaticSample(opus, "mic", "console")
	if err != nil {
		t.Fatal(err)
	}
	if err := tech.audioTr.Sender().ReplaceTrack(mic); err != nil {
		t.Fatal(err)
	}
	for i := 0; ; i++ {
		_ = mic.WriteSample(media.Sample{Data: opusSilence, Duration: 20 * time.Millisecond})
		_ = guest.WriteAudio(opusSilence, 20*time.Millisecond)
		select {
		case <-tech.gotAudio:
			return
		case <-time.After(20 * time.Millisecond):
		}
		if i > 750 {
			t.Fatal("zaman aşımı: teknisyende Opus yükü")
		}
	}
}
