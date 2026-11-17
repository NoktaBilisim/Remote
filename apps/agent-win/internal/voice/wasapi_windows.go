//go:build windows

package voice

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// WASAPI paylaşımlı kip, olay güdümlü yakalama/çalma (ADR-0036 m.2). CGO'suz ham COM: capture/com_windows.go ile aynı elle
// vtable kalıbı (yöntem i = vtable[i], ilk argüman nesne). Vtable dizinleri, GUID'ler ve sabitler mingw-w64 10.0.0
// başlıklarından (mmdeviceapi.h, audioclient.h, audiosessiontypes.h) doğrulandı. K0s iskeleti: donanım testi Windows'ta elle.
// Çağıran COM'u bu iş parçacığında başlatır: runtime.LockOSThread + windows.CoInitializeEx(0, COINIT_MULTITHREADED).
// Vtable dizinleri (IUnknown 0..2 sonrası).
const (
	enumGetDefaultAudioEndpoint = 4  // IMMDeviceEnumerator
	devActivate                 = 3  // IMMDevice
	acInitialize                = 3  // IAudioClient
	acGetBufferSize             = 4  //
	acGetCurrentPadding         = 6  //
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
	eCommunications            = 2
	clsctxAll                  = 0x17 // CLSCTX_ALL
	streamFlagsEventCallback   = 0x00040000
	streamFlagsSrcDefaultQual  = 0x08000000
	streamFlagsAutoConvertPCM  = 0x80000000
	bufferFlagsSilent          = 0x2
	audioCategoryCommunication = 3        // AUDIO_STREAM_CATEGORY: Other, ForegroundOnlyMedia, BackgroundCapableMedia, Communications
	bufferDuration100ns        = 40 * 1e4 // 40 ms paylaşımlı tampon (REFERENCE_TIME)
	waveFormatPCM              = 1
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

// Stream bir WASAPI uç noktasıdır: 48 kHz mono s16, AUTOCONVERTPCM ile (yeniden örnekleyici yok).
type Stream struct {
	client  *comObj // IAudioClient2
	service *comObj // IAudioCaptureClient veya IAudioRenderClient
	event   windows.Handle
	frames  uint32 // tampon boyu (örnek)
	render  bool
}

// OpenCapture varsayılan iletişim mikrofonunu açar.
func OpenCapture() (*Stream, error) { return open(false) }

// OpenRender varsayılan iletişim hoparlörünü açar.
func OpenRender() (*Stream, error) { return open(true) }

func open(render bool) (*Stream, error) {
	var enum, dev *comObj
	r, _, _ := pCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidMMDeviceEnumerator)), 0, clsctxAll,
		uintptr(unsafe.Pointer(&iidIMMDeviceEnumerator)), uintptr(unsafe.Pointer(&enum)))
	if err := hresult(int32(uint32(r))).err("CoCreateInstance"); err != nil {
		return nil, err
	}
	defer enum.release()
	flow := uintptr(eCapture)
	if render {
		flow = eRender
	}
	if err := enum.call(enumGetDefaultAudioEndpoint, flow, eCommunications, uintptr(unsafe.Pointer(&dev))).err("GetDefaultAudioEndpoint"); err != nil {
		return nil, err
	}
	defer dev.release()
	s := &Stream{render: render}
	ok := false
	defer func() {
		if !ok {
			s.Close() // hata yolunda istemci/olay sızmaz
		}
	}()
	if err := dev.call(devActivate, uintptr(unsafe.Pointer(&iidIAudioClient2)), clsctxAll, 0, uintptr(unsafe.Pointer(&s.client))).err("Activate"); err != nil {
		return nil, err
	}
	props := audioClientProperties{Category: audioCategoryCommunication}
	props.Size = uint32(unsafe.Sizeof(props))
	// İletişim kategorisi sürücüde varsa OEM AEC/NS'yi açar; başarısızlık ölümcül değildir (ADR-0036 m.2).
	_ = s.client.call(ac2SetClientProperties, uintptr(unsafe.Pointer(&props)))
	wf := waveFormatEx{FormatTag: waveFormatPCM, Channels: Channels, SamplesPerSec: SampleRate,
		AvgBytesPerSec: SampleRate * Channels * 2, BlockAlign: Channels * 2, BitsPerSample: 16}
	flags := uintptr(streamFlagsEventCallback | streamFlagsAutoConvertPCM | streamFlagsSrcDefaultQual)
	if err := s.client.call(acInitialize, 0 /* AUDCLNT_SHAREMODE_SHARED */, flags, bufferDuration100ns, 0,
		uintptr(unsafe.Pointer(&wf)), 0).err("Initialize"); err != nil {
		return nil, err
	}
	ev, err := windows.CreateEvent(nil, 0, 0, nil)
	if err != nil {
		return nil, errors.New("voice: CreateEvent")
	}
	s.event = ev
	if err := s.client.call(acSetEventHandle, uintptr(s.event)).err("SetEventHandle"); err != nil {
		return nil, err
	}
	if err := s.client.call(acGetBufferSize, uintptr(unsafe.Pointer(&s.frames))).err("GetBufferSize"); err != nil {
		return nil, err
	}
	iid := &iidIAudioCaptureClient
	if render {
		iid = &iidIAudioRenderClient
	}
	if err := s.client.call(acGetService, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&s.service))).err("GetService"); err != nil {
		return nil, err
	}
	ok = true
	return s, nil
}

// Start akışı başlatır (mikrofon göstergesi yanar).
func (s *Stream) Start() error { return s.client.call(acStart).err("Start") }

// Wait bir sonraki tampon olayını en çok ms milisaniye bekler; zaman aşımında false.
func (s *Stream) Wait(ms uint32) bool {
	ev, _ := windows.WaitForSingleObject(s.event, ms)
	return ev == windows.WAIT_OBJECT_0
}

// Read hazır yakalama paketlerini sırayla f'ye verir (sessiz bayraklı paket sıfır örnek olarak gelir). Dilim f dönünce
// geçersizdir.
func (s *Stream) Read(f func(pcm []int16)) error {
	for {
		var n uint32
		if err := s.service.call(capGetNextPacketSize, uintptr(unsafe.Pointer(&n))).err("GetNextPacketSize"); err != nil || n == 0 {
			return err
		}
		var data *int16
		var frames, flags uint32
		if err := s.service.call(bufGetBuffer, uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&frames)),
			uintptr(unsafe.Pointer(&flags)), 0, 0).err("GetBuffer"); err != nil {
			return err
		}
		pcm := unsafe.Slice(data, int(frames)*Channels)
		if flags&bufferFlagsSilent != 0 {
			clear(pcm)
		}
		f(pcm)
		if err := s.service.call(bufReleaseBuffer, uintptr(frames)).err("ReleaseBuffer"); err != nil {
			return err
		}
	}
}

// Write tamponda yer olduğu kadar örnek yazar; yazılan örnek sayısını döner (kalan bir sonraki olayda yazılır).
func (s *Stream) Write(pcm []int16) (int, error) {
	var pad uint32
	if err := s.client.call(acGetCurrentPadding, uintptr(unsafe.Pointer(&pad))).err("GetCurrentPadding"); err != nil {
		return 0, err
	}
	n := min(uint32(len(pcm)/Channels), s.frames-pad)
	if n == 0 {
		return 0, nil
	}
	var data *int16
	if err := s.service.call(bufGetBuffer, uintptr(n), uintptr(unsafe.Pointer(&data))).err("GetBuffer"); err != nil {
		return 0, err
	}
	copy(unsafe.Slice(data, int(n)*Channels), pcm)
	return int(n), s.service.call(bufReleaseBuffer, uintptr(n), 0).err("ReleaseBuffer")
}

// Close akışı durdurur ve tüm arayüzleri bırakır (AC-374: mikrofon göstergesi ≤ 1 sn söner). İkinci çağrı zararsızdır.
func (s *Stream) Close() {
	if s.client != nil {
		_ = s.client.call(acStop)
	}
	s.service.release()
	s.client.release()
	s.service, s.client = nil, nil
	if s.event != 0 {
		_ = windows.CloseHandle(s.event)
		s.event = 0
	}
}
