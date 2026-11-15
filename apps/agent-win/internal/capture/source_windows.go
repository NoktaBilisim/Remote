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

	"remote-support/agent-win/internal/diag"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/win"
)

const (
	openFirstFrame = 2 * time.Second
	reopenMin      = 250 * time.Millisecond
	reopenMax      = 2 * time.Second
)

const rpcEChangedMode = 0x80010106

var errClosed = errors.New("capture: kaynak kapalı")

// source BGRA kaynağı (DXGI Desktop Duplication; açılamazsa DuplicateOutput1, o da olmazsa GDI) → BGRA→NV12 (CPU) +
// fare imleci bindirmesi → Media Foundation H.264 hattı. COM nesneleri iş parçacığına bağlı olmasın diye tüm çağrılar
// kilitli tek bir OS iş parçacığında (worker) yapılır; NextFrame istekleri kanalla gelir. Gösterge ve işaretleme
// pencereleri WDA_EXCLUDEFROMCAPTURE ile yakalamaya girmez (internal/ui).
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

// Opener kaynak açıcı. Log nil değilse yakalama sorunu (açılamama, yedek yönteme geçiş, yayın hatası) yerel tanılama
// loguna yazılır (internal/diag); sorunsuz açılışta dosyaya dokunulmaz.
type Opener struct {
	Version string
	Log     *diag.Log
}

// Open seçilen monitör için H.264 kaynağı açar: bir yakalama yöntemiyle ilk kare alınabilmeli ve kodlayıcı
// oluşturulabilmelidir; aksi hâlde tipli hata (*Error, neden kodu) döner (akış "Ekran görüntüsü alınamadı (KOD)"
// yolunu izler).
func (o Opener) Open(monitorID int) (rtc.Source, error) {
	ms := win.Monitors()
	if monitorID < 1 || monitorID > len(ms) {
		err := &Error{Reason: ReasonNoOutput, Op: "MonitorID"}
		o.write(diag.Report{Event: diag.EventOpenFail, Reason: string(err.Reason), Op: err.Op}, true)
		return nil, err
	}
	return o.start(ms[monitorID-1].Device, 0)
}

// OpenWindow AC-248: yalnız hwnd penceresinin H.264 kaynağı (WGC). Yedek yol yoktur (pencere modunda DXGI/GDI tüm
// ekranı gösterirdi); açılamazsa tipli hata (WGC_UNSUPPORTED / WINDOW_CLOSED / WINDOW_UNAVAILABLE, method WGC).
// Yayında pencere kapanırsa NextFrame WINDOW_CLOSED döner ve akış paylaşımı durdurur.
func (o Opener) OpenWindow(hwnd uintptr) (rtc.Source, error) {
	return o.start(windowTarget, hwnd)
}

// windowTarget pencere modunda tanılama kaydının hedef alanı (pencere başlığı kişisel veri olabilir; yazılmaz).
const windowTarget = "window"

func (o Opener) start(device string, hwnd uintptr) (rtc.Source, error) {
	s := &source{reqs: make(chan frameReq), done: make(chan struct{}), exited: make(chan struct{})}
	initErr := make(chan error, 1)
	go s.run(o, device, hwnd, initErr)
	if err := <-initErr; err != nil {
		return nil, err
	}
	return s, nil
}

// write sistem bilgisini (probe) ekleyip kaydı yazar; yazım hatası akışı etkilemez.
func (o Opener) write(r diag.Report, probe bool) {
	if o.Log == nil {
		return
	}
	r.Time, r.Version = time.Now(), o.Version
	if probe {
		probeSystem(&r)
	}
	_ = o.Log.Write(r)
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

func (s *source) run(o Opener, device string, hwnd uintptr, initErr chan<- error) {
	defer close(s.exited)
	runtime.LockOSThread() // bilerek açılmaz: goroutine bitince iş parçacığı COM durumuyla birlikte sonlanır
	rep := diag.Report{Event: diag.EventOpenFail, Target: device}
	fail := func(err *Error) {
		rep.Reason, rep.Op, rep.HR = string(err.Reason), err.Op, err.HR
		o.write(rep, true)
		initErr <- err
	}
	// S_FALSE: iş parçacığında COM zaten MTA (yine dengelenir); RPC_E_CHANGED_MODE: başka kod STA açmış — tek iş
	// parçacığından kullanım STA'da da geçerli, ama Uninitialize bizim değil.
	switch err := windows.CoInitializeEx(0, windows.COINIT_MULTITHREADED); {
	case err == nil || errors.Is(err, syscall.Errno(1)):
		defer windows.CoUninitialize()
	case errors.Is(err, syscall.Errno(rpcEChangedMode)):
	default:
		var hr uint32
		var en syscall.Errno
		if errors.As(err, &en) {
			hr = uint32(en)
		}
		fail(&Error{Reason: ReasonOther, Op: "CoInitializeEx", HR: hr})
		return
	}
	if err := procHR(pMFStartup, "MFStartup", mfVersion, mfStartupLite); err != nil {
		fail(tag(err, stageMF, "MFStartup")) // ör. Media Feature Pack'siz Windows N
		return
	}
	defer func() { _, _, _ = pMFShutdown.Call() }()
	p := &pipeline{device: device, hwnd: hwnd, kc: &s.kc, rc: newRateCtl(), fps: targetFPS}
	p.onFallback = func(fb Fallback) { // AC-245: yerel diag `encoder_fallback`; oturum sürer
		r := rep
		r.Event, r.Encoder, r.HWReason = eventEncoderFallback, encoderSW, string(fb.Reason)
		r.Reason, r.Op, r.HR = string(fb.Reason), fb.Op, fb.HR
		o.write(r, true)
	}
	defer p.close()
	err := p.start()
	rep.Attempts, rep.Method = p.attemptLog(), string(p.method)
	if p.enc != nil {
		rep.Encoder, rep.HWReason = p.encoderKind(), string(p.hwReason)
	}
	if err != nil {
		e, ok := AsError(err)
		if !ok {
			e = &Error{Reason: ReasonOther, Op: "Start"}
		}
		withMethod(e, lastMethod(p.attempts)) // AC-234: share.state.method = son denenen yol
		fail(e)
		return
	}
	if hwnd == 0 && (p.method != MethodDXGI || len(p.attempts) > 1) { // pencere modunda WGC yedek değil, seçimdir
		rep.Event = diag.EventOpenFallbk
		o.write(rep, true)
	}
	initErr <- nil
	logged := false
	for {
		select {
		case r := <-s.reqs:
			f, err := p.next(r.ctx)
			if e, ok := AsError(err); ok {
				withMethod(e, p.method) // yayın hatası (kodlayıcı geçişi dahil): yayındaki yakalama yolu
			}
			if e, ok := AsError(err); ok && !logged {
				logged = true
				rep.Event, rep.Reason, rep.Op, rep.HR = diag.EventStreamFail, string(e.Reason), e.Op, e.HR
				o.write(rep, true)
			}
			r.resp <- frameResp{f: f, err: err}
		case <-s.done:
			return
		}
	}
}

// Tanılama değerleri (diag.Report.Event / Encoder).
const (
	eventEncoderFallback = "encoder_fallback" // AC-245: yayında donanım → yazılım kodlayıcı
	encoderHW            = "HW"
	encoderSW            = "SW"
)

// encoderKind tanılama için kodlayıcı türü (yayında yazılıma düşüldüyse SW).
func (p *pipeline) encoderKind() string {
	if p.encHW && !p.hwOff {
		return encoderHW
	}
	return encoderSW
}

// pipeline worker iş parçacığının durumu.
type pipeline struct {
	device     string
	hwnd       uintptr // AC-248: 0 değilse pencere modu (yalnız WGC)
	kc         *keyClock
	rc         *rateCtl
	fps        int // kodlayıcının hedef kare hızı (GDI'da gdiFPS)
	g          grabber
	method     Method
	reopen     func() (grabber, error)
	attempts   []attempt
	enc        Encoder
	encHW      bool   // kodlayıcı donanımla başladı
	hwReason   Reason // donanım kodlayıcı kurulamadıysa nedeni
	hwOff      bool   // oturumda yazılıma düşüldü: yeniden kurulumda donanım denenmez (AC-245, tek yönlü)
	onFallback func(Fallback)
	cv         frameConv // sürekli NV12 tamponu, kirli bölge dönüşümü (AC-246)
	resized    bool
	retryAt    time.Time
	backoff    time.Duration
	lastEmit   time.Time
	nextAt     time.Time
	convCost   time.Duration // son BGRA→NV12 dönüşüm süresi
}

// start yöntem zincirini (DXGI → DXGI1 → GDI; pencere modunda yalnız WGC) dener, ilk kareyi alır ve kodlayıcıyı kurar. Kodlayıcı hatası yöntem
// değiştirmeyi gerektirmez (GDI de aynı kodlayıcıyı kullanır); doğrudan döner.
func (p *pipeline) start() error {
	chain := []methodOpener{
		{MethodDXGI, func() (grabber, error) { return wrapDup(openDuplicator(p.device, false)) }},
		{MethodDXGI1, func() (grabber, error) { return wrapDup(openDuplicator(p.device, true)) }},
		{MethodGDI, func() (grabber, error) { return wrapGDI(openGDI(p.device)) }},
	}
	if p.hwnd != 0 {
		chain = []methodOpener{{MethodWGC, func() (grabber, error) { return openWGCGrabber(p.hwnd) }}}
	}
	first := func(c methodOpener, g grabber) (grabber, error) {
		p.cv = frameConv{}
		return awaitFirst(g, c.open, p.convert, time.Now().Add(openFirstFrame), time.Now, time.Sleep)
	}
	g, i, tried, err := selectMethod(chain, first)
	p.attempts = tried
	if err != nil {
		return err
	}
	p.g, p.method, p.reopen = g, chain[i].m, chain[i].open
	if p.method == MethodGDI {
		p.fps, p.rc = gdiFPS, newRateCtlCap(gdiFPS)
	}
	return p.ensureEncoder()
}

// wrapDup / wrapGDI nil işaretçinin dolu arayüz olarak dönmesini önler.
func wrapDup(d *duplicator, err error) (grabber, error) {
	if err != nil {
		return nil, err
	}
	return d, nil
}

func wrapGDI(g *gdiGrabber, err error) (grabber, error) {
	if err != nil {
		return nil, err
	}
	return g, nil
}

// attemptLog denemeleri tanılama kaydına çevirir.
func (p *pipeline) attemptLog() []diag.Attempt {
	out := make([]diag.Attempt, 0, len(p.attempts))
	for _, a := range p.attempts {
		d := diag.Attempt{Method: string(a.m)}
		if a.err != nil {
			d.Reason, d.Op, d.HR = string(a.err.Reason), a.err.Op, a.err.HR
		}
		out = append(out, d)
	}
	return out
}

// damager değişen bölgeyi bildiren kaynak (DXGI). Bildirmeyen kaynakta (GDI, WGC) her kare tam dönüştürülür.
type damager interface{ damage() Damage }

// convert g'nin karesini NV12'ye çevirip (DXGI'da) imleci bindiren işlev; DXGI'da yalnız kirli bölgeler (AC-246).
func (p *pipeline) convert(g grabber) func(px []byte, w, h, pitch int) error {
	return func(px []byte, w, h, pitch int) error {
		dmg := Damage{Full: true}
		if d, ok := g.(damager); ok {
			dmg = d.damage()
		}
		t0 := time.Now()
		resized, err := p.cv.convert(px, w, h, pitch, g.rotation(), g.cursor(), dmg)
		if resized {
			p.resized = true
		}
		p.convCost = time.Since(t0)
		return err
	}
}

// ensureEncoder kare boyutu değiştiyse veya kodlayıcı yoksa kurar.
func (p *pipeline) ensureEncoder() error {
	f := p.cv.frame
	if f == nil || (!p.resized && p.enc != nil) {
		return nil
	}
	p.resized = false
	if p.enc != nil {
		p.enc.Close()
		p.enc = nil
	}
	open := func(hw bool) (Encoder, error) { return openEncoder(f.W, f.H, p.fps, hw) }
	ch, err := selectEncoder(open, !p.hwOff, time.Now, func(fb Fallback) {
		p.hwOff = true
		if p.onFallback != nil {
			p.onFallback(fb)
		}
	})
	if err != nil {
		return err
	}
	p.enc, p.encHW, p.hwReason = ch.enc, ch.hw, ch.hwReason
	p.kc.Request()
	return nil
}

// grab yeni masaüstü karesini (varsa; yalnız imleç hareketi de sayılır) NV12'ye çevirip imleci bindirir; çözünürlük değişirse kodlayıcıyı yeniden kurar.
// Kaynak kaybında (ACCESS_LOST, Güvenli Masaüstü/UAC, kilit ekranı, mod değişimi) kaynağı kapatır ve aynı yöntemle
// geri çekilmeli yeniden açar; bu sürede son kare kullanılmaya devam eder. Yalnız kodlayıcı kurulamazsa ya da
// paylaşılan pencere kapandıysa (WINDOW_CLOSED, AC-248) hata döner.
func (p *pipeline) grab() (bool, error) {
	if p.g == nil {
		wait := time.Until(p.retryAt)
		if wait > 0 {
			time.Sleep(min(wait, acquireWaitMs*time.Millisecond))
			return false, nil
		}
		g, err := p.reopen()
		if windowFinal(err) {
			return false, err // pencere kapandı: yeniden açma düzeltmez, paylaşım durur (AC-248)
		}
		if err != nil {
			p.backoff = min(reopenMax, max(reopenMin, p.backoff*2))
			p.retryAt = time.Now().Add(p.backoff)
			return false, nil
		}
		p.g, p.backoff = g, 0
		p.cv.invalidate() // yeni çoğaltma: önceki tamponla ilişki yok, ilk kare tam dönüşür
		p.kc.Request()
	}
	changed, err := p.g.acquire(acquireWaitMs, p.convert(p.g))
	if windowFinal(err) {
		return false, err
	}
	if err != nil {
		p.g.close()
		p.g = nil
		p.retryAt = time.Now().Add(reopenMin)
		return false, nil
	}
	if err := p.ensureEncoder(); err != nil {
		return false, err
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
		data, key, err := p.enc.Encode(p.cv.frame, dur, p.kc.Due(now))
		if err != nil {
			return rtc.Frame{}, tag(err, stageEncode, "Encode")
		}
		cost := time.Since(now) // kodlama (+ yeni karede dönüşüm): AC-41 kare hızı denetimi
		if changed {
			cost += p.convCost
		}
		if p.rc.Observe(cost) {
			p.enc.SetBitrate(bitrateFor(p.cv.frame.W, p.cv.frame.H, p.rc.FPS()))
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
		p.enc.Close()
	}
	if p.g != nil {
		p.g.close()
	}
}
