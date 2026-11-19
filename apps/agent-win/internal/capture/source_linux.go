//go:build linux

package capture

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/rtc"
)

// P28g K2 (mimari-p28g §4.4, §7, §14 m.3/m.5/m.9): GStreamer VP8 kaynağı. rtc.Source + KeyframeRequester + LowSource'u
// doğrudan uygular (NV12 Encoder arayüzü kullanılmaz). Ana kareler NextFrame goroutine'inde, düşük kareler hat başına
// ayrı goroutine'de çekilir. Basamak değişiminde yeni hat kurulur, eskisi kapatılır, anahtar kare istenir.

const (
	pullWait       = 100 * time.Millisecond // ns cinsinden çekme beklemesi (ctx iptali en geç bu kadar gecikir)
	gstFirstFrame  = 5 * time.Second
	clockTicks     = 100 // Linux x86_64 USER_HZ
	maxFrameGap    = time.Second
	frameInterval  = time.Second / gstFPS
	lowPullTimeout = 200 * time.Millisecond
)

var errSourceClosed = errors.New("capture: kaynak kapalı")

// gstSource tek monitörün (X11) ya da portal akışının (Wayland) kaynağı.
type gstSource struct {
	mu   sync.Mutex // NextFrame ve Close sıralı
	pmu  sync.Mutex // p değişimi ve özellik yazımı (EnableLow, bit hızı)
	p    *gstPipe
	base pipeSpec // kaynak alanları (X/Y/W/H ya da FD/Node)
	srcW int
	srcH int

	lad      *ladder
	gaps     gapStats
	cpuAt    time.Time
	cpu0     int64
	br       *brCtl
	lastEmit time.Time
	first    []byte

	keyReq  atomic.Bool
	lastKey time.Time
	lowKey  atomic.Bool
	lowOn   atomic.Bool
	lowSink atomic.Pointer[func(rtc.Frame)]
	lowStop chan struct{}
	lowWG   sync.WaitGroup

	closed <-chan struct{} // Wayland: portal oturumu kapandı (nil → yok)
	done   chan struct{}
	once   sync.Once
}

// openGst kaynak dikdörtgeni / portal akışı için hattı kurar ve ilk kareyi bekler.
func openGst(base pipeSpec, srcW, srcH int, closed <-chan struct{}) (*gstSource, error) {
	now := time.Now()
	s := &gstSource{base: base, srcW: srcW, srcH: srcH, lad: newLadder(srcW, srcH, now), closed: closed,
		done: make(chan struct{})}
	p, err := s.build()
	if err != nil {
		return nil, err
	}
	s.p = p
	s.startLow(p)
	s.cpuAt, s.cpu0 = now, cpuTicks()
	// §14 m.5: PLAYING'den sonra açık anahtar kare (drop=true ilk anahtar kareyi düşürebiliyordu).
	forceKey(p.mainSink)
	deadline := time.Now().Add(gstFirstFrame)
	for time.Now().Before(deadline) {
		if f := pull(p.mainSink, uint64(pullWait)); f != nil {
			s.first = f
			return s, nil
		}
		if p.failed() || s.isClosed() {
			break
		}
	}
	s.Close()
	return nil, &Error{Reason: ReasonFirstFrameTimeout, Op: "FirstFrame"}
}

// build geçerli basamak için dizgiyi üretir ve hattı başlatır; bit hızı denetleyicisi yenilenir.
func (s *gstSource) build() (*gstPipe, error) {
	spec := s.base
	spec.OutW, spec.OutH = fitEdge(s.srcW, s.srcH, s.lad.Edge())
	spec.LowW, spec.LowH = lowSize(spec.OutW, spec.OutH)
	spec.BPS = bitrateFor(spec.OutW, spec.OutH, gstFPS)
	desc, err := buildPipeline(spec)
	if err != nil {
		return nil, &Error{Reason: ReasonOther, Op: "GstSpec"}
	}
	p, err := startPipe(desc)
	if err != nil {
		return nil, err
	}
	s.br = newBrCtl(spec.BPS, time.Now())
	if s.lowOn.Load() {
		setProp(p.valve, "drop", "false")
	}
	return p, nil
}

func (s *gstSource) isClosed() bool {
	if s.closed == nil {
		return false
	}
	select {
	case <-s.closed:
		return true
	default:
		return false
	}
}

// RequestKeyframe rtc.KeyframeRequester (bloklamaz; NextFrame döngüsü gönderir, keyMinGap ile sınırlı).
func (s *gstSource) RequestKeyframe() { s.keyReq.Store(true) }

// SetLowSink rtc.LowSource.
func (s *gstSource) SetLowSink(sink func(rtc.Frame)) {
	if sink == nil {
		s.lowSink.Store(nil)
		return
	}
	s.lowSink.Store(&sink)
}

// EnableLow rtc.LowSource: düşük daldaki valve açılır/kapanır.
func (s *gstSource) EnableLow(on bool) {
	if s.lowOn.Swap(on) == on {
		return
	}
	s.pmu.Lock()
	if s.p != nil {
		setProp(s.p.valve, "drop", strconv.FormatBool(!on))
	}
	s.pmu.Unlock()
	if on {
		s.lowKey.Store(true)
	}
}

// RequestLowKeyframe rtc.LowSource.
func (s *gstSource) RequestLowKeyframe() { s.lowKey.Store(true) }

// startLow hattın düşük appsink'ini çeken goroutine.
func (s *gstSource) startLow(p *gstPipe) {
	stop := make(chan struct{})
	s.lowStop = stop
	s.lowWG.Add(1)
	go func() {
		defer s.lowWG.Done()
		last := time.Time{}
		for {
			select {
			case <-stop:
				return
			default:
			}
			if s.lowKey.Swap(false) {
				forceKey(p.lowSink)
			}
			f := pull(p.lowSink, uint64(lowPullTimeout))
			if f == nil {
				continue
			}
			now := time.Now()
			dur := lowInterval
			if !last.IsZero() {
				dur = min(maxFrameGap, max(lowInterval, now.Sub(last)))
			}
			last = now
			if sink := s.lowSink.Load(); sink != nil && s.lowOn.Load() {
				(*sink)(rtc.Frame{Data: f, Duration: dur})
			}
		}
	}()
}

func (s *gstSource) stopLow() {
	if s.lowStop != nil {
		close(s.lowStop)
		s.lowWG.Wait()
		s.lowStop = nil
	}
}

// NextFrame bir sonraki VP8 karesi (rtc.Source).
func (s *gstSource) NextFrame(ctx context.Context) (rtc.Frame, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for {
		select {
		case <-s.done:
			return rtc.Frame{}, errSourceClosed
		case <-ctx.Done():
			return rtc.Frame{}, ctx.Err()
		default:
		}
		if s.isClosed() {
			return rtc.Frame{}, &Error{Reason: ReasonOther, Op: "PortalClosed"}
		}
		p := s.p
		now := time.Now()
		if s.keyReq.Load() && now.Sub(s.lastKey) >= keyMinGap {
			s.keyReq.Store(false)
			s.lastKey = now
			forceKey(p.mainSink)
		}
		data := s.first
		s.first = nil
		if data == nil {
			data = pull(p.mainSink, uint64(pullWait))
		}
		if data == nil {
			if p.failed() {
				return rtc.Frame{}, &Error{Reason: ReasonEncodeFailed, Op: "GstBus"}
			}
			continue
		}
		return s.emit(data, time.Now()), nil
	}
}

// emit kare süresi, bit hızı geri beslemesi ve basamak değerlendirmesi.
func (s *gstSource) emit(data []byte, now time.Time) rtc.Frame {
	dur := frameInterval
	if !s.lastEmit.IsZero() {
		dur = min(maxFrameGap, max(time.Millisecond, now.Sub(s.lastEmit)))
	}
	s.lastEmit = now
	if vp8Key(data) {
		s.lastKey = now
	}
	s.gaps.add(now)
	if tgt, ch := s.br.Add(len(data), now); ch {
		s.pmu.Lock()
		setProp(s.p.enc, "target-bitrate", strconv.Itoa(tgt))
		s.pmu.Unlock()
	}
	if el := now.Sub(s.cpuAt); el >= ladderWindow {
		t := cpuTicks()
		cpu := float64(t-s.cpu0) / clockTicks / el.Seconds()
		frames, p95 := len(s.gaps.gaps)+1, s.gaps.p95()
		s.cpuAt, s.cpu0 = now, t
		s.gaps.reset(now)
		if s.lad.Observe(now, cpu, frames, p95) {
			s.rebuild()
		}
	}
	return rtc.Frame{Data: data, Duration: dur}
}

// rebuild yeni basamakta hat kurar; kurulamazsa eskisi sürer. Yeni hatta anahtar kare istenir (ana ve düşük).
func (s *gstSource) rebuild() {
	np, err := s.build()
	if err != nil {
		return
	}
	s.stopLow()
	s.pmu.Lock()
	old := s.p
	s.p = np
	s.pmu.Unlock()
	old.close()
	s.startLow(np)
	forceKey(np.mainSink)
	s.lowKey.Store(true)
}

// Close hattı kapatır (bir kez).
func (s *gstSource) Close() error {
	s.once.Do(func() {
		close(s.done)
		s.mu.Lock()
		defer s.mu.Unlock()
		s.stopLow()
		s.pmu.Lock()
		if s.p != nil {
			s.p.close()
			s.p = nil
		}
		s.pmu.Unlock()
	})
	return nil
}

// cpuTicks süreç kullanıcı + çekirdek CPU tıkları (/proc/self/stat 14. ve 15. alan); okunamazsa 0.
func cpuTicks() int64 {
	b, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0
	}
	str := string(b)
	i := strings.LastIndexByte(str, ')')
	if i < 0 || i+2 > len(str) {
		return 0
	}
	f := strings.Fields(str[i+2:])
	if len(f) < 13 {
		return 0
	}
	u, err1 := strconv.ParseInt(f[11], 10, 64)
	k, err2 := strconv.ParseInt(f[12], 10, 64)
	if err1 != nil || err2 != nil {
		return 0
	}
	return u + k
}
