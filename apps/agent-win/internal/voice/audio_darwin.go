//go:build darwin

package voice

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/darwin/objc"
)

// AudioQueue ile mikrofon + hoparlör (mimari-p33 K-P33-2, K0s-6): 48 kHz mono s16, 20 ms × 3 tampon, giriş ve çıkış
// ayrı kuyruk; kuyruklar AudioQueue'nun kendi iş parçacığında geri çağırır (run loop yok). Geri çağrılar süreçte bir
// kez kurulur (FFI kuralı 2); C'ye bağlam olarak yalnız tamsayı tutamaç gider. Tamponlar AudioQueue'nun belleğidir.
// Close = AudioQueueStop(immediate) + AudioQueueDispose(immediate), önce giriş (mikrofon ≤ 1 sn içinde bırakılır,
// AC-535). Aygıt adı/kimliği hiçbir hataya girmez. Mikrofon izni burada istenmez (macperm, deps_darwin openVoice).

const (
	aqBuffers      = 3
	aqBufBytes     = FrameSamples * 2
	stallAfter     = time.Second              // 1 sn mikrofon örneği yoksa aygıt kayboldu (mimari-p33 §6.5)
	firstFrameWait = 3 * time.Second          // ilk çerçeve: aygıtın uyanması
	capQueue       = 10                       // yakalama kuyruğu: 200 ms
	renderCap      = jitterCap * FrameSamples // çalma kuyruğu üst sınırı: 200 ms

	kAudioHardwareBadDeviceError = 0x21646576 // '!dev'
)

var errDeviceClosed = errors.New("voice: ses aygıtı kapalı")

// errStalled mikrofon 1 sn boyunca örnek vermedi (errors.Is(err, ErrDeviceLost)).
var errStalled = fmt.Errorf("%w: mikrofon akışı durdu", ErrDeviceLost)

// AQError AudioQueue hatası; yalnız adım ve OSStatus.
type AQError struct {
	Op     string
	Status int32
}

func (e *AQError) Error() string { return fmt.Sprintf("voice: %s OSStatus %d", e.Op, e.Status) }

// Unwrap aygıt hatası sınıfı.
func (e *AQError) Unwrap() error {
	if uint32(e.Status) == kAudioHardwareBadDeviceError {
		return ErrDeviceNotFound
	}
	return ErrDevice
}

var (
	aqOnce sync.Once
	aqErr  error

	aqNewInput  func(f *asbd, cb, user, runLoop, mode uintptr, flags uint32, q *uintptr) int32
	aqNewOutput func(f *asbd, cb, user, runLoop, mode uintptr, flags uint32, q *uintptr) int32
	aqAlloc     func(q uintptr, size uint32, buf *uintptr) int32
	aqEnqueue   func(q, buf uintptr, n uint32, desc uintptr) int32
	aqStart     func(q, at uintptr) int32
	aqStop      func(q uintptr, immediate bool) int32
	aqDispose   func(q uintptr, immediate bool) int32

	aqInCB, aqOutCB uintptr
	aqDevs          sync.Map // tutamaç → *aqDevice
	aqNextID        atomic.Uintptr
)

func bindAQ() error {
	aqOnce.Do(func() {
		if err := bindAT(); err != nil {
			aqErr = err
			return
		}
		h, err := objc.Framework("AudioToolbox")
		if err != nil {
			aqErr = err
			return
		}
		aqErr = errors.Join(objc.Func(&aqNewInput, h, "AudioQueueNewInput"), objc.Func(&aqNewOutput, h, "AudioQueueNewOutput"),
			objc.Func(&aqAlloc, h, "AudioQueueAllocateBuffer"), objc.Func(&aqEnqueue, h, "AudioQueueEnqueueBuffer"),
			objc.Func(&aqStart, h, "AudioQueueStart"), objc.Func(&aqStop, h, "AudioQueueStop"),
			objc.Func(&aqDispose, h, "AudioQueueDispose"))
		if aqErr != nil {
			return
		}
		aqInCB = purego.NewCallback(func(user, q, buf, _ uintptr, _ uint32, _ uintptr) { aqInput(user, q, buf) })
		aqOutCB = purego.NewCallback(func(user, q, buf uintptr) { aqOutput(user, q, buf) })
	})
	return aqErr
}

// aqBuffer AudioQueueBuffer'ın kullanılan alanları (mAudioDataBytesCapacity, mAudioData, mAudioDataByteSize).
type aqBuffer struct {
	capacity uint32
	_        uint32
	data     uintptr
	size     uint32
}

func aqBuf(p uintptr) *aqBuffer { return (*aqBuffer)(cptr(p)) }

// aqDevice Device uygulaması.
type aqDevice struct {
	id      uintptr
	in, out uintptr
	capCh   chan []int16
	closed  chan struct{}
	isShut  atomic.Bool
	started atomic.Bool
	rmu     sync.Mutex
	rq      []int16
	once    sync.Once
}

func aqInput(user, q, buf uintptr) {
	v, ok := aqDevs.Load(user)
	if !ok {
		return
	}
	d := v.(*aqDevice)
	if d.isShut.Load() {
		return
	}
	b := aqBuf(buf)
	n := min(int(b.size)/2, FrameSamples)
	if n > 0 {
		f := make([]int16, FrameSamples)
		copy(f, unsafe.Slice((*int16)(cptr(b.data)), n))
		d.deliver(f)
	}
	aqEnqueue(q, buf, 0, 0)
}

// deliver kuyruk doluysa en eskiyi atar (okuyucu takılırsa gecikme birikmez).
func (d *aqDevice) deliver(f []int16) {
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

func aqOutput(user, q, buf uintptr) {
	v, ok := aqDevs.Load(user)
	if !ok {
		return
	}
	d := v.(*aqDevice)
	if d.isShut.Load() {
		return
	}
	d.fill(buf)
	aqEnqueue(q, buf, 0, 0)
}

// fill çalma tamponunu kuyruktan doldurur (eksik kısım sessizlik).
func (d *aqDevice) fill(buf uintptr) {
	b := aqBuf(buf)
	dst := unsafe.Slice((*int16)(cptr(b.data)), FrameSamples)
	d.rmu.Lock()
	n := copy(dst, d.rq)
	d.rq = d.rq[:copy(d.rq, d.rq[n:])]
	d.rmu.Unlock()
	clear(dst[n:])
	b.size = aqBufBytes
}

// OpenAudioQueue varsayılan mikrofonu ve hoparlörü açar (hata AQError: errors.Is ile ErrDeviceNotFound / ErrDevice).
func OpenAudioQueue() (Device, error) {
	if err := bindAQ(); err != nil {
		return nil, ErrDeviceNotFound
	}
	d := &aqDevice{id: aqNextID.Add(1), capCh: make(chan []int16, capQueue), closed: make(chan struct{})}
	aqDevs.Store(d.id, d)
	f := lpcmMono()
	if st := aqNewInput(&f, aqInCB, d.id, 0, 0, 0, &d.in); st != 0 {
		d.dispose()
		return nil, &AQError{Op: "AudioQueueNewInput", Status: st}
	}
	if st := aqNewOutput(&f, aqOutCB, d.id, 0, 0, 0, &d.out); st != 0 {
		d.dispose()
		return nil, &AQError{Op: "AudioQueueNewOutput", Status: st}
	}
	for range aqBuffers {
		for _, q := range []uintptr{d.in, d.out} {
			var buf uintptr
			if st := aqAlloc(q, aqBufBytes, &buf); st != 0 {
				d.dispose()
				return nil, &AQError{Op: "AudioQueueAllocateBuffer", Status: st}
			}
			if q == d.out {
				d.fill(buf) // sessizlikle ön doldurma
			}
			if st := aqEnqueue(q, buf, 0, 0); st != 0 {
				d.dispose()
				return nil, &AQError{Op: "AudioQueueEnqueueBuffer", Status: st}
			}
		}
	}
	if st := aqStart(d.out, 0); st != 0 {
		d.dispose()
		return nil, &AQError{Op: "AudioQueueStart(çıkış)", Status: st}
	}
	if st := aqStart(d.in, 0); st != 0 {
		d.dispose()
		return nil, &AQError{Op: "AudioQueueStart(giriş)", Status: st}
	}
	return d, nil
}

// dispose kuyrukları durdurup bırakır (önce giriş: mikrofon göstergesi hemen söner).
func (d *aqDevice) dispose() {
	d.isShut.Store(true)
	for _, q := range []*uintptr{&d.in, &d.out} {
		if *q != 0 {
			aqStop(*q, true)
			aqDispose(*q, true)
			*q = 0
		}
	}
	aqDevs.Delete(d.id)
}

// ReadFrame bir sonraki mikrofon çerçevesini bekler; 1 sn (ilk çerçevede 3 sn) örnek gelmezse errStalled.
func (d *aqDevice) ReadFrame(pcm []int16) error {
	if d.isShut.Load() {
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
	case <-d.closed:
		return errDeviceClosed
	case <-t.C:
		return errStalled
	}
}

// WriteFrame çerçeveyi çalma kuyruğuna ekler; bloklamaz (200 ms'yi aşarsa en eski örnekler atılır).
func (d *aqDevice) WriteFrame(pcm []int16) error {
	if d.isShut.Load() {
		return errDeviceClosed
	}
	d.rmu.Lock()
	d.rq = append(d.rq, pcm...)
	if over := len(d.rq) - renderCap; over > 0 {
		d.rq = d.rq[:copy(d.rq, d.rq[over:])]
	}
	d.rmu.Unlock()
	return nil
}

// Close kuyrukları hemen durdurur ve bırakır; bloklu ReadFrame çözülür. İkinci çağrı zararsızdır.
func (d *aqDevice) Close() error {
	d.once.Do(func() {
		close(d.closed)
		d.dispose()
	})
	return nil
}
