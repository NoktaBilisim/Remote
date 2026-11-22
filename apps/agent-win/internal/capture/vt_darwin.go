//go:build darwin

package capture

import (
	"errors"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/darwin/helpermode"
	"remote-support/agent-win/internal/darwin/objc"
)

// VideoToolbox H.264 kodlayıcı (ADR-0037 m.2 r3): RealTime + Baseline, yeniden sıralama yok, anahtar kare en geç
// gopDuration; EnableLowLatencyRateControl KULLANILMAZ (zorlanan IDR'yi atlıyor). Encode eşzamanlıdır: kare verilir,
// çıktı geri çağrısı (VideoToolbox iş parçacığı; yalnız kopyala-ve-kanala-bırak) beklenir ve erişim birimi Annex-B
// olarak döner — keyClock.Mark doğru kareye düşer, kare kaybı sayılabilir.

const (
	codecAVC1     = 0x61766331 // 'avc1'
	pixFmtNV12    = 0x34323076 // '420v' kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
	vtFrameDrop   = 2          // kVTEncodeInfo_FrameDropped
	encodeTimeout = time.Second
	cfNumSInt64   = 4 // kCFNumberSInt64Type
)

// vtOut çıktı geri çağrısının Go'ya bıraktığı kopya.
type vtOut struct {
	seq     uintptr
	status  int32
	dropped bool
	key     bool
	data    []byte   // AVCC
	params  [][]byte // anahtar karede SPS/PPS
	nalLen  int
}

// vtSessions çıktı geri çağrısının bağlamı: C'ye yalnız tamsayı anahtar verilir (FFI kuralı 1).
var (
	vtMu       sync.Mutex
	vtNext     uintptr
	vtSessions = map[uintptr]chan vtOut{}
	vtCallback uintptr
	forceProps objc.ID // {ForceKeyFrame: true}, süreç ömrü
	forceOnce  sync.Once
)

// vtOutput VTCompressionOutputCallback: yalnız kopyalar ve kanala bırakır. Bilinmeyen bağlam (kapanmış oturum) yok
// sayılır; kanal doluysa çıktı düşer (Encode zaman aşımına uğrar ve sonraki kare IDR olur).
func vtOutput(ref, seq uintptr, status int32, flags uint32, sb uintptr) {
	vtMu.Lock()
	ch, ok := vtSessions[ref]
	vtMu.Unlock()
	if !ok {
		return
	}
	o := vtOut{seq: seq, status: status, dropped: flags&vtFrameDrop != 0}
	if status == 0 && sb != 0 {
		copySample(&o, sb)
	}
	select {
	case ch <- o:
	default:
	}
}

// copySample örnek tamponundan AVCC baytlarını ve (anahtar karede) parametre kümelerini kopyalar.
func copySample(o *vtOut, sb uintptr) {
	o.key = true
	if arr := cmAttachments(sb, false); arr != 0 && cfArrayCount(arr) > 0 {
		if v := cfDictGet(cfArrayAt(arr, 0), kNotSync); v != 0 && cfBooleanValue(v) {
			o.key = false
		}
	}
	bb := cmGetData(sb)
	if bb == 0 {
		return
	}
	n := cmBBLen(bb)
	if n == 0 || n > maxPlaneBytes {
		return
	}
	o.data = make([]byte, n)
	if cmBBCopy(bb, 0, n, unsafe.Pointer(&o.data[0])) != 0 {
		o.data = nil
		return
	}
	fd := cmGetFormat(sb)
	if fd == 0 {
		return
	}
	var cnt uintptr
	var hdr int32
	if cmParamSet(fd, 0, nil, nil, &cnt, &hdr) != 0 {
		return
	}
	o.nalLen = int(hdr)
	if !o.key {
		return
	}
	for i := uintptr(0); i < min(cnt, 4); i++ {
		var p unsafe.Pointer
		var sz uintptr
		if cmParamSet(fd, i, &p, &sz, nil, nil) != 0 || p == nil || sz == 0 || sz > 1024 {
			continue
		}
		o.params = append(o.params, append([]byte(nil), unsafe.Slice((*byte)(p), sz)...))
	}
}

// vtEncoder Encoder'ın VideoToolbox uygulaması (ana ve düşük iz ayrı oturum, ADR-0035).
type vtEncoder struct {
	sess     uintptr
	ref      uintptr
	out      chan vtOut
	w, h     int
	hw       bool
	seq      uintptr
	start    time.Time
	pts      ptsClock
	needKey  bool // çıktı kaybedildi: sonraki kare IDR
	dropped  int  // kVTEncodeInfo_FrameDropped (ölçüm: kare kaybı)
	timeouts int
}

// openEncoder VideoToolbox oturumu: hw ise donanım zorunlu (yoksa hata → selectEncoder yazılımı dener), değilse
// yazılım kodlayıcı.
func openEncoder(w, h, fps int, hw bool) (Encoder, error) {
	if fwErr != nil {
		return nil, &Error{Reason: ReasonNoH264Encoder, Op: "LoadFrameworks"}
	}
	var enc *vtEncoder
	var err error
	objc.Pool(func() { enc, err = createVT(w, h, fps, hw) })
	if err != nil {
		return nil, err
	}
	return enc, nil
}

func createVT(w, h, fps int, hw bool) (*vtEncoder, error) {
	specKey, specVal := kEnableHW, false
	if hw {
		specKey, specVal = kRequireHW, true
	}
	spec := dict([]uintptr{specKey}, []objc.ID{nsBool(specVal)})
	attrs := dict([]uintptr{kPixFmt, kPixW, kPixH, kIOSurface},
		[]objc.ID{nsInt(pixFmtNV12), nsInt(int64(w)), nsInt(int64(h)), dict(nil, nil)})
	ch := make(chan vtOut, 4)
	vtMu.Lock()
	vtNext++
	ref := vtNext
	vtSessions[ref] = ch
	vtMu.Unlock()
	var s uintptr
	if rc := vtCreate(0, int32(w), int32(h), codecAVC1, uintptr(spec), uintptr(attrs), 0, vtCallback, ref, &s); rc != 0 || s == 0 {
		dropSession(ref)
		return nil, &Error{Reason: ReasonNoH264Encoder, Op: "VTCompressionSessionCreate", HR: uint32(rc)}
	}
	e := &vtEncoder{sess: s, ref: ref, out: ch, w: w, h: h, hw: hw}
	set := []struct {
		key uintptr
		val objc.ID
	}{
		{kRealTime, nsBool(true)},
		{kProfile, objc.ID(kBaseline)},
		{kReorder, nsBool(false)},
		{kMaxKeyDur, nsFloat(gopDuration.Seconds())},
		{kExpFPS, nsInt(int64(fps))},
	}
	for _, p := range set {
		if rc := vtSet(s, p.key, uintptr(p.val)); rc != 0 {
			e.Close()
			return nil, &Error{Reason: ReasonEncoderConfig, Op: "VTSessionSetProperty", HR: uint32(rc)}
		}
	}
	// Renk etiketi (VUI): SCK 709 matrisle üretir; çözücü aynı matrisi kullansın. Desteklenmezse etiketsiz kalır.
	vtSet(s, kMatrix, kVT709)
	vtSet(s, kPrimaries, kVTP709)
	vtSet(s, kTransfer, kVTT709)
	e.setBitrate(bitrateFor(w, h, fps))
	if rc := vtPrepare(s); rc != 0 {
		e.Close()
		return nil, &Error{Reason: ReasonEncoderConfig, Op: "PrepareToEncodeFrames", HR: uint32(rc)}
	}
	return e, nil
}

func dropSession(ref uintptr) {
	vtMu.Lock()
	delete(vtSessions, ref)
	vtMu.Unlock()
}

// SetBitrate ortalama hedef + 1 sn pencereli tavan (Windows CBR karşılığı; düşük izde signal.LowBPS).
func (e *vtEncoder) SetBitrate(bps int) { objc.Pool(func() { e.setBitrate(bps) }) }

func (e *vtEncoder) setBitrate(bps int) {
	vtSet(e.sess, kAvgBitRate, uintptr(nsInt(int64(bps))))
	limits := array([]objc.ID{nsInt(int64(bps / 8)), nsFloat(1)})
	vtSet(e.sess, kRateLimits, uintptr(limits))
}

// UsingHardware oturum donanım kodlayıcıda mı (tanılama/ölçüm).
func (e *vtEncoder) UsingHardware() bool {
	var v uintptr
	if vtCopy(e.sess, kUsingHW, 0, &v) != 0 || v == 0 {
		return false
	}
	defer cfRelease(v)
	return cfBooleanValue(v)
}

// Encode NV12 kareyi oturumun havuz tamponuna kopyalar, kodlatır ve çıktıyı bekler (Encoder).
func (e *vtEncoder) Encode(f *NV12, dur time.Duration, key bool) ([]byte, bool, error) {
	if f == nil || f.W != e.w || f.H != e.h || len(f.Data) < f.W*f.H*3/2 {
		return nil, false, &Error{Reason: ReasonEncodeFailed, Op: "FrameSize"}
	}
	pb, err := e.fill(f)
	if err != nil {
		return nil, false, err
	}
	if e.start.IsZero() {
		e.start = time.Now()
	}
	key = key || e.needKey
	e.needKey = false
	var props uintptr
	if key {
		props = uintptr(forceKeyProps())
	}
	e.seq++
	pts := cmTime{Value: e.pts.next(time.Since(e.start).Microseconds()), Timescale: 1_000_000, Flags: cmTimeValid}
	d := cmTime{Value: max(dur.Microseconds(), 1), Timescale: 1_000_000, Flags: cmTimeValid}
	var info uint32
	rc := vtEncode(e.sess, pb, pts, d, props, e.seq, &info)
	cfRelease(pb)
	if rc != 0 {
		return nil, false, &Error{Reason: ReasonEncodeFailed, Op: "VTCompressionSessionEncodeFrame", HR: uint32(rc)}
	}
	return e.await(e.seq)
}

// await seq karesinin çıktısını bekler; önceki (geç kalmış) çıktılar atılır ve sonraki kare IDR'ye zorlanır.
func (e *vtEncoder) await(seq uintptr) ([]byte, bool, error) {
	t := time.NewTimer(encodeTimeout)
	defer t.Stop()
	for {
		select {
		case o := <-e.out:
			if o.seq != seq {
				e.needKey = true
				continue
			}
			return e.result(o)
		case <-t.C:
			e.timeouts++
			e.needKey = true
			return nil, false, nil // fallbackEncoder encoderStall boyunca çıktı yoksa yazılıma geçer
		}
	}
}

func (e *vtEncoder) result(o vtOut) ([]byte, bool, error) {
	if o.status != 0 {
		return nil, false, &Error{Reason: ReasonEncodeFailed, Op: "VTOutput", HR: uint32(o.status)}
	}
	if o.dropped || len(o.data) == 0 {
		e.dropped++
		e.needKey = true
		return nil, false, nil
	}
	au, err := avccToAnnexB(o.data, o.nalLen, o.params, o.key)
	if err != nil {
		e.needKey = true
		return nil, false, &Error{Reason: ReasonEncodeFailed, Op: "AVCC"}
	}
	return au, o.key, nil
}

// fill havuzdan NV12 CVPixelBuffer alır ve kareyi düzlem düzlem kopyalar (FFI kuralı 4: taşma denetimli, kilit eşli).
func (e *vtEncoder) fill(f *NV12) (uintptr, error) {
	pool := vtPool(e.sess)
	var pb uintptr
	if pool == 0 || cvPoolCreate(0, pool, &pb) != 0 || pb == 0 {
		return 0, &Error{Reason: ReasonEncodeFailed, Op: "CVPixelBufferPoolCreatePixelBuffer"}
	}
	if cvLock(pb, 0) != 0 {
		cfRelease(pb)
		return 0, &Error{Reason: ReasonEncodeFailed, Op: "CVPixelBufferLockBaseAddress"}
	}
	err := withPlanes(pb, f.W, f.H, func(y []byte, ys int, uv []byte, uvs int) error {
		if err := copyPlane(y, ys, f.Data[:f.W*f.H], f.W, f.W, f.H); err != nil {
			return err
		}
		return copyPlane(uv, uvs, f.Data[f.W*f.H:], f.W, f.W, f.H/2)
	})
	cvUnlock(pb, 0)
	if err != nil {
		cfRelease(pb)
		return 0, &Error{Reason: ReasonEncodeFailed, Op: "CopyPlanes"}
	}
	return pb, nil
}

// withPlanes kilitli NV12 CVPixelBuffer'ın iki düzlemini denetimli Go dilimleri olarak fn'e verir (yalnız çağrı
// süresince geçerli). Biçim, boyut ya da bytesPerRow × yükseklik tutarsızsa hata.
func withPlanes(pb uintptr, w, h int, fn func(y []byte, ys int, uv []byte, uvs int) error) error {
	if cvPlaneCount(pb) != 2 || int(cvWidth(pb)) != w || int(cvHeight(pb)) != h {
		return errPlaneSize
	}
	var planes [2][]byte
	var strides [2]int
	for i := range uintptr(2) {
		base := cvBase(pb, i)
		bpr, rows := cvBPR(pb, i), cvPlaneH(pb, i)
		n, ok := planeBytes(uint64(bpr), uint64(rows))
		if base == nil || !ok {
			return errPlaneSize
		}
		planes[i], strides[i] = unsafe.Slice((*byte)(base), n), int(bpr)
	}
	return fn(planes[0], strides[0], planes[1], strides[1])
}

// Close oturumu bekleyen kareleri bitirip kapatır; sonra gelen geri çağrı yok sayılır.
func (e *vtEncoder) Close() {
	if e.sess == 0 {
		return
	}
	vtComplete(e.sess, cmTime{})
	vtInvalidate(e.sess)
	cfRelease(e.sess)
	e.sess = 0
	dropSession(e.ref)
}

func forceKeyProps() objc.ID {
	forceOnce.Do(func() {
		objc.Pool(func() {
			forceProps = dict([]uintptr{kForceKey}, []objc.ID{nsBool(true)})
			forceProps.Send(objc.Sel("retain"))
		})
	})
	return forceProps
}

// Foundation yardımcıları (autorelease; çağıran objc.Pool içinde).

func nsInt(v int64) objc.ID {
	c, _ := objc.GetClass("NSNumber")
	return objc.ID(c).Send(objc.Sel("numberWithLongLong:"), v)
}

func nsFloat(v float64) objc.ID {
	c, _ := objc.GetClass("NSNumber")
	return objc.ID(c).Send(objc.Sel("numberWithDouble:"), v)
}

func nsBool(v bool) objc.ID {
	c, _ := objc.GetClass("NSNumber")
	return objc.ID(c).Send(objc.Sel("numberWithBool:"), v)
}

func dict(keys []uintptr, vals []objc.ID) objc.ID {
	c, _ := objc.GetClass("NSDictionary")
	if len(keys) == 0 {
		return objc.ID(c).Send(objc.Sel("dictionary"))
	}
	ks := make([]objc.ID, len(keys))
	for i, k := range keys {
		ks[i] = objc.ID(k)
	}
	return objc.ID(c).Send(objc.Sel("dictionaryWithObjects:forKeys:count:"), unsafe.Pointer(&vals[0]),
		unsafe.Pointer(&ks[0]), uint(len(ks)))
}

func array(vals []objc.ID) objc.ID {
	c, _ := objc.GetClass("NSArray")
	return objc.ID(c).Send(objc.Sel("arrayWithObjects:count:"), unsafe.Pointer(&vals[0]), uint(len(vals)))
}

// FFI kuralı 2: geri çağrı yuvası ve temsilci sınıf yalnız init'te, bir kez.
func init() {
	if helpermode.Active { // P33 S-P33-T2-3: çözücü yardımcısı kipinde çerçeve yüklenmez
		fwErr = errors.New("capture: çözücü yardımcısı kipi")
		return
	}
	fwErr = bindFrameworks()
	if fwErr != nil {
		return
	}
	vtCallback = purego.NewCallback(vtOutput)
	fwErr = registerStreamOutput()
}
