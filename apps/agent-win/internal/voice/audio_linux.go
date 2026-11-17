//go:build linux

package voice

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"remote-support/agent-win/internal/linux/glib"
)

// PulseAudio "simple" API ile mikrofon + hoparlör (mimari-p28g §2 `voice/audio_linux.go`, K0s-10, ADR-0038 m.2):
// 48 kHz mono S16LE, 20 ms parça. PipeWire (24.04, pipewire-pulse) ve PulseAudio (22.04) aynı pulse protokolünü sunar.
// Engelleyen pa_simple_read / pa_simple_write kendi goroutine'lerinde çağrılır; C geri çağrısı yoktur. Her tutamaç
// yalnız kendi goroutine'inde kullanılır ve o goroutine'in son çağrısı döndükten sonra aynı goroutine'de serbest bırakılır
// (Close başka goroutine'in içindeki tutamacı bırakmaz). Sunucu adresi ortamdan gelmez (PULSE_SERVER izin listesi dışı);
// aygıt adı/kimliği hiçbir hataya ve loga girmez. pa_strerror (libpulse.so.0) izin listesinde olmadığından hata kodu
// sayıyla sınıflanır.

const (
	paStreamPlayback = 1
	paStreamRecord   = 2
	paSampleS16LE    = 3
	pulseChunk       = FrameSamples * 2 // 20 ms, bayt
	pulseWriteWait   = 40 * time.Millisecond
	pulseCloseWait   = 400 * time.Millisecond
	stallAfter       = time.Second              // 1 sn mikrofon örneği yoksa durmuş akış (WASAPI ile aynı)
	firstFrameWait   = 3 * time.Second          // ilk çerçeve: askıdaki kaynağın uyanması (22.04 null sink ölçümü)
	capQueue         = 10                       // yakalama kuyruğu: 200 ms
	renderCap        = jitterCap * FrameSamples // çalma kuyruğu üst sınırı: 200 ms
)

// errDeviceClosed Close sonrası okuma/yazma.
var errDeviceClosed = errors.New("voice: ses aygıtı kapalı")

// errStalled mikrofon 1 sn boyunca örnek vermedi (errors.Is(err, ErrDevice)).
var errStalled = fmt.Errorf("%w: mikrofon akışı durdu", ErrDevice)

// pa_error_code (pulse/def.h).
const (
	paErrAccess               = 1
	paErrNoEntity             = 5
	paErrConnectionRefused    = 6
	paErrConnectionTerminated = 11
	paErrKilled               = 12
)

// classifyPA pulse hata kodunu aygıt hatası sınıfına eşler. ACCESS ErrDevice'tır (Windows gizlilik yolu metni Linux'a
// uymaz); bağlantı yoksa ya da varlık yoksa aygıt bulunamadı; bağlantı koptuysa aygıt kayboldu.
func classifyPA(code int32) error {
	switch code {
	case paErrNoEntity, paErrConnectionRefused:
		return ErrDeviceNotFound
	case paErrConnectionTerminated, paErrKilled:
		return ErrDeviceLost
	}
	return ErrDevice
}

// PAError pulse hatası; yalnız adım ve kod.
type PAError struct {
	Op   string
	Code int32
}

func (e *PAError) Error() string { return fmt.Sprintf("voice: %s pa=%d", e.Op, e.Code) }

// Unwrap kodun aygıt hatası sınıfı.
func (e *PAError) Unwrap() error { return classifyPA(e.Code) }

// sampleSpec pa_sample_spec (format enum, rate uint32, channels uint8; 12 bayt).
type sampleSpec struct {
	format   int32
	rate     uint32
	channels uint8
	_        [3]byte
}

// bufferAttr pa_buffer_attr.
type bufferAttr struct{ maxlength, tlength, prebuf, minreq, fragsize uint32 }

var (
	paOnce sync.Once
	paErr  error

	paSimpleNew   func(server, name *byte, dir int32, dev, stream *byte, ss *sampleSpec, cmap uintptr, attr *bufferAttr, e *int32) uintptr
	paSimpleRead  func(s uintptr, data unsafe.Pointer, n uintptr, e *int32) int32
	paSimpleWrite func(s uintptr, data unsafe.Pointer, n uintptr, e *int32) int32
	paSimpleFree  func(s uintptr)
)

func bindPulse() error {
	paOnce.Do(func() {
		h, err := glib.Open(glib.Path(glib.LibPulseSimple))
		if err != nil {
			paErr = err
			return
		}
		paErr = errors.Join(glib.Func(&paSimpleNew, h, "pa_simple_new"), glib.Func(&paSimpleRead, h, "pa_simple_read"),
			glib.Func(&paSimpleWrite, h, "pa_simple_write"), glib.Func(&paSimpleFree, h, "pa_simple_free"))
	})
	return paErr
}

// pulseDevice Device uygulaması.
type pulseDevice struct {
	capCh  chan []int16
	closed chan struct{}
	// rdDone/wrDone okuma/yazma goroutine'leri bitti (tutamaçlar bırakıldı).
	rdDone, wrDone chan struct{}
	failOnce       sync.Once
	fail           chan struct{} // goroutine aygıt hatasıyla bitti
	err            atomic.Pointer[error]

	rmu  sync.Mutex
	rq   []int16
	wake chan struct{}

	rendered, renderDropped atomic.Int64
	started                 atomic.Bool // ilk mikrofon çerçevesi alındı
	closeOnce               sync.Once
}

// newStream pa_simple_new (dir PLAYBACK/RECORD; varsayılan sunucu ve aygıt).
func newStream(dir int32, attr *bufferAttr) (uintptr, error) {
	name, err1 := glib.CString("Nokta Destek")
	stream, err2 := glib.CString("Sesli görüşme")
	if err1 != nil || err2 != nil {
		return 0, ErrDevice
	}
	ss := sampleSpec{format: paSampleS16LE, rate: SampleRate, channels: 1}
	var code int32
	s := paSimpleNew(nil, name, dir, nil, stream, &ss, 0, attr, &code)
	runtime.KeepAlive(name)
	runtime.KeepAlive(stream)
	if s == 0 {
		op := "pa_simple_new(kayıt)"
		if dir == paStreamPlayback {
			op = "pa_simple_new(çalma)"
		}
		return 0, &PAError{Op: op, Code: code}
	}
	return s, nil
}

// OpenPulse varsayılan mikrofonu ve hoparlörü açar (hata PAError: errors.Is ile ErrDeviceNotFound / ErrDeviceLost /
// ErrDevice).
func OpenPulse() (Device, error) {
	if err := bindPulse(); err != nil {
		return nil, ErrDeviceNotFound
	}
	none := ^uint32(0)
	rec, err := newStream(paStreamRecord, &bufferAttr{none, none, none, none, pulseChunk})
	if err != nil {
		return nil, err
	}
	play, err := newStream(paStreamPlayback, &bufferAttr{none, pulseChunk * 4, none, none, none})
	if err != nil {
		paSimpleFree(rec)
		return nil, err
	}
	d := &pulseDevice{capCh: make(chan []int16, capQueue), closed: make(chan struct{}), rdDone: make(chan struct{}),
		wrDone: make(chan struct{}), fail: make(chan struct{}), wake: make(chan struct{}, 1)}
	go d.reader(rec)
	go d.writer(play)
	return d, nil
}

func (d *pulseDevice) failWith(err error) {
	d.failOnce.Do(func() {
		d.err.Store(&err)
		close(d.fail)
	})
}

func (d *pulseDevice) isClosed() bool {
	select {
	case <-d.closed:
		return true
	default:
		return false
	}
}

// reader mikrofon çerçevelerini okur; kuyruk doluysa en eskiyi atar (okuyucu takılırsa gecikme birikmez).
func (d *pulseDevice) reader(rec uintptr) {
	defer close(d.rdDone)
	defer paSimpleFree(rec)
	buf := make([]byte, pulseChunk)
	for !d.isClosed() {
		var code int32
		if paSimpleRead(rec, unsafe.Pointer(&buf[0]), pulseChunk, &code) < 0 {
			d.failWith(&PAError{Op: "pa_simple_read", Code: code})
			return
		}
		f := make([]int16, FrameSamples)
		for i := range f {
			f[i] = int16(uint16(buf[2*i]) | uint16(buf[2*i+1])<<8)
		}
		d.deliver(f)
	}
}

func (d *pulseDevice) deliver(f []int16) {
	for {
		select {
		case d.capCh <- f:
			return
		default:
		}
		select {
		case <-d.capCh:
		default:
		}
	}
}

// writer hoparlör saatiyle 20 ms yazar. Kuyruk boşsa en çok 40 ms veri bekler (pulse tamponunda ≈ 60 ms ses vardır),
// gelmezse sessizlik yazar (akış durup yeniden tamponlamaya girmez). pa_simple_write tampon doluyken bloklar.
func (d *pulseDevice) writer(play uintptr) {
	defer close(d.wrDone)
	defer paSimpleFree(play)
	buf := make([]byte, pulseChunk)
	frame := make([]int16, FrameSamples)
	for !d.isClosed() {
		n := d.take(frame)
		if n == 0 {
			select {
			case <-d.wake:
			case <-time.After(pulseWriteWait):
			case <-d.closed:
				return
			}
			n = d.take(frame)
		}
		clear(frame[n:])
		for i, v := range frame {
			buf[2*i], buf[2*i+1] = byte(v), byte(uint16(v)>>8)
		}
		var code int32
		if paSimpleWrite(play, unsafe.Pointer(&buf[0]), pulseChunk, &code) < 0 {
			d.failWith(&PAError{Op: "pa_simple_write", Code: code})
			return
		}
		d.rendered.Add(int64(n))
	}
}

// take kuyruğun başından en çok bir çerçeve alır.
func (d *pulseDevice) take(frame []int16) int {
	d.rmu.Lock()
	defer d.rmu.Unlock()
	n := copy(frame, d.rq)
	d.rq = d.rq[:copy(d.rq, d.rq[n:])]
	return n
}

func (d *pulseDevice) exitErr() error {
	if d.isClosed() {
		return errDeviceClosed
	}
	if p := d.err.Load(); p != nil {
		return *p
	}
	return errDeviceClosed
}

// ReadFrame bir sonraki mikrofon çerçevesini bekler; 1 sn (ilk çerçevede 3 sn) örnek gelmezse durmuş akış (errStalled).
func (d *pulseDevice) ReadFrame(pcm []int16) error {
	if d.isClosed() { // kuyrukta kalan çerçeve Close'dan sonra verilmez
		return errDeviceClosed
	}
	wait := stallAfter
	if !d.started.Load() {
		wait = firstFrameWait
	}
	t := time.NewTimer(wait)
	defer t.Stop()
	select {
	case f := <-d.capCh:
		copy(pcm, f)
		d.started.Store(true)
		return nil
	case <-d.fail:
		return d.exitErr()
	case <-d.closed:
		return errDeviceClosed
	case <-t.C:
		return errStalled
	}
}

// WriteFrame çerçeveyi çalma kuyruğuna ekler; bloklamaz (200 ms'yi aşarsa en eski örnekler atılır; WASAPI ile aynı).
func (d *pulseDevice) WriteFrame(pcm []int16) error {
	select {
	case <-d.fail:
		return d.exitErr()
	case <-d.closed:
		return errDeviceClosed
	default:
	}
	d.rmu.Lock()
	d.rq = append(d.rq, pcm...)
	if over := len(d.rq) - renderCap; over > 0 {
		d.renderDropped.Add(int64(over))
		d.rq = d.rq[:copy(d.rq, d.rq[over:])]
	}
	d.rmu.Unlock()
	select {
	case d.wake <- struct{}{}:
	default:
	}
	return nil
}

// Info çalma sayaçları (biçim sabittir: 48 kHz mono 16 bit; sunucunun karışım biçimi sorulmaz).
func (d *pulseDevice) Info() DeviceInfo {
	f := Format{Rate: SampleRate, Channels: 1, Bits: 16}
	return DeviceInfo{Render: f, Capture: f, RenderIsComm: -1, Rendered: d.rendered.Load(),
		RenderDropped: d.renderDropped.Load()}
}

// Close okuma/yazma goroutine'lerine dur der; her biri süren çağrısı (≤ 20 ms) dönünce kendi tutamacını bırakır.
// En çok 400 ms beklenir; sunucu donmuşsa tutamaçlar goroutine'lerle birlikte sonra bırakılır. İkinci çağrı zararsız.
func (d *pulseDevice) Close() error {
	d.closeOnce.Do(func() {
		close(d.closed)
		deadline := time.After(pulseCloseWait)
		for _, ch := range []chan struct{}{d.rdDone, d.wrDone} {
			select {
			case <-ch:
			case <-deadline:
				return
			}
		}
	})
	return nil
}
