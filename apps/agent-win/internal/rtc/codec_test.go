package rtc

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// vp8Source anahtar kare VP8 çerçevesi üretir (çerçeve etiketi bit 0 == 0; içerik anlamsız, paketleyici bakmaz).
type vp8Source struct{}

func (vp8Source) NextFrame(ctx context.Context) (Frame, error) {
	select {
	case <-ctx.Done():
		return Frame{}, ctx.Err()
	case <-time.After(33 * time.Millisecond):
	}
	return Frame{Data: []byte{0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0xe0, 0x01}, Duration: 33 * time.Millisecond}, nil
}

func (vp8Source) Close() error { return nil }

// codecPeers tarayıcı teklifi (pion varsayılanı: VP8 + H.264 vb.) ile verilen codec'li misafir eşini bağlar ve yayını
// başlatır; yanıt SDP'sini ve teknisyende açılan izin MIME türünü döner.
func codecPeers(t *testing.T, codec Codec, src Source) (string, <-chan string) {
	t.Helper()
	tech := newTech(t)
	mime := make(chan string, 1)
	tech.pc.OnTrack(func(tr *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		select {
		case mime <- tr.Codec().MimeType:
		default:
		}
	})
	m, err := NewMedia(codec)
	if err != nil {
		t.Fatal(err)
	}
	_, ans := dialMedia(t, tech, nil, Handlers{}, m)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go func() { _ = m.Stream(ctx, src) }()
	return ans.SDP, mime
}

// AC-398 (mimari-p28g §4.4, ADR-0038 m.3): Linux iz çifti VP8; tarayıcı teklifiyle müzakere edilen ve teknisyende
// açılan iz VP8'dir (pion yanıtı medya motorunun kodeklerini listeler; bağlanan codec izin codec'idir). Ana ve düşük
// iz aynı codec (ReplaceTrack yeniden müzakere istemez).
func TestAC398P28gNewMediaVP8(t *testing.T) {
	sdp, mime := codecPeers(t, VP8, vp8Source{})
	if !strings.Contains(sdp, "VP8/90000") {
		t.Fatalf("yanıtta VP8 yok:\n%s", sdp)
	}
	if got := wait(t, mime, "teknisyende VP8 izi"); got != webrtc.MimeTypeVP8 {
		t.Fatalf("iz codec'i %q", got)
	}
	m, err := NewMedia(VP8)
	if err != nil {
		t.Fatal(err)
	}
	if m.main.Codec().MimeType != webrtc.MimeTypeVP8 || m.low.Codec().MimeType != webrtc.MimeTypeVP8 {
		t.Fatal("ana ve düşük iz aynı codec (VP8) olmalı")
	}
}

// Windows/macOS davranışı değişmez: H264 iz çifti H.264 izi açar, fmtp aynen; rtc.New(…, nil) varsayılanı H.264.
func TestAC398P28gNewMediaH264Unchanged(t *testing.T) {
	_, mime := codecPeers(t, H264, &fakeSource{})
	if got := wait(t, mime, "teknisyende H.264 izi"); got != webrtc.MimeTypeH264 {
		t.Fatalf("iz codec'i %q", got)
	}
	if h264.SDPFmtpLine != "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f" {
		t.Fatal("H.264 fmtp değişmemeli")
	}
	p, err := New(nil, nil, Handlers{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if p.media.main.Codec().MimeType != webrtc.MimeTypeH264 {
		t.Fatal("nil iz çifti H.264 olmalı")
	}
}
