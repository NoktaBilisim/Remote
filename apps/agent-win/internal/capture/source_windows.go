//go:build windows

package capture

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/win"
)

const (
	acquireTimeoutMs = 100 // NextFrame içinde ctx iptali en geç bu süre + kodlama kadar gecikir
	openFirstFrame   = 2 * time.Second
	reopenMin        = 250 * time.Millisecond
	reopenMax        = 2 * time.Second
)

const rpcEChangedMode = 0x80010106

var errClosed = errors.New("capture: kaynak kapalı")

// source DXGI Desktop Duplication → BGRA→NV12 (CPU) → Media Foundation H.264 hattı. COM nesneleri iş parçacığına
// bağlı olmasın diye tüm çağrılar kilitli tek bir OS iş parçacığında (worker) yapılır; NextFrame istekleri kanalla
// gelir. Gösterge ve işaretleme pencereleri WDA_EXCLUDEFROMCAPTURE ile yakalamaya girmez (internal/ui).
type source struct {
	reqs   chan frameReq
	done   chan struct{}
	exited chan struct{}
	once   sync.Once
	kc     keyClock
}

type frameReq struct {
	ctx  context.Context
	resp chan frameResp
}

type frameResp struct {
	f   rtc.Frame
	err error
}

// Open seçilen monitör için H.264 kaynağı açar: masaüstü çoğaltması kurulup ilk kare alınabilmeli ve kodlayıcı
// oluşturulabilmelidir; aksi hâlde hata döner (akış "Ekran görüntüsü alınamadı" yolunu izler).
func Open(monitorID int) (rtc.Source, error) {
	ms := win.Monitors()
	if monitorID < 1 || monitorID > len(ms) {
		return nil, errors.New("capture: monitör yok")
	}
	s := &source{reqs: make(chan frameReq), done: make(chan struct{}), exited: make(chan struct{})}
	initErr := make(chan error, 1)
	go s.run(ms[monitorID-1].Device, initErr)
	if err := <-initErr; err != nil {
		return nil, err
	}
	return s, nil
}

// RequestKeyframe rtc.KeyframeRequester: yayın başı ve PLI/FIR.
func (s *source) RequestKeyframe() { s.kc.Request() }

func (s *source) NextFrame(ctx context.Context) (rtc.Frame, error) {
	resp := make(chan frameResp, 1)
	select {
	case s.reqs <- frameReq{ctx: ctx, resp: resp}:
	case <-ctx.Done():
		return rtc.Frame{}, ctx.Err()
	case <-s.exited:
		return rtc.Frame{}, errClosed
	}
	r := <-resp
	return r.f, r.err
}

func (s *source) Close() error {
	s.once.Do(func() { close(s.done) })
	<-s.exited
	return nil
}

func (s *source) run(device string, initErr chan<- error) {
	defer close(s.exited)
	runtime.LockOSThread() // bilerek açılmaz: goroutine bitince iş parçacığı COM durumuyla birlikte sonlanır
	// S_FALSE: iş parçacığında COM zaten MTA (yine dengelenir); RPC_E_CHANGED_MODE: başka kod STA açmış — tek iş
	// parçacığından kullanım STA'da da geçerli, ama Uninitialize bizim değil.
	switch err := windows.CoInitializeEx(0, windows.COINIT_MULTITHREADED); {
	case err == nil || errors.Is(err, syscall.Errno(1)):
		defer windows.CoUninitialize()
	case errors.Is(err, syscall.Errno(rpcEChangedMode)):
	default:
		initErr <- err
		return
	}
	if err := procHR(pMFStartup, "MFStartup", mfVersion, mfStartupLite); err != nil {
		initErr <- err // ör. Media Feature Pack'siz Windows N
		return
	}
	defer func() { _, _, _ = pMFShutdown.Call() }()
	p := &pipeline{device: device, kc: &s.kc, rc: newRateCtl()}
	defer p.close()
	if err := p.start(); err != nil {
		initErr <- err
		return
	}
	initErr <- nil
	for {
		select {
		case r := <-s.reqs:
			f, err := p.next(r.ctx)
			r.resp <- frameResp{f: f, err: err}
		case <-s.done:
			return
		}
	}
}

// pipeline worker iş parçacığının durumu.
type pipeline struct {
	device   string
	kc       *keyClock
	rc       *rateCtl
	dup      *duplicator
	enc      *encoder
	frame    *NV12
	retryAt  time.Time
	backoff  time.Duration
	lastEmit time.Time
	nextAt   time.Time
	convCost time.Duration // son BGRA→NV12 dönüşüm süresi
}

func (p *pipeline) start() error {
	d, err := openDuplicator(p.device)
	if err != nil {
		return err
	}
	p.dup = d
	deadline := time.Now().Add(openFirstFrame)
	for p.frame == nil {
		if _, err := p.grab(); err != nil {
			return err
		}
		if p.frame == nil && time.Now().After(deadline) {
			return errors.New("capture: ilk kare alınamadı")
		}
	}
	return nil
}

// grab yeni masaüstü karesini (varsa) NV12'ye çevirir; çözünürlük değişirse kodlayıcıyı yeniden kurar.
// Çoğaltma kaybında (ACCESS_LOST, Güvenli Masaüstü/UAC, kilit ekranı, mod değişimi) oturumu kapatır ve geri çekilmeli
// yeniden açar; bu sürede son kare kullanılmaya devam eder. Yalnız kodlayıcı kurulamazsa hata döner.
func (p *pipeline) grab() (bool, error) {
	if p.dup == nil {
		wait := time.Until(p.retryAt)
		if wait > 0 {
			time.Sleep(min(wait, acquireTimeoutMs*time.Millisecond))
			return false, nil
		}
		d, err := openDuplicator(p.device)
		if err != nil {
			p.backoff = min(reopenMax, max(reopenMin, p.backoff*2))
			p.retryAt = time.Now().Add(p.backoff)
			return false, nil
		}
		p.dup, p.backoff = d, 0
		p.kc.Request()
	}
	var resized bool
	changed, err := p.dup.acquire(acquireTimeoutMs, func(px []byte, w, h, pitch int) error {
		ow, oh := OutputSize(DesktopSize(w, h, p.dup.rot))
		if p.frame == nil || p.frame.W != ow || p.frame.H != oh {
			p.frame, resized = NewNV12(ow, oh), true
		}
		t0 := time.Now()
		err := ConvertBGRA(p.frame, px, w, h, pitch, p.dup.rot)
		p.convCost = time.Since(t0)
		return err
	})
	if err != nil {
		p.dup.close()
		p.dup = nil
		p.retryAt = time.Now().Add(reopenMin)
		return false, nil
	}
	if p.frame != nil && (resized || p.enc == nil) {
		if p.enc != nil {
			p.enc.close()
			p.enc = nil
		}
		enc, err := newEncoder(p.frame.W, p.frame.H, targetFPS)
		if err != nil {
			return false, err
		}
		p.enc = enc
		p.kc.Request()
	}
	return changed, nil
}

// next kare hızı bütçesine göre bekler, yeni kare yoksa (ve anahtar kare istenmemişse) 1 sn'ye kadar kodlamaz,
// sonra NV12 kareyi kodlayıp Annex-B erişim birimini döner.
func (p *pipeline) next(ctx context.Context) (rtc.Frame, error) {
	for {
		if wait := time.Until(p.nextAt); wait > 0 {
			t := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				t.Stop()
				return rtc.Frame{}, ctx.Err()
			case <-t.C:
			}
		}
		if err := ctx.Err(); err != nil {
			return rtc.Frame{}, err
		}
		changed, err := p.grab()
		if err != nil {
			return rtc.Frame{}, err
		}
		now := time.Now()
		if !changed && !p.kc.Pending() && !p.lastEmit.IsZero() && now.Sub(p.lastEmit) < idleKeepAlive {
			continue
		}
		dur := p.rc.Interval()
		if !p.lastEmit.IsZero() {
			dur = now.Sub(p.lastEmit)
		}
		data, key, err := p.enc.Encode(p.frame, dur, p.kc.Due(now))
		if err != nil {
			return rtc.Frame{}, err
		}
		cost := time.Since(now) // kodlama (+ yeni karede dönüşüm): AC-41 kare hızı denetimi
		if changed {
			cost += p.convCost
		}
		if p.rc.Observe(cost) {
			p.enc.SetBitrate(bitrateFor(p.frame.W, p.frame.H, p.rc.FPS()))
		}
		if len(data) == 0 { // kodlayıcı gecikmesi: karenin çıktısı sonraki turda gelir
			continue
		}
		if key {
			p.kc.Mark(now)
		}
		p.lastEmit = now
		p.nextAt = now.Add(p.rc.Interval())
		return rtc.Frame{Data: data, Duration: dur}, nil
	}
}

func (p *pipeline) close() {
	if p.enc != nil {
		p.enc.close()
	}
	if p.dup != nil {
		p.dup.close()
	}
}
