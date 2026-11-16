package rtc

import (
	"context"
	"sync"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// P28c (mimari-p28c §6.1, ADR-0035): tek yakalama, iki kodlayıcı. Media iki paylaşılan izi (ana: kontrol sahibi,
// düşük: diğer teknisyenler) taşır; her PeerConnection bunlardan birine bağlıdır (Peer.SetMain → ReplaceTrack).
// Yayın pompası eşten bağımsızdır: bir eşin kapanması yayını durdurmaz.

// LowSource kaynağın isteğe bağlı düşük akış yeteneği (capture: aynı NV12 kareden ≤ signal.LowFPS / signal.LowBPS
// ikinci kodlayıcı). Sink kaynağın iş parçacığından çağrılır; bloklamamalıdır.
type LowSource interface {
	SetLowSink(sink func(Frame))
	EnableLow(on bool)
	RequestLowKeyframe()
}

// Media ana/düşük iz çifti ve yayın pompası.
type Media struct {
	main, low *webrtc.TrackLocalStaticSample

	mu    sync.Mutex
	src   Source // Stream süresince
	lowOn bool
}

// NewMedia iz çiftini kurar (H.264; aynı codec → ReplaceTrack yeniden müzakere istemez).
func NewMedia() (*Media, error) {
	mainT, err := webrtc.NewTrackLocalStaticSample(h264, "video", "noktadestek")
	if err != nil {
		return nil, err
	}
	lowT, err := webrtc.NewTrackLocalStaticSample(h264, "video-low", "noktadestek")
	if err != nil {
		return nil, err
	}
	return &Media{main: mainT, low: lowT}, nil
}

func (m *Media) track(main bool) *webrtc.TrackLocalStaticSample {
	if main {
		return m.main
	}
	return m.low
}

// SetLow düşük kodlayıcıyı açar/kapatır (≥ 1 ikincil eş varken açık). Yayın yokken de saklanır; Stream başlarken ve
// kaynak değişince yeniden uygulanır.
func (m *Media) SetLow(on bool) {
	m.mu.Lock()
	m.lowOn = on
	src := m.src
	m.mu.Unlock()
	if ls, ok := src.(LowSource); ok {
		ls.EnableLow(on)
		if on {
			ls.RequestLowKeyframe()
		}
	}
}

// requestKeyframe ana ya da düşük izin kodlayıcısından anahtar kare ister (PLI/FIR, yeni eş, iz takası).
func (m *Media) requestKeyframe(main bool) {
	m.mu.Lock()
	src := m.src
	m.mu.Unlock()
	if main {
		if kf, ok := src.(KeyframeRequester); ok {
			kf.RequestKeyframe()
		}
		return
	}
	if ls, ok := src.(LowSource); ok {
		ls.RequestLowKeyframe()
	}
}

// Stream kaynaktan kareleri ctx bitene veya kaynak hata verene kadar ana ize yazar; kaynak LowSource ise düşük
// kareler düşük ize gider. Kaynağı kapatmaz. Yayın başında anahtar kare istenir (yeni eş IDR'siz başlamasın).
func (m *Media) Stream(ctx context.Context, src Source) error {
	m.mu.Lock()
	m.src = src
	lowOn := m.lowOn
	m.mu.Unlock()
	ls, hasLow := src.(LowSource)
	if hasLow {
		ls.SetLowSink(func(f Frame) { _ = m.low.WriteSample(media.Sample{Data: f.Data, Duration: f.Duration}) })
		ls.EnableLow(lowOn)
	}
	defer func() {
		if hasLow {
			ls.EnableLow(false)
			ls.SetLowSink(nil)
		}
		m.mu.Lock()
		if m.src == src {
			m.src = nil
		}
		m.mu.Unlock()
	}()
	if kf, ok := src.(KeyframeRequester); ok {
		kf.RequestKeyframe()
	}
	for {
		f, err := src.NextFrame(ctx)
		if err != nil {
			return err
		}
		if err := m.main.WriteSample(media.Sample{Data: f.Data, Duration: f.Duration}); err != nil {
			return err
		}
	}
}
