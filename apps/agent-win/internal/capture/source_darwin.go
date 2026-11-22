//go:build darwin

package capture

import (
	"context"
	"errors"
	"sync"
	"time"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// P28f K2 (mimari-p28f §2, ADR-0037 m.2 r3): ScreenCaptureKit → Go NV12 → VideoToolbox H.264. Hat Windows'takiyle
// aynı platform bağımsız parçaları kullanır: selectEncoder/fallbackEncoder (donanım → yazılım, AC-245), rateCtl
// (AC-41), keyClock (GOP + PLI), lowStage (P28c düşük iz = ikinci VT oturumu, ADR-0035). Yakalama yolu (Method)
// ekran modunda boştur; P33 pencere modunda MethodWGC (= pencere modu belirteci, K-P33-6).

const (
	openFirstFrame = 2 * time.Second
	reopenMin      = 250 * time.Millisecond
	reopenMax      = 2 * time.Second
	frameWait      = 100 * time.Millisecond // NextFrame içinde ctx iptali en geç bu süre + kodlama kadar gecikir
)

var errClosed = errors.New("capture: kaynak kapalı")

// source rtc.Source + KeyframeRequester + LowSource.
type source struct {
	mu   sync.Mutex // NextFrame ve Close'un kaynak temizliği sıralı
	p    *pipeline
	kc   keyClock
	low  lowStage
	done chan struct{}
	once sync.Once
	nap  objc.ID // App Nap kapalı etkinliği (oturum = kaynak ömrü)
}

// pipeline kodlama goroutine'inin durumu.
type pipeline struct {
	display  uint32
	window   uint32 // P33 pencere modu (CGWindowID; 0 = ekran); window_darwin.go
	opt      streamOpts
	st       *sckStream
	cur      *NV12 // son kare (ekran değişmezken yeniden kodlanır, PLI'de IDR)
	kc       *keyClock
	low      *lowStage
	rc       *rateCtl
	enc      Encoder
	encW     int
	encH     int
	hwOff    bool
	retryAt  time.Time
	backoff  time.Duration
	lastEmit time.Time
	nextAt   time.Time
	stats    pipeStats
	// P33 pencere modu durumu (window_darwin.go).
	track     winTrack
	pollAt    time.Time
	closedErr error // kalıcı WINDOW_CLOSED / WINDOW_UNAVAILABLE
	winFails  int   // art arda açılamayan pencere akışı
}

// pipeStats ölçüm sayaçları (K2 ölçüm testi; kişisel veri yok).
type pipeStats struct {
	on       bool // yalnız testte açılır (süre dilimleri büyümesin)
	encoded  int
	emitted  int
	empty    int             // Encode çıktısız döndü (kare kaybı)
	encodeNs []time.Duration // ana Encode duvar süresi (ölçüt p95 ≤ 33 ms)
	stepNs   []time.Duration // ana + düşük kodlama (kare başına toplam iş)
	// reopenedAt son dışlama yeniden açılışı (AC-392 testi: ilk taze kareye kadar geçen süre).
	reopenedAt time.Time
}

// Open seçilen monitör için H.264 kaynağı: ilk kare openFirstFrame içinde alınmalı ve kodlayıcı kurulmalı; aksi
// hâlde tipli hata (*Error). Ekran Kaydı izni yoksa SCK'ya dokunulmaz (ScreenCaptureAccess).
func Open(monitorID int) (rtc.Source, error) { return open(monitorID, streamOpts{}) }

func open(monitorID int, opt streamOpts) (*source, error) {
	if fwErr != nil {
		return nil, &Error{Reason: ReasonOther, Op: "LoadFrameworks"}
	}
	id, ok := displayOf(monitorID)
	if !ok {
		return nil, &Error{Reason: ReasonNoOutput, Op: "MonitorID"}
	}
	return openPipeline(&pipeline{display: id, opt: opt})
}

// openStream hedefin (ekran ya da P33 pencere) akışını açar.
func (p *pipeline) openStream() (*sckStream, error) {
	if p.window != 0 {
		return openWindowStream(p.window, p.track.w, p.track.h)
	}
	return openStream(p.display, p.opt)
}

// openPipeline ilk kare + kodlayıcı (ekran ve pencere kaynağı ortak).
func openPipeline(p *pipeline) (*source, error) {
	s := &source{done: make(chan struct{})}
	p.kc, p.low, p.rc = &s.kc, &s.low, newRateCtl()
	s.p = p
	s.low.open = func(w, h int) (Encoder, error) { // P28c ikinci oturum (sabit 8 FPS)
		ch, err := selectEncoder(func(hw bool) (Encoder, error) { return openEncoder(w, h, signal.LowFPS, hw) },
			!p.hwOff, time.Now, nil)
		return ch.enc, err
	}
	var f *NV12
	for try := 0; ; try++ {
		st, err := p.openStream()
		if err != nil {
			return nil, err
		}
		p.st = st
		f, err = st.slot.wait(context.Background(), s.done, openFirstFrame)
		// İlk kareden önce uygulamamız listede bulunduysa (excludeLater) akış dışlamalı açılır; ilk kare atılır.
		if errors.Is(err, errStreamReopen) && try == 0 {
			st.close()
			p.st = nil
			p.opt.lateExclude, p.opt.haltFirst = false, false
			continue
		}
		break
	}
	if f == nil {
		p.close()
		return nil, &Error{Reason: ReasonOther, Op: "FirstFrame"}
	}
	p.cur = f
	if err := p.ensureEncoder(); err != nil {
		p.close()
		return nil, err
	}
	s.nap = beginNoAppNap()
	return s, nil
}

// RequestKeyframe rtc.KeyframeRequester: yayın başı ve PLI/FIR.
func (s *source) RequestKeyframe() { s.kc.Request() }

// SetLowSink / EnableLow / RequestLowKeyframe rtc.LowSource (P28c düşük akış; low.go).
func (s *source) SetLowSink(sink func(rtc.Frame)) { s.low.SetLowSink(sink) }
func (s *source) EnableLow(on bool)               { s.low.EnableLow(on) }
func (s *source) RequestLowKeyframe()             { s.low.RequestLowKeyframe() }

// NextFrame bir sonraki H.264 erişim birimi (rtc.Source).
func (s *source) NextFrame(ctx context.Context) (rtc.Frame, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.done:
		return rtc.Frame{}, errClosed
	default:
	}
	return s.p.next(ctx, s.done)
}

// Close akışı ve kodlayıcıları kapatır, App Nap etkinliğini bitirir.
func (s *source) Close() error {
	s.once.Do(func() {
		close(s.done)
		s.mu.Lock()
		defer s.mu.Unlock()
		s.p.close()
		endNoAppNap(s.nap)
	})
	return nil
}

// ensureEncoder kare boyutu değiştiyse veya kodlayıcı yoksa kurar (donanım → yazılım; oturumda yazılıma düşüldüyse
// donanım yeniden denenmez, AC-245).
func (p *pipeline) ensureEncoder() error {
	f := p.cur
	if f == nil || (p.enc != nil && f.W == p.encW && f.H == p.encH) {
		return nil
	}
	if p.enc != nil {
		p.enc.Close()
		p.enc = nil
	}
	open := func(hw bool) (Encoder, error) { return openEncoder(f.W, f.H, targetFPS, hw) }
	ch, err := selectEncoder(open, !p.hwOff, time.Now, func(Fallback) { p.hwOff = true })
	if err != nil {
		return err
	}
	p.enc, p.encW, p.encH = ch.enc, f.W, f.H
	p.kc.Request()
	return nil
}

// grab yeni kareyi alır. Akış durursa (ekran çıkarıldı, kip değişti, izin geri alındı) geri çekilmeli yeniden açılır;
// bu sürede son kare kullanılmaya devam eder (Windows grab ile aynı).
func (p *pipeline) grab(ctx context.Context, done <-chan struct{}) (bool, error) {
	if p.window != 0 { // P33: CG pencere durumu (kapanış, görünmezlik, boyut) kare almadan önce
		if changed, err, handled := p.windowPoll(ctx, done); handled {
			return changed, err
		}
	}
	if p.st == nil {
		if wait := time.Until(p.retryAt); wait > 0 {
			return false, sleepCtx(ctx, done, min(wait, frameWait))
		}
		st, err := p.openStream()
		if err != nil {
			if p.window != 0 {
				if ferr := p.windowOpenFailed(); ferr != nil {
					return false, ferr
				}
			}
			p.backoff = min(reopenMax, max(reopenMin, p.backoff*2))
			p.retryAt = time.Now().Add(p.backoff)
			return false, nil
		}
		p.st, p.backoff = st, 0
		p.kc.Request()
	}
	f, err := p.st.slot.wait(ctx, done, frameWait)
	if errors.Is(err, errStreamReopen) {
		// Dışlama öncesi kare penceremizi içerebilir: yeniden kodlanmaz; yeni akışın ilk taze karesi beklenir.
		p.st.close()
		p.st = nil
		p.cur = nil
		p.retryAt = time.Time{}
		p.stats.reopenedAt = time.Now()
		return false, nil
	}
	if errors.Is(err, errStreamStopped) {
		// Dışlamasız akışın son karesi penceremizi içerebilir: keep-alive/PLI ile yeniden gitmesin (D-392-2).
		if !p.st.excluded.Load() {
			p.cur = nil
		}
		p.st.close()
		p.st = nil
		p.retryAt = time.Now().Add(reopenMin)
		return false, nil
	}
	if err != nil || f == nil {
		return false, err
	}
	p.winFails = 0
	p.st.slot.recycle(p.cur)
	p.cur = f
	return true, p.ensureEncoder()
}

func sleepCtx(ctx context.Context, done <-chan struct{}, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
		return errClosed
	case <-t.C:
		return nil
	}
}

// next kare hızı bütçesine göre bekler; yeni kare yoksa (ve anahtar kare istenmemişse) idleKeepAlive'a kadar
// kodlamaz, sonra son kareyi kodlayıp Annex-B erişim birimini döner.
func (p *pipeline) next(ctx context.Context, done <-chan struct{}) (rtc.Frame, error) {
	for {
		if wait := time.Until(p.nextAt); wait > 0 {
			if err := sleepCtx(ctx, done, wait); err != nil {
				return rtc.Frame{}, err
			}
		}
		changed, err := p.grab(ctx, done)
		if err != nil {
			return rtc.Frame{}, err
		}
		now := time.Now()
		if p.cur == nil || p.enc == nil ||
			(!changed && !p.kc.Pending() && !p.low.pending() && !p.lastEmit.IsZero() && now.Sub(p.lastEmit) < idleKeepAlive) {
			continue
		}
		f, ok, err := p.encode(now)
		if err != nil || ok {
			return f, err
		}
	}
}

// encode ana kareyi ve (zamanı geldiyse) düşük kareyi kodlar; ok=false kodlayıcı çıktı vermedi.
func (p *pipeline) encode(now time.Time) (rtc.Frame, bool, error) {
	dur := p.rc.Interval()
	if !p.lastEmit.IsZero() {
		dur = now.Sub(p.lastEmit)
	}
	data, key, err := p.enc.Encode(p.cur, dur, p.kc.Due(now))
	if err != nil {
		return rtc.Frame{}, false, tag(err, stageEncode, "Encode")
	}
	cost := time.Since(now)
	p.stats.encoded++
	if p.stats.on {
		p.stats.encodeNs = append(p.stats.encodeNs, cost)
	}
	p.low.step(p.cur, now) // aynı NV12 kare, ≤ 8 FPS (maliyet ana kare hızı denetimine girmez)
	if p.stats.on {
		p.stats.stepNs = append(p.stats.stepNs, time.Since(now))
	}
	if p.rc.Observe(cost) {
		p.enc.SetBitrate(bitrateFor(p.cur.W, p.cur.H, p.rc.FPS()))
	}
	if len(data) == 0 {
		p.stats.empty++
		return rtc.Frame{}, false, nil
	}
	if key {
		p.kc.Mark(now)
	}
	p.stats.emitted++
	p.lastEmit = now
	p.nextAt = now.Add(p.rc.Interval())
	return rtc.Frame{Data: data, Duration: dur}, true, nil
}

func (p *pipeline) close() {
	p.low.close()
	if p.enc != nil {
		p.enc.Close()
		p.enc = nil
	}
	if p.st != nil {
		p.st.close()
		p.st = nil
	}
}

// App Nap (ADR-0037 m.2 r3, K0s-1): arka plandaki süreç uyutulunca yakalama 7,6 fps'e düşüyordu. Kaynak açık olduğu
// sürece NSActivityUserInitiated | NSActivityLatencyCritical etkinliği tutulur.
const napOptions = uint64(0x00FFFFFF) | uint64(0xFF00000000)

func beginNoAppNap() objc.ID {
	var a objc.ID
	objc.Pool(func() {
		c, err := objc.GetClass("NSProcessInfo")
		if err != nil {
			return
		}
		reason, err := objc.NSString("Nokta Destek ekran paylaşımı")
		if err != nil {
			return
		}
		a = objc.ID(c).Send(objc.Sel("processInfo")).Send(objc.Sel("beginActivityWithOptions:reason:"), napOptions, reason)
		if a != 0 {
			a.Send(objc.Sel("retain"))
		}
	})
	return a
}

func endNoAppNap(a objc.ID) {
	if a == 0 {
		return
	}
	objc.Pool(func() {
		c, err := objc.GetClass("NSProcessInfo")
		if err == nil {
			objc.ID(c).Send(objc.Sel("processInfo")).Send(objc.Sel("endActivity:"), a)
		}
		objc.Release(a)
	})
}
