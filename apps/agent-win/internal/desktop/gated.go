package desktop

import (
	"context"
	"errors"
	"sync"

	"remote-support/agent-win/internal/rtc"
)

var errSourceClosed = errors.New("desktop: kaynak kapalı")

// Source kapıya bağlı yakalama kaynağı açar. Kapı kapalıyken NextFrame kare vermez (bekler); geçiş sırasında yakalanan
// kare düşürülür; kapı yeni dönemle açılınca alttaki kaynak kapatılıp yeniden açılır (yeni yakalama iş parçacığı yeni
// giriş masaüstüne bağlanır — capture.Opener.Attach). Açılış hatası aynen döner (akışın mevcut hata yolu).
func Source(g *Gate, open func() (rtc.Source, error)) (rtc.Source, error) {
	ep, _ := g.State()
	src, err := open()
	if err != nil {
		return nil, err
	}
	return &gatedSource{gate: g, open: open, src: src, epoch: ep}, nil
}

type gatedSource struct {
	gate   *Gate
	open   func() (rtc.Source, error)
	mu     sync.Mutex
	src    rtc.Source
	epoch  uint64 // kaynağın açıldığı dönem (kapalıyken açıldıysa açılınca dönem ilerler → yeniden açılır)
	closed bool
	// P28c düşük akış ayarı: yeniden açılan kaynağa da uygulanır (rtc.LowSource).
	lowSink func(rtc.Frame)
	lowOn   bool
}

func (s *gatedSource) NextFrame(ctx context.Context) (rtc.Frame, error) {
	for {
		ep, err := s.gate.Wait(ctx)
		if err != nil {
			return rtc.Frame{}, err
		}
		src, err := s.current(ep)
		if err != nil {
			return rtc.Frame{}, err
		}
		f, err := src.NextFrame(ctx)
		cur, open := s.gate.State()
		if open && cur == ep {
			return f, err // dönem boyunca alınan kare (ya da o dönemin hatası)
		}
		if ctx.Err() != nil {
			return rtc.Frame{}, ctx.Err()
		}
		// O-P27-4: masaüstü değişimi sırasında alınan kare/hata düşürülür; açılınca kaynak yeniden kurulur.
	}
}

// current ep dönemine ait kaynak; dönem değiştiyse eskisini kapatıp yeniden açar.
func (s *gatedSource) current(ep uint64) (rtc.Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errSourceClosed
	}
	if s.epoch == ep {
		return s.src, nil
	}
	_ = s.src.Close()
	src, err := s.open()
	if err != nil {
		s.closed = true
		return nil, err
	}
	s.src, s.epoch = src, ep
	if ls, ok := src.(rtc.LowSource); ok {
		ls.SetLowSink(s.lowSink)
		ls.EnableLow(s.lowOn)
	}
	return src, nil
}

// SetLowSink rtc.LowSource: alttaki (ve yeniden açılacak) kaynağa iletilir.
func (s *gatedSource) SetLowSink(sink func(rtc.Frame)) {
	s.mu.Lock()
	s.lowSink = sink
	src := s.src
	s.mu.Unlock()
	if ls, ok := src.(rtc.LowSource); ok {
		ls.SetLowSink(sink)
	}
}

// EnableLow rtc.LowSource.
func (s *gatedSource) EnableLow(on bool) {
	s.mu.Lock()
	s.lowOn = on
	src := s.src
	s.mu.Unlock()
	if ls, ok := src.(rtc.LowSource); ok {
		ls.EnableLow(on)
	}
}

// RequestLowKeyframe rtc.LowSource.
func (s *gatedSource) RequestLowKeyframe() {
	s.mu.Lock()
	src := s.src
	s.mu.Unlock()
	if ls, ok := src.(rtc.LowSource); ok {
		ls.RequestLowKeyframe()
	}
}

// RequestKeyframe rtc.KeyframeRequester (alttaki kaynak destekliyorsa iletilir; yeniden açılan kaynak zaten IDR ile
// başlar).
func (s *gatedSource) RequestKeyframe() {
	s.mu.Lock()
	src := s.src
	s.mu.Unlock()
	if kf, ok := src.(rtc.KeyframeRequester); ok {
		kf.RequestKeyframe()
	}
}

func (s *gatedSource) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	return s.src.Close()
}

// Input kapı kapalıyken girdi olaylarını düşürür (kuyruğa almaz; O-P27-4).
func Input(g *Gate, handle func(raw []byte)) func(raw []byte) {
	if handle == nil {
		return nil
	}
	return func(raw []byte) {
		if _, open := g.State(); open {
			handle(raw)
		}
	}
}
