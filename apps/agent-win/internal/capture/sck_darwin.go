//go:build darwin

package capture

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/objc"
)

// ScreenCaptureKit kaynağı (ADR-0037 m.2): tek ekran, kendi uygulamamız HARİÇ (gösterge, işaretleme, oturum
// pencereleri görüntüye girmez), NV12 '420v', GPU'da OutputSize'a ölçekli (uzun kenar ≤ 1920; tam Retina donanım
// kodlayıcıya girmez), 30 fps tavan, imleç karede. Örnek geri çağrısı (SCK kuyruğu) yalnız düzlemleri Go NV12'ye
// kopyalar ve son kare yuvasına bırakır; kodlama Go goroutine'indedir.

const (
	sckStatusComplete = 0 // SCFrameStatusComplete
	sckContentTimeout = 5 * time.Second
	sckExcludeEvery   = time.Second // kendi uygulama listede yoksa yeniden deneme aralığı
)

var (
	errStreamStopped = errors.New("capture: SCStream durdu")
	// errStreamReopen kendi uygulamamız sonradan listede bulundu: akış dışlamalı filtreyle yeniden açılmalı ve
	// dışlama öncesi kare (penceremizi içerebilir) bir daha kodlanmamalı.
	errStreamReopen = errors.New("capture: kendi uygulama dışlanacak, akış yeniden açılıyor")
)

// sampleQueue örnek geri çağrılarının seri kuyruğu (süreç ömrü, tek; yeniden açmada yenisi oluşturulmaz).
var sampleQueue = sync.OnceValues(func() (objc.Queue, error) { return objc.NewQueue("net.noktabilisim.destek.capture") })

// sckStreams temsilci nesnesi → akış (C'ye Go işaretçisi verilmez; anahtar nesnenin objc kimliği).
var (
	sckMu      sync.Mutex
	sckStreams = map[objc.ID]*sckStream{}
	outputCls  objc.Class
)

// registerStreamOutput SCStreamOutput + SCStreamDelegate temsilci sınıfı (init'te bir kez, FFI kuralı 2).
func registerStreamOutput() error {
	ns, err := objc.GetClass("NSObject")
	if err != nil {
		return err
	}
	// Protokol nesneleri çalışma zamanında yalnız bir görüntü onları benimsediyse bulunur (SCK'da yok); SCK yöntemleri
	// respondsToSelector ile çağırır (K0s-1 aynı biçimde çalıştı). Bulunursa yine eklenir.
	var protos []*pobjc.Protocol
	for _, name := range []string{"SCStreamOutput", "SCStreamDelegate"} {
		if p := pobjc.GetProtocol(name); p != nil {
			protos = append(protos, p)
		}
	}
	if _, err := objc.GetClass("SCStream"); err != nil {
		return errFrameworks
	}
	outputCls, err = pobjc.RegisterClass("NKCaptureStreamOutput", ns, protos, nil, []pobjc.MethodDef{
		{Cmd: objc.Sel("stream:didOutputSampleBuffer:ofType:"), Fn: onSample},
		{Cmd: objc.Sel("stream:didStopWithError:"), Fn: onStop},
	})
	return err
}

func lookupStream(self objc.ID) *sckStream {
	sckMu.Lock()
	defer sckMu.Unlock()
	return sckStreams[self]
}

// onSample SCK kuyruğunda: yalnız Complete karede düzlemleri kopyalar.
func onSample(self objc.ID, _ objc.SEL, _ objc.ID, sb uintptr, typ int) {
	if typ != 0 { // SCStreamOutputTypeScreen
		return
	}
	s := lookupStream(self)
	if s == nil {
		return
	}
	status := int64(-1)
	if arr := cmAttachments(sb, false); arr != 0 && cfArrayCount(arr) > 0 {
		if n := cfDictGet(cfArrayAt(arr, 0), kSCKStatus); n != 0 {
			cfNumberGet(n, cfNumSInt64, &status)
		}
	}
	if status != sckStatusComplete {
		return
	}
	if pb := cmGetImage(sb); pb != 0 {
		s.slot.deliver(pb)
	}
}

// onStop akış sistemce durduruldu (ekran çıkarıldı, kip değişti, izin geri alındı …): kaynak yeniden açar.
func onStop(self objc.ID, _ objc.SEL, _ objc.ID, _ objc.ID) {
	if s := lookupStream(self); s != nil {
		s.slot.stop()
	}
}

// frameSlot son kare yuvası (geri çağrı ↔ kodlama goroutine'i).
type frameSlot struct {
	mu        sync.Mutex
	latest    *NV12
	free      []*NV12
	stopped   bool
	reopen    bool // stopped nedeni errStreamReopen
	ready     chan struct{}
	delivered int // Complete kare sayısı (ölçüm)
	bad       int // kopyalanamayan kare
}

func newSlot() *frameSlot { return &frameSlot{ready: make(chan struct{}, 1)} }

// deliver CVPixelBuffer'ı Go NV12'ye kopyalar (kilit/serbest bırakma eşli, taşma denetimli) ve yuvaya koyar.
func (s *frameSlot) deliver(pb uintptr) {
	if cvFormat(pb) != pixFmtNV12 {
		s.count(false)
		return
	}
	w, h := int(cvWidth(pb)), int(cvHeight(pb))
	if w < 2 || h < 2 || w%2 != 0 || h%2 != 0 || w > 16384 || h > 16384 {
		s.count(false)
		return
	}
	f := s.take(w, h)
	if cvLock(pb, 1) != 0 { // kCVPixelBufferLock_ReadOnly
		s.count(false)
		return
	}
	err := withPlanes(pb, w, h, func(y []byte, ys int, uv []byte, uvs int) error {
		if err := copyPlane(f.Data[:w*h], w, y, ys, w, h); err != nil {
			return err
		}
		return copyPlane(f.Data[w*h:], w, uv, uvs, w, h/2)
	})
	cvUnlock(pb, 1)
	if err != nil {
		s.count(false)
		s.recycle(f)
		return
	}
	s.mu.Lock()
	if s.latest != nil {
		s.free = append(s.free, s.latest)
	}
	s.latest = f
	s.delivered++
	s.mu.Unlock()
	select {
	case s.ready <- struct{}{}:
	default:
	}
}

func (s *frameSlot) count(ok bool) {
	if !ok {
		s.mu.Lock()
		s.bad++
		s.mu.Unlock()
	}
}

// take boyutu uyan boş tampon (yoksa yeni).
func (s *frameSlot) take(w, h int) *NV12 {
	s.mu.Lock()
	defer s.mu.Unlock()
	for len(s.free) > 0 {
		f := s.free[len(s.free)-1]
		s.free = s.free[:len(s.free)-1]
		if f.W == w && f.H == h {
			return f
		}
	}
	return NewNV12(w, h)
}

// recycle kullanılmış tamponu geri verir (en çok 3 tutulur).
func (s *frameSlot) recycle(f *NV12) {
	if f == nil {
		return
	}
	s.mu.Lock()
	if len(s.free) < 3 {
		s.free = append(s.free, f)
	}
	s.mu.Unlock()
}

func (s *frameSlot) stop() { s.halt(false) }

func (s *frameSlot) halt(reopen bool) {
	s.mu.Lock()
	s.stopped = true
	s.reopen = s.reopen || reopen
	s.mu.Unlock()
	select {
	case s.ready <- struct{}{}:
	default:
	}
}

// wait en çok d kadar yeni kare bekler: (kare, nil), zaman aşımında (nil, nil), akış durduysa errStreamStopped,
// dışlama için yeniden açılacaksa errStreamReopen.
func (s *frameSlot) wait(ctx context.Context, done <-chan struct{}, d time.Duration) (*NV12, error) {
	if f, err := s.poll(); f != nil || err != nil {
		return f, err
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-done:
		return nil, errClosed
	case <-t.C:
		return nil, nil
	case <-s.ready:
		return s.poll()
	}
}

func (s *frameSlot) poll() (*NV12, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.reopen {
		return nil, errStreamReopen
	}
	if s.stopped {
		return nil, errStreamStopped
	}
	f := s.latest
	s.latest = nil
	return f, nil
}

// sckStream açık bir SCStream.
type sckStream struct {
	stream   objc.ID
	output   objc.ID
	slot     *frameSlot
	w, h     int
	excluded atomic.Bool // kendi uygulamamız filtrede hariç
	quit     chan struct{}
	wg       sync.WaitGroup
}

// streamOpts test kancaları (üretimde sıfır değer).
type streamOpts struct {
	noExclude   bool // pozitif kontrol: kendi uygulamayı hariç tutma
	lateExclude bool // açılışta listede yokmuş gibi davran (excludeLater yolunu zorlar)
	haltFirst   bool // ilk kare beklenmeden yeniden açılış iste (Open yeniden açılış dalı)
}

// openStream displayID ekranı için akışı başlatır.
func openStream(displayID uint32, opt streamOpts) (*sckStream, error) {
	if fwErr != nil {
		return nil, &Error{Reason: ReasonOther, Op: "LoadFrameworks"}
	}
	if !cgPreflight() {
		// İzin yokken SCShareableContent sistem diyaloğu açabilir; rehber/istek K4'ün (macperm) işidir.
		return nil, &Error{Reason: ReasonOther, Op: "ScreenCaptureAccess"}
	}
	content, err := shareableContent()
	if err != nil {
		return nil, err
	}
	defer objc.Release(content)
	s := &sckStream{slot: newSlot(), quit: make(chan struct{})}
	var oerr error
	objc.Pool(func() { oerr = s.start(content, displayID, opt) })
	if oerr != nil {
		s.close()
		return nil, oerr
	}
	if !s.excluded.Load() && !opt.noExclude {
		s.wg.Add(1)
		go s.excludeLater()
	}
	if opt.haltFirst {
		s.slot.halt(true)
	}
	return s, nil
}

// shareableContent SCShareableContent (kendi pencereleri dahil, ekran dışı pencereler de: uygulamamız listede olsun).
// Dönen nesne +1 tutulur.
func shareableContent() (objc.ID, error) { return shareableContentOpts(false, false) }

// shareableContentOpts P33 pencere listesi (§6.2: masaüstü öğeleri hariç, yalnız ekrandakiler) ile ortak çağrı.
func shareableContentOpts(excludeDesktop, onScreenOnly bool) (objc.ID, error) {
	type res struct {
		content objc.ID
		code    uint32
	}
	ch := make(chan res, 1)
	// Hata nesnesi blok dönünce bırakılabilir: kodu blok içinde okunur; içerik retain edilir.
	blk := pobjc.NewBlock(func(_ pobjc.Block, content, nserr objc.ID) {
		if content != 0 {
			content.Send(objc.Sel("retain"))
		}
		ch <- res{content, nsErrorCode(nserr)}
	})
	defer blk.Release()
	c, err := objc.GetClass("SCShareableContent")
	if err != nil {
		return 0, &Error{Reason: ReasonOther, Op: "SCShareableContent"}
	}
	objc.ID(c).Send(objc.Sel("getShareableContentExcludingDesktopWindows:onScreenWindowsOnly:completionHandler:"),
		excludeDesktop, onScreenOnly, blk)
	select {
	case r := <-ch:
		if r.content == 0 {
			return 0, &Error{Reason: ReasonOther, Op: "SCShareableContent", HR: r.code}
		}
		return r.content, nil
	case <-time.After(sckContentTimeout):
		go func() { // geç gelen yanıtın retain'i bırakılır
			if r := <-ch; r.content != 0 {
				objc.Release(r.content)
			}
		}()
		return 0, &Error{Reason: ReasonOther, Op: "SCShareableContentTimeout"}
	}
}

// nsErrorCode NSError kodu (yalnız sayı; metin kişisel veri taşıyabilir, alınmaz).
func nsErrorCode(e objc.ID) uint32 {
	if e == 0 {
		return 0
	}
	return uint32(pobjc.Send[int](e, objc.Sel("code")))
}

// start filtre + yapılandırma + temsilci; ilk kare beklenmez (Open bekler).
func (s *sckStream) start(content objc.ID, displayID uint32, opt streamOpts) error {
	disp := findDisplay(content, displayID)
	if disp == 0 {
		return &Error{Reason: ReasonNoOutput, Op: "SCDisplay"}
	}
	excl, found := ownApps(content, opt.noExclude || opt.lateExclude)
	s.excluded.Store(found)
	filter, err := newFilter(disp, excl)
	if err != nil {
		return err
	}
	defer objc.Release(filter)
	pw, ph := pixelSize(displayID)
	s.w, s.h = OutputSize(pw, ph)
	return s.startFilter(filter)
}

// streamConfig +1 SCStreamConfiguration (s.w × s.h, NV12 '420v', 30 fps tavan, imleç karede). Ekran ve pencere akışı
// ile boyut güncellemesi (P33 updateConfiguration) aynı yapılandırmayı kullanır.
func (s *sckStream) streamConfig() (objc.ID, error) {
	cfgCls, err := objc.GetClass("SCStreamConfiguration")
	if err != nil {
		return 0, &Error{Reason: ReasonOther, Op: "SCStreamConfiguration"}
	}
	cfg := objc.ID(cfgCls).Send(objc.Sel("new"))
	cfg.Send(objc.Sel("setWidth:"), uint(s.w))
	cfg.Send(objc.Sel("setHeight:"), uint(s.h))
	cfg.Send(objc.Sel("setPixelFormat:"), uint32(pixFmtNV12))
	cfg.Send(objc.Sel("setMinimumFrameInterval:"), cmTime{Value: 1, Timescale: targetFPS, Flags: cmTimeValid})
	cfg.Send(objc.Sel("setShowsCursor:"), true)
	cfg.Send(objc.Sel("setQueueDepth:"), 5)
	cfg.Send(objc.Sel("setColorMatrix:"), objc.ID(kSCKMatrix))
	cfg.Send(objc.Sel("setColorSpaceName:"), objc.ID(kSRGB))
	return cfg, nil
}

// startFilter yapılandırma + temsilci + akışın başlatılması (ekran ve pencere filtresi ortak).
func (s *sckStream) startFilter(filter objc.ID) error {
	cfg, err := s.streamConfig()
	if err != nil {
		return err
	}
	defer objc.Release(cfg)
	s.output = objc.ID(outputCls).Send(objc.Sel("new"))
	sckMu.Lock()
	sckStreams[s.output] = s
	sckMu.Unlock()
	stCls, err := objc.GetClass("SCStream")
	if err != nil {
		return &Error{Reason: ReasonOther, Op: "SCStream"}
	}
	s.stream = objc.ID(stCls).Send(objc.Sel("alloc")).Send(objc.Sel("initWithFilter:configuration:delegate:"), filter, cfg, s.output)
	if s.stream == 0 {
		return &Error{Reason: ReasonOther, Op: "SCStreamInit"}
	}
	q, err := sampleQueue()
	if err != nil {
		return &Error{Reason: ReasonOther, Op: "DispatchQueue"}
	}
	var nserr objc.ID
	if !pobjc.Send[bool](s.stream, objc.Sel("addStreamOutput:type:sampleHandlerQueue:error:"), s.output, 0, uintptr(q),
		unsafe.Pointer(&nserr)) {
		return &Error{Reason: ReasonOther, Op: "addStreamOutput", HR: nsErrorCode(nserr)}
	}
	return s.call("startCaptureWithCompletionHandler:", "startCapture")
}

// call tamamlama bloklu SCStream çağrısı (en çok sckContentTimeout). args bloktan önceki argümanlardır.
func (s *sckStream) call(sel, op string, args ...any) error {
	ch := make(chan uint32, 1)
	blk := pobjc.NewBlock(func(_ pobjc.Block, nserr objc.ID) { ch <- nsErrorCode(nserr) })
	defer blk.Release()
	s.stream.Send(objc.Sel(sel), append(args, blk)...)
	select {
	case code := <-ch:
		if code != 0 {
			return &Error{Reason: ReasonOther, Op: op, HR: code}
		}
		return nil
	case <-time.After(sckContentTimeout):
		return &Error{Reason: ReasonOther, Op: op + "Timeout"}
	}
}

func findDisplay(content objc.ID, displayID uint32) objc.ID {
	ds := content.Send(objc.Sel("displays"))
	for i := range pobjc.Send[uint](ds, objc.Sel("count")) {
		d := ds.Send(objc.Sel("objectAtIndex:"), i)
		if pobjc.Send[uint32](d, objc.Sel("displayID")) == displayID {
			return d
		}
	}
	return 0
}

// ownApps hariç tutulacak SCRunningApplication dizisi (kendi PID'imiz); found=false ise listede yoktu.
func ownApps(content objc.ID, skip bool) (objc.ID, bool) {
	ac, _ := objc.GetClass("NSMutableArray")
	excl := objc.ID(ac).Send(objc.Sel("array"))
	if skip {
		return excl, false
	}
	apps := content.Send(objc.Sel("applications"))
	pid := int32(os.Getpid())
	found := false
	for i := range pobjc.Send[uint](apps, objc.Sel("count")) {
		a := apps.Send(objc.Sel("objectAtIndex:"), i)
		if pobjc.Send[int32](a, objc.Sel("processID")) == pid {
			excl.Send(objc.Sel("addObject:"), a)
			found = true
		}
	}
	return excl, found
}

// newFilter +1 SCContentFilter.
func newFilter(disp, excl objc.ID) (objc.ID, error) {
	fc, err := objc.GetClass("SCContentFilter")
	if err != nil {
		return 0, &Error{Reason: ReasonOther, Op: "SCContentFilter"}
	}
	nc, _ := objc.GetClass("NSArray")
	f := objc.ID(fc).Send(objc.Sel("alloc")).Send(objc.Sel("initWithDisplay:excludingApplications:exceptingWindows:"),
		disp, excl, objc.ID(nc).Send(objc.Sel("array")))
	if f == 0 {
		return 0, &Error{Reason: ReasonOther, Op: "SCContentFilter"}
	}
	return f, nil
}

// excludeLater uygulamamız açılışta listede yoksa (henüz penceresi yok) bulunana kadar yoklar; bulununca akışın
// dışlamalı filtreyle yeniden açılmasını ister. updateContentFilter kullanılmaz: CI'da (macOS 15) tamamlama başarılı
// dönse de sonraki ~3 sn taze karelerde pencere görünmeye devam etti, ekran durağanlaşınca da yeni kare gelmediği için
// pencereli son kare keep-alive ile süresiz yeniden gönderildi (AC-392 ihlali). Dışlamayla açılan akış ise sonradan
// açılan pencereleri de güvenilir biçimde dışlar.
func (s *sckStream) excludeLater() {
	defer s.wg.Done()
	t := time.NewTicker(sckExcludeEvery)
	defer t.Stop()
	for {
		select {
		case <-s.quit:
			return
		case <-t.C:
		}
		if s.ownListed() {
			s.slot.halt(true)
			return
		}
	}
}

// ownListed uygulamamız SCShareableContent listesinde mi.
func (s *sckStream) ownListed() bool {
	content, err := shareableContent()
	if err != nil {
		return false
	}
	defer objc.Release(content)
	found := false
	objc.Pool(func() { _, found = ownApps(content, false) })
	return found
}

// close akışı durdurur ve bırakır (idempotent değil; tek sahip çağırır).
func (s *sckStream) close() {
	close(s.quit)
	s.wg.Wait()
	objc.Pool(func() {
		if s.stream != 0 {
			_ = s.call("stopCaptureWithCompletionHandler:", "stopCapture")
			objc.Release(s.stream)
			s.stream = 0
		}
	})
	if s.output != 0 {
		sckMu.Lock()
		delete(sckStreams, s.output)
		sckMu.Unlock()
		objc.Release(s.output)
		s.output = 0
	}
}
