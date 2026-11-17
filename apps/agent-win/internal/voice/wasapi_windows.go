//go:build windows

package voice

import (
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// WASAPI paylaşımlı kip, olay güdümlü yakalama/çalma (ADR-0036 m.2). CGO'suz ham COM: capture/com_windows.go ile aynı elle
// vtable kalıbı (yöntem i = vtable[i], ilk argüman nesne). Vtable dizinleri, GUID'ler ve sabitler mingw-w64 10.0.0
// başlıklarından (mmdeviceapi.h, audioclient.h, audiosessiontypes.h) doğrulandı. Donanım testi Windows'ta elle.
// Yaşam döngüsü (D-PD-4): tek LockOSThread goroutine'i CoInitializeEx(MTA) → yakalama + çalma açılır → olay döngüsü →
// aynı iş parçacığında Stop + ters sırada Release (owner) → CoUninitialize. Aygıt adı/kimliği log'a yazılmaz.
// Vtable dizinleri (IUnknown 0..2 sonrası).
const (
	enumGetDefaultAudioEndpoint = 4  // IMMDeviceEnumerator
	devActivate                 = 3  // IMMDevice
	devGetID                    = 5  //
	acInitialize                = 3  // IAudioClient
	acGetBufferSize             = 4  //
	acGetCurrentPadding         = 6  //
	acGetMixFormat              = 8  //
	acStart                     = 10 //
	acStop                      = 11 //
	acSetEventHandle            = 13 //
	acGetService                = 14 //
	ac2SetClientProperties      = 16 // IAudioClient2
	bufGetBuffer                = 3  // IAudioCaptureClient / IAudioRenderClient
	bufReleaseBuffer            = 4  //
	capGetNextPacketSize        = 5  // IAudioCaptureClient
)

const (
	eRender                    = 0
	eCapture                   = 1
	clsctxAll                  = 0x17 // CLSCTX_ALL
	streamFlagsEventCallback   = 0x00040000
	streamFlagsSrcDefaultQual  = 0x08000000
	streamFlagsAutoConvertPCM  = 0x80000000
	bufferFlagsSilent          = 0x2
	audioCategoryCommunication = 3        // AUDIO_STREAM_CATEGORY: Other, ForegroundOnlyMedia, BackgroundCapableMedia, Communications
	bufferDuration100ns        = 40 * 1e4 // 40 ms paylaşımlı tampon (REFERENCE_TIME)
	waveFormatPCM              = 1
	waveFormatFloat            = 3      // WAVE_FORMAT_IEEE_FLOAT
	waveFormatExtensible       = 0xFFFE // WAVE_FORMAT_EXTENSIBLE (SubFormat.Data1 = 1 PCM / 3 float)
	waveFormatExSubFormatOff   = 24     // WAVEFORMATEXTENSIBLE.SubFormat: 18 + Samples(2) + ChannelMask(4)
)

var (
	clsidMMDeviceEnumerator = guid(0xbcde0395, 0xe52f, 0x467c, 0x8e, 0x3d, 0xc4, 0x57, 0x92, 0x91, 0x69, 0x2e)
	iidIMMDeviceEnumerator  = guid(0xa95664d2, 0x9614, 0x4f35, 0xa7, 0x46, 0xde, 0x8d, 0xb6, 0x36, 0x17, 0xe6)
	iidIAudioClient2        = guid(0x726778cd, 0xf60a, 0x4eda, 0x82, 0xde, 0xe4, 0x76, 0x10, 0xcd, 0x78, 0xaa)
	iidIAudioCaptureClient  = guid(0xc8adbd64, 0xe71e, 0x48a0, 0xa4, 0xde, 0x18, 0x5c, 0x39, 0x5c, 0xd3, 0x17)
	iidIAudioRenderClient   = guid(0xf294acfc, 0x3146, 0x4483, 0xa7, 0xbf, 0xad, 0xdc, 0xa7, 0xc2, 0x60, 0xe2)

	pCoCreateInstance = windows.NewLazySystemDLL("ole32.dll").NewProc("CoCreateInstance")
)

// waveFormatEx WAVEFORMATEX (mmreg.h; paketli, 18 bayt — Go düzeni aynı: alanlar doğal hizada).
type waveFormatEx struct {
	FormatTag      uint16
	Channels       uint16
	SamplesPerSec  uint32
	AvgBytesPerSec uint32
	BlockAlign     uint16
	BitsPerSample  uint16
	Size           uint16
}

// audioClientProperties AudioClientProperties (audioclient.h).
type audioClientProperties struct {
	Size      uint32
	IsOffload int32
	Category  uint32
	Options   uint32
}

const (
	waitMs         = 200 // WaitForMultipleObjects zaman aşımı (durdurma ≤ 200 ms içinde görülür)
	stallAfter     = time.Second
	capQueue       = 10                       // yakalama kuyruğu: 200 ms (dolunca en eski çerçeve atılır)
	renderCap      = jitterCap * FrameSamples // çalma kuyruğu üst sınırı: 200 ms
	rpcChangedMode = 0x80010106               // RPC_E_CHANGED_MODE
	devCloseWait   = 400 * time.Millisecond   // Close: COM iş parçacığının bitişini bekleme üst sınırı
)

// errDeviceClosed Close sonrası okuma/yazma.
var errDeviceClosed = errors.New("voice: ses aygıtı kapalı")

// errStalled mikrofon 1 sn boyunca örnek vermedi (errors.Is(err, ErrDevice)).
var errStalled = fmt.Errorf("%w: mikrofon akışı durdu", ErrDevice)

// evHandle owner'a girmiş olay tanıtıcısı.
type evHandle windows.Handle

func (h evHandle) release() { _ = windows.CloseHandle(windows.Handle(h)) }

// stopper başlatılmış istemciyi Release'ten önce durdurur (owner'a Start'tan sonra girer, ters sırada önce çalışır).
type stopper struct{ client *comObj }

func (s stopper) release() { _ = s.client.call(acStop) }

// endpoint bir WASAPI uç noktası (48 kHz mono s16, AUTOCONVERTPCM; yeniden örnekleyici yok). Arayüzlerin sahibi owner'dır.
type endpoint struct {
	dev     *comObj // IMMDevice
	client  *comObj // IAudioClient2
	service *comObj // IAudioCaptureClient veya IAudioRenderClient
	event   windows.Handle
	frames  uint32 // tampon boyu (örnek)
	mix     Format // aygıtın karışım biçimi (tanılama; AUTOCONVERTPCM bizim 48k/1/16'mızı buna çevirir)
}

// openEndpoint varsayılan aygıtı açar: yakalama iletişim varsayılanında (captureRole), çalma varsayılan aygıtta
// (renderRole; roles.go — saha düzeltmesi 1). Edinilen her arayüz/tanıtıcı edinme sırasıyla o'ya girer (hata yolunda
// da çağıran o.releaseAll ile bırakır).
func openEndpoint(o *owner, enum *comObj, render bool) (*endpoint, error) {
	var dev *comObj
	flow, role := uintptr(eCapture), uintptr(captureRole)
	if render {
		flow, role = eRender, renderRole
	}
	if err := enum.call(enumGetDefaultAudioEndpoint, flow, role, uintptr(unsafe.Pointer(&dev))).err("GetDefaultAudioEndpoint"); err != nil {
		return nil, err
	}
	o.add(dev)
	ev, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		return nil, ErrDevice
	}
	o.add(evHandle(ev)) // istemciden önce eklenir: istemci bırakıldıktan sonra kapanır
	e := &endpoint{dev: dev, event: ev}
	if err := dev.call(devActivate, uintptr(unsafe.Pointer(&iidIAudioClient2)), clsctxAll, 0, uintptr(unsafe.Pointer(&e.client))).err("Activate"); err != nil {
		return nil, err
	}
	o.add(e.client)
	e.mix = mixFormat(e.client)
	props := audioClientProperties{Category: audioCategoryCommunication}
	props.Size = uint32(unsafe.Sizeof(props))
	// İletişim kategorisi sürücüde varsa OEM AEC/NS'yi açar; başarısızlık ölümcül değildir (ADR-0036 m.2).
	_ = e.client.call(ac2SetClientProperties, uintptr(unsafe.Pointer(&props)))
	wf := waveFormatEx{FormatTag: waveFormatPCM, Channels: Channels, SamplesPerSec: SampleRate,
		AvgBytesPerSec: SampleRate * Channels * 2, BlockAlign: Channels * 2, BitsPerSample: 16}
	flags := uintptr(streamFlagsEventCallback | streamFlagsAutoConvertPCM | streamFlagsSrcDefaultQual)
	if err := e.client.call(acInitialize, 0 /* AUDCLNT_SHAREMODE_SHARED */, flags, bufferDuration100ns, 0,
		uintptr(unsafe.Pointer(&wf)), 0).err("Initialize"); err != nil {
		return nil, err
	}
	if err := e.client.call(acSetEventHandle, uintptr(ev)).err("SetEventHandle"); err != nil {
		return nil, err
	}
	if err := e.client.call(acGetBufferSize, uintptr(unsafe.Pointer(&e.frames))).err("GetBufferSize"); err != nil {
		return nil, err
	}
	iid := &iidIAudioCaptureClient
	if render {
		iid = &iidIAudioRenderClient
	}
	if err := e.client.call(acGetService, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&e.service))).err("GetService"); err != nil {
		return nil, err
	}
	o.add(e.service)
	return e, nil
}

// mixFormat IAudioClient::GetMixFormat (tanılama; hata → sıfır biçim). Dönen yapı CoTaskMemFree ile bırakılır.
func mixFormat(client *comObj) Format {
	var wf *waveFormatEx
	if client.call(acGetMixFormat, uintptr(unsafe.Pointer(&wf))).err("GetMixFormat") != nil || wf == nil {
		return Format{}
	}
	defer windows.CoTaskMemFree(unsafe.Pointer(wf))
	f := Format{Rate: int(wf.SamplesPerSec), Channels: int(wf.Channels), Bits: int(wf.BitsPerSample),
		Float: wf.FormatTag == waveFormatFloat}
	if wf.FormatTag == waveFormatExtensible && wf.Size >= 22 {
		f.Float = *(*uint32)(unsafe.Add(unsafe.Pointer(wf), waveFormatExSubFormatOff)) == waveFormatFloat
	}
	return f
}

// deviceID IMMDevice::GetId (yalnız karşılaştırma için; kimlik loga/hataya yazılmaz).
func deviceID(dev *comObj) (string, bool) {
	var id *uint16
	if dev.call(devGetID, uintptr(unsafe.Pointer(&id))).err("GetId") != nil || id == nil {
		return "", false
	}
	defer windows.CoTaskMemFree(unsafe.Pointer(id))
	return windows.UTF16PtrToString(id), true
}

// renderIsComm çalma aygıtı iletişim varsayılanıyla aynı mı (1/0; -1 bilinmiyor). Yalnız tanılama: iletişim çalma
// aygıtı yoksa ya da kimlik okunamazsa -1.
func renderIsComm(enum *comObj, spk *endpoint) int {
	var comm *comObj
	if enum.call(enumGetDefaultAudioEndpoint, eRender, roleCommunications, uintptr(unsafe.Pointer(&comm))).err("GetDefaultAudioEndpoint") != nil || comm == nil {
		return -1
	}
	defer comm.release()
	a, ok1 := deviceID(spk.dev)
	b, ok2 := deviceID(comm)
	if !ok1 || !ok2 {
		return -1
	}
	if a == b {
		return 1
	}
	return 0
}

// start akışı başlatır (mikrofon göstergesi yanar); durdurma owner'a girer.
func (e *endpoint) start(o *owner) error {
	if err := e.client.call(acStart).err("Start"); err != nil {
		return err
	}
	o.add(stopper{e.client})
	return nil
}

// read hazır yakalama paketlerini sırayla f'ye verir (sessiz bayraklı paket sıfır örnek olarak gelir). Dilim f dönünce
// geçersizdir.
func (e *endpoint) read(f func(pcm []int16)) error {
	for {
		var n uint32
		if err := e.service.call(capGetNextPacketSize, uintptr(unsafe.Pointer(&n))).err("GetNextPacketSize"); err != nil || n == 0 {
			return err
		}
		var data *int16
		var frames, flags uint32
		if err := e.service.call(bufGetBuffer, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&frames)),
			uintptr(unsafe.Pointer(&flags)), 0, 0).err("GetBuffer"); err != nil {
			return err
		}
		pcm := unsafe.Slice(data, int(frames)*Channels)
		if flags&bufferFlagsSilent != 0 {
			clear(pcm)
		}
		f(pcm)
		if err := e.service.call(bufReleaseBuffer, uintptr(frames)).err("ReleaseBuffer"); err != nil {
			return err
		}
	}
}

// write tamponda yer olduğu kadar örnek yazar; yazılan örnek sayısını döner (kalan bir sonraki olayda yazılır).
func (e *endpoint) write(pcm []int16) (int, error) {
	var pad uint32
	if err := e.client.call(acGetCurrentPadding, uintptr(unsafe.Pointer(&pad))).err("GetCurrentPadding"); err != nil {
		return 0, err
	}
	n := min(uint32(len(pcm)/Channels), e.frames-pad)
	if n == 0 {
		return 0, nil
	}
	var data *int16
	if err := e.service.call(bufGetBuffer, uintptr(n), uintptr(unsafe.Pointer(&data))).err("GetBuffer"); err != nil {
		return 0, err
	}
	copy(unsafe.Slice(data, int(n)*Channels), pcm)
	return int(n), e.service.call(bufReleaseBuffer, uintptr(n), 0).err("ReleaseBuffer")
}

// wasapiDevice Device'ın Windows gerçeklemesi. COM yalnız kendi kilitli iş parçacığında (thread) kullanılır; diğer
// goroutine'ler kanallar ve kilitli çalma kuyruğu üzerinden konuşur.
type wasapiDevice struct {
	stopEv    windows.Handle
	capCh     chan []int16
	done      chan struct{}
	err       error // thread'in çıkış hatası; done kapanmadan yazılır
	closeOnce sync.Once
	closed    chan struct{}

	rmu sync.Mutex
	rq  []int16

	info          DeviceInfo // açılışta (thread) yazılır, ready'den sonra salt okunur; sayaçlar aşağıda
	rendered      atomic.Int64
	renderDropped atomic.Int64
}

// Info aygıt biçimi + çalma sayaçları (tanılama; Close'dan sonra da geçerli).
func (d *wasapiDevice) Info() DeviceInfo {
	i := d.info
	i.Rendered, i.RenderDropped = d.rendered.Load(), d.renderDropped.Load()
	return i
}

// OpenWASAPI varsayılan iletişim mikrofonunu ve varsayılan hoparlörü (roles.go) açıp başlatır. Hata HRError'dur (errors.Is ile
// ErrDeviceDenied / ErrDeviceNotFound / ErrDeviceLost / ErrDevice).
func OpenWASAPI() (Device, error) {
	stopEv, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return nil, ErrDevice
	}
	d := &wasapiDevice{stopEv: stopEv, capCh: make(chan []int16, capQueue), done: make(chan struct{}),
		closed: make(chan struct{})}
	ready := make(chan error, 1)
	go d.thread(ready)
	if err := <-ready; err != nil {
		<-d.done
		_ = windows.CloseHandle(stopEv)
		return nil, err
	}
	return d, nil
}

// thread COM iş parçacığı: aç → hazır bildir → olay döngüsü → aynı iş parçacığında bırak (panic dahil defer).
func (d *wasapiDevice) thread(ready chan<- error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	var o owner
	var err error
	signalled, uninit := false, false
	defer func() {
		if recover() != nil {
			err = ErrDevice
		}
		o.releaseAll() // ters sıra: çalmayı durdur … numaralandırıcı
		if uninit {
			windows.CoUninitialize() // Release'lerden sonra
		}
		d.err = err
		close(d.done)
		if !signalled {
			ready <- err
		}
	}()
	switch cerr := windows.CoInitializeEx(0, windows.COINIT_MULTITHREADED); {
	case cerr == nil || errors.Is(cerr, syscall.Errno(1)): // S_FALSE: zaten MTA, yine dengelenir
		uninit = true
	case errors.Is(cerr, syscall.Errno(rpcChangedMode)): // başka kod STA açmış; tek iş parçacığından kullanım geçerli
	default:
		var en syscall.Errno
		hr := uint32(0)
		if errors.As(cerr, &en) {
			hr = uint32(en)
		}
		err = &HRError{Op: "CoInitializeEx", HR: hr}
		return
	}
	var mic, spk *endpoint
	if mic, spk, err = d.open(&o); err != nil {
		return
	}
	signalled = true
	ready <- nil
	err = d.loop(mic, spk)
}

func (d *wasapiDevice) open(o *owner) (mic, spk *endpoint, err error) {
	var enum *comObj
	r, _, _ := pCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidMMDeviceEnumerator)), 0, clsctxAll,
		uintptr(unsafe.Pointer(&iidIMMDeviceEnumerator)), uintptr(unsafe.Pointer(&enum)))
	if err = hresult(int32(uint32(r))).err("CoCreateInstance"); err != nil {
		return nil, nil, err
	}
	o.add(enum)
	if mic, err = openEndpoint(o, enum, false); err != nil {
		return nil, nil, err
	}
	if spk, err = openEndpoint(o, enum, true); err != nil {
		return nil, nil, err
	}
	d.info = DeviceInfo{Render: spk.mix, Capture: mic.mix, RenderIsComm: renderIsComm(enum, spk)}
	if err = mic.start(o); err != nil {
		return nil, nil, err
	}
	if err = spk.start(o); err != nil {
		return nil, nil, err
	}
	return mic, spk, nil
}

// loop yakalama/çalma olaylarını ve durdurma olayını bekler. Yakalama paketleri 960 örneklik çerçevelere biriktirilir.
func (d *wasapiDevice) loop(mic, spk *endpoint) error {
	handles := []windows.Handle{mic.event, spk.event, d.stopEv}
	acc := make([]int16, 0, FrameSamples)
	lastCap := time.Now()
	collect := func(pcm []int16) {
		for len(pcm) > 0 {
			n := min(len(pcm), FrameSamples-len(acc))
			acc = append(acc, pcm[:n]...)
			pcm = pcm[n:]
			if len(acc) == FrameSamples {
				d.deliver(acc)
				acc = make([]int16, 0, FrameSamples)
			}
		}
	}
	for {
		ev, err := windows.WaitForMultipleObjects(handles, false, waitMs)
		if err != nil {
			return ErrDevice
		}
		switch ev {
		case windows.WAIT_OBJECT_0:
			lastCap = time.Now()
			if err := mic.read(collect); err != nil {
				return err
			}
		case windows.WAIT_OBJECT_0 + 1:
			if err := d.render(spk); err != nil {
				return err
			}
		case windows.WAIT_OBJECT_0 + 2:
			return nil
		}
		// Her uyanışta: hoparlör olayları sürerken mikrofon olayı kesilmiş olabilir (ayrı USB mikrofon çıkarıldı). Önce
		// yakalama sorgulanır (gerçek HRESULT, ör. AUDCLNT_E_DEVICE_INVALIDATED, oradan gelir); örnek yoksa durmuş akış.
		if time.Since(lastCap) > stallAfter {
			got := false
			if err := mic.read(func(pcm []int16) { got = true; collect(pcm) }); err != nil {
				return err
			}
			if !got {
				return errStalled
			}
			lastCap = time.Now()
		}
	}
}

// deliver çerçeveyi okuyucuya verir; kuyruk doluysa en eskisini atar (okuyucu takılırsa gecikme birikmez).
func (d *wasapiDevice) deliver(f []int16) {
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

func (d *wasapiDevice) render(spk *endpoint) error {
	d.rmu.Lock()
	defer d.rmu.Unlock()
	if len(d.rq) == 0 {
		return nil
	}
	n, err := spk.write(d.rq)
	d.rendered.Add(int64(n))
	d.rq = d.rq[:copy(d.rq, d.rq[n:])]
	return err
}

func (d *wasapiDevice) exitErr() error {
	select {
	case <-d.closed:
		return errDeviceClosed
	default:
	}
	if d.err != nil {
		return d.err
	}
	return errDeviceClosed
}

// ReadFrame bir sonraki 960 örneklik mikrofon çerçevesini bekler.
func (d *wasapiDevice) ReadFrame(pcm []int16) error {
	select {
	case f := <-d.capCh:
		copy(pcm, f)
		return nil
	case <-d.done:
		return d.exitErr()
	}
}

// WriteFrame çerçeveyi çalma kuyruğuna ekler (200 ms'yi aşarsa en eski örnekler atılır).
func (d *wasapiDevice) WriteFrame(pcm []int16) error {
	select {
	case <-d.done:
		return d.exitErr()
	default:
	}
	d.rmu.Lock()
	defer d.rmu.Unlock()
	d.rq = append(d.rq, pcm...)
	if over := len(d.rq) - renderCap; over > 0 {
		d.renderDropped.Add(int64(over))
		d.rq = d.rq[:copy(d.rq, d.rq[over:])]
	}
	return nil
}

// Close durdurma olayını işaretler ve COM iş parçacığının durdurup bırakmasını en çok 400 ms bekler (mikrofon göstergesi
// söner). İkinci çağrı zararsızdır.
func (d *wasapiDevice) Close() error {
	d.closeOnce.Do(func() {
		close(d.closed)
		_ = windows.SetEvent(d.stopEv)
		select {
		case <-d.done:
			_ = windows.CloseHandle(d.stopEv) // iş parçacığı bitti; tanıtıcı artık beklenmiyor
		case <-time.After(devCloseWait):
			// İş parçacığı bir COM çağrısında takılı: tanıtıcı açık bırakılır (kullanımdayken kapatılmaz).
		}
	})
	return nil
}
