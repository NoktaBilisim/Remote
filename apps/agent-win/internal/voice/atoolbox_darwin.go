//go:build darwin

package voice

import (
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/darwin/objc"
)

// AudioToolbox AudioConverter ile Opus (K-P33-1, K0s-A1; spike test/spike-p33/at). purego, cgo yok. Giriş geri çağrısı
// süreçte bir kez kurulur; C'ye bağlam olarak yalnız tamsayı tutamaç verilir; C'nin geri çağrı sonrasında okuduğu
// tamponlar (PCM, paket, paket tanımı, AudioBufferList) malloc belleğidir (Go işaretçisi C'de tutulmaz). Bağlama hatası
// süreci sonlandırmaz: errATUnavailable → Supported() = false.

const (
	fmtOpus = 0x6f707573 // 'opus'
	fmtLPCM = 0x6c70636d // 'lpcm'

	atPropPrime   = 0x7072696d // 'prim' kAudioConverterPrimeInfo
	atPropBitRate = 0x62726174 // 'brat' kAudioConverterEncodeBitRate
	atStatusNoDat = 0x6e6f6474 // 'nodt' geri çağrının "şimdilik veri yok" kodu (kendi seçimimiz)

	asbdSize = 40
	ablSize  = 24 // AudioBufferList: mNumberBuffers(4) + dolgu(4) + AudioBuffer{ch(4), size(4), data(8)}
	aspdSize = 16 // AudioStreamPacketDescription
)

var errATUnavailable = errors.New("voice: AudioToolbox Opus kullanılamıyor")

// asbd AudioStreamBasicDescription.
type asbd struct {
	SampleRate     float64
	FormatID       uint32
	FormatFlags    uint32
	BytesPerPacket uint32
	FramesPerPkt   uint32
	BytesPerFrame  uint32
	Channels       uint32
	BitsPerChannel uint32
	Reserved       uint32
}

// lpcmMono 48 kHz s16 mono paketli (kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked).
func lpcmMono() asbd {
	return asbd{SampleRate: SampleRate, FormatID: fmtLPCM, FormatFlags: 0x4 | 0x8, BytesPerPacket: 2, FramesPerPkt: 1,
		BytesPerFrame: 2, Channels: 1, BitsPerChannel: 16}
}

// opusMono Opus 48 kHz mono, 960 çerçeve/paket (V-P33-A1 / B2: değişken kip PLC'yi bozar).
func opusMono() asbd {
	return asbd{SampleRate: SampleRate, FormatID: fmtOpus, FramesPerPkt: FrameSamples, Channels: 1}
}

var (
	atOnce sync.Once
	atErr  error

	atNew     func(in, out *asbd, conv *uintptr) int32
	atDispose func(conv uintptr) int32
	atReset   func(conv uintptr) int32
	atSet     func(conv uintptr, id, size uint32, data unsafe.Pointer) int32
	atGet     func(conv uintptr, id uint32, size *uint32, data unsafe.Pointer) int32
	atFill    func(conv, proc, user uintptr, n *uint32, abl, desc uintptr) int32
	cMalloc   func(n uintptr) uintptr
	cFree     func(p uintptr)

	atInputProc uintptr
	atFeeds     sync.Map // tutamaç → *atFeed
	atNextMu    sync.Mutex
	atNextID    uintptr
)

// bindAT AudioToolbox ve malloc/free'yi bağlar, giriş geri çağrısını bir kez kurar (FFI kuralı 2).
func bindAT() error {
	atOnce.Do(func() {
		h, err := objc.Framework("AudioToolbox")
		if err != nil {
			atErr = errors.Join(errATUnavailable, err)
			return
		}
		sys, err := objc.Open(objc.LibSystem)
		if err != nil {
			atErr = errors.Join(errATUnavailable, err)
			return
		}
		if err := errors.Join(objc.Func(&atNew, h, "AudioConverterNew"), objc.Func(&atDispose, h, "AudioConverterDispose"),
			objc.Func(&atReset, h, "AudioConverterReset"), objc.Func(&atSet, h, "AudioConverterSetProperty"),
			objc.Func(&atGet, h, "AudioConverterGetProperty"), objc.Func(&atFill, h, "AudioConverterFillComplexBuffer"),
			objc.Func(&cMalloc, sys, "malloc"), objc.Func(&cFree, sys, "free")); err != nil {
			atErr = errors.Join(errATUnavailable, err)
			return
		}
		atInputProc = purego.NewCallback(atInput)
	})
	return atErr
}

// cmem C yığınında ayrılmış bellek.
type cmem struct {
	p uintptr
	n int
}

func cAlloc(n int) (cmem, error) {
	p := cMalloc(uintptr(n))
	if p == 0 {
		return cmem{}, errors.New("voice: malloc")
	}
	m := cmem{p: p, n: n}
	clear(m.bytes())
	return m, nil
}

// bytes C belleğinin Go görünümü (yalnız yaşam süresi boyunca; GC taşımaz).
func (m cmem) bytes() []byte { return unsafe.Slice((*byte)(cptr(m.p)), m.n) }

func (m *cmem) free() {
	if m.p != 0 {
		cFree(m.p)
		m.p = 0
	}
}

// cptr C belleği adresi → unsafe.Pointer (Go yığını değildir; vet'in uintptr uyarısını önleyen kalıp).
func cptr(p uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&p)) }

// atFeed bir çeviricinin bekleyen girişi.
type atFeed struct {
	data, desc cmem
	n, packets uint32
	isPacket   bool
	pending    bool
}

// atInput AudioConverterComplexInputDataProc: bekleyen girişi bir kez verir, sonra 'nodt'.
func atInput(_ uintptr, ioNum uintptr, ioData uintptr, outDesc uintptr, user uintptr) int32 {
	num := (*uint32)(cptr(ioNum))
	abl := unsafe.Slice((*byte)(cptr(ioData)), ablSize)
	v, ok := atFeeds.Load(user)
	if !ok || !v.(*atFeed).pending {
		*num = 0
		binary.LittleEndian.PutUint32(abl[12:], 0)
		binary.LittleEndian.PutUint64(abl[16:], 0)
		return atStatusNoDat
	}
	f := v.(*atFeed)
	f.pending = false
	binary.LittleEndian.PutUint32(abl[0:], 1)
	binary.LittleEndian.PutUint32(abl[8:], 1)
	binary.LittleEndian.PutUint32(abl[12:], f.n)
	binary.LittleEndian.PutUint64(abl[16:], uint64(f.data.p))
	*num = f.packets
	if f.isPacket && outDesc != 0 {
		d := f.desc.bytes()
		binary.LittleEndian.PutUint64(d[0:], 0)
		binary.LittleEndian.PutUint32(d[8:], 0)
		binary.LittleEndian.PutUint32(d[12:], f.n)
		*(*uintptr)(cptr(outDesc)) = f.desc.p
	}
	return 0
}

// osStatus AudioToolbox hata kodu (yalnız sayı; içerik yok).
type osStatus int32

func (e osStatus) Error() string { return fmt.Sprintf("voice: AudioToolbox OSStatus %d", int32(e)) }

// atConv bir AudioConverter + C tamponları. Eşzamanlı kullanım güvenli değildir.
type atConv struct {
	ref           uintptr
	id            uintptr
	f             *atFeed
	out, abl, odc cmem
	outFmtLPCM    bool
}

func newATConv(in, out asbd, dataCap, outCap int, isPacket bool) (*atConv, error) {
	if err := bindAT(); err != nil {
		return nil, err
	}
	var ref uintptr
	if st := atNew(&in, &out, &ref); st != 0 {
		return nil, osStatus(st)
	}
	c := &atConv{ref: ref, f: &atFeed{isPacket: isPacket}, outFmtLPCM: out.FormatID == fmtLPCM}
	var err error
	for _, m := range []struct {
		p *cmem
		n int
	}{{&c.f.data, dataCap}, {&c.f.desc, aspdSize}, {&c.out, outCap}, {&c.abl, ablSize}, {&c.odc, aspdSize}} {
		if *m.p, err = cAlloc(m.n); err != nil {
			c.close()
			return nil, err
		}
	}
	atNextMu.Lock()
	atNextID++
	c.id = atNextID
	atNextMu.Unlock()
	atFeeds.Store(c.id, c.f)
	return c, nil
}

func (c *atConv) close() {
	if c.ref != 0 {
		atDispose(c.ref)
		c.ref = 0
	}
	atFeeds.Delete(c.id)
	for _, m := range []*cmem{&c.f.data, &c.f.desc, &c.out, &c.abl, &c.odc} {
		m.free()
	}
}

func (c *atConv) reset() error {
	if st := atReset(c.ref); st != 0 {
		return osStatus(st)
	}
	return nil
}

func (c *atConv) setU32(id, v uint32) error {
	if st := atSet(c.ref, id, 4, unsafe.Pointer(&v)); st != 0 {
		return osStatus(st)
	}
	return nil
}

// fill bir FillComplexBuffer çağrısı (çıktı kapasitesi capPackets paket / outBytes bayt).
func (c *atConv) fill(capPackets uint32, outBytes int) (uint32, int32) {
	abl := c.abl.bytes()
	binary.LittleEndian.PutUint32(abl[0:], 1)
	binary.LittleEndian.PutUint32(abl[8:], 1)
	binary.LittleEndian.PutUint32(abl[12:], uint32(outBytes))
	binary.LittleEndian.PutUint64(abl[16:], uint64(c.out.p))
	n := capPackets
	var desc uintptr
	if !c.outFmtLPCM {
		desc = c.odc.p
	}
	st := atFill(c.ref, atInputProc, c.id, &n, c.abl.p, desc)
	return n, st
}

// atEncoder PCM s16 mono 48 kHz → Opus 20 ms (32 kbit/s).
type atEncoder struct {
	c   *atConv
	buf []byte
}

func newATEncoder() (*atEncoder, error) {
	c, err := newATConv(lpcmMono(), opusMono(), FrameSamples*2, 4096, false)
	if err != nil {
		return nil, err
	}
	if err := c.setU32(atPropBitRate, targetBitrate); err != nil {
		c.close()
		return nil, err
	}
	return &atEncoder{c: c, buf: make([]byte, maxPacketSize)}, nil
}

// encode 960 örneği verir; tam bir paket döner (dilim sonraki çağrıya kadar geçerli).
func (e *atEncoder) encode(pcm []int16) ([]byte, error) {
	d := e.c.f.data.bytes()
	for i, s := range pcm {
		binary.LittleEndian.PutUint16(d[2*i:], uint16(s))
	}
	e.c.f.n, e.c.f.packets, e.c.f.pending = FrameSamples*2, FrameSamples, true
	var pkt []byte
	for range 4 { // K0s-A1: her çerçeve tam 1 paket; döngü 'nodt' ile biter
		n, st := e.c.fill(1, e.c.out.n)
		if n > 0 {
			dsc := e.c.odc.bytes()
			off, sz := binary.LittleEndian.Uint64(dsc[0:]), binary.LittleEndian.Uint32(dsc[12:])
			if off+uint64(sz) > uint64(e.c.out.n) || sz > maxPacketSize {
				return nil, errors.New("voice: kodlayıcı paket tanımı geçersiz")
			}
			pkt = e.buf[:copy(e.buf, e.c.out.bytes()[off:off+uint64(sz)])]
		}
		if st != 0 && st != atStatusNoDat {
			return nil, osStatus(st)
		}
		if st == atStatusNoDat || n == 0 {
			break
		}
	}
	if pkt == nil {
		return nil, errors.New("voice: kodlayıcı paket üretmedi")
	}
	return pkt, nil
}

// lookahead kAudioConverterPrimeInfo leading (V-P33-A2; K0s-A1: 312).
func (e *atEncoder) lookahead() (int, error) {
	var b [8]byte
	sz := uint32(len(b))
	if st := atGet(e.c.ref, atPropPrime, &sz, unsafe.Pointer(&b[0])); st != 0 {
		return 0, osStatus(st)
	}
	return int(binary.LittleEndian.Uint32(b[:])), nil
}

// atDecoder Opus → PCM s16 mono 48 kHz (yalnız çözücü yardımcısında kullanılır).
type atDecoder struct{ c *atConv }

func newATDecoder() (*atDecoder, error) {
	c, err := newATConv(opusMono(), lpcmMono(), maxPacketSize+64, FrameSamples*2, true)
	if err != nil {
		return nil, err
	}
	return &atDecoder{c: c}, nil
}

// decode20 bir 20 ms paketi (boşsa PLC) çözer; çıktı kapasitesi 960. B3: kısa çıktı (ilk çerçeve 840) başa sıfırla
// doldurulur (libopus ile örnek hizası korunur). 0 örnek hata sayılır (B1).
func (d *atDecoder) decode20(pkt []byte, out []int16) error {
	if len(pkt) > maxPacketSize {
		return ErrPacketSize
	}
	copy(d.c.f.data.bytes(), pkt)
	d.c.f.n, d.c.f.packets, d.c.f.pending = uint32(len(pkt)), 1, true
	n, st := d.c.fill(FrameSamples, FrameSamples*2)
	if st != 0 && st != atStatusNoDat {
		return osStatus(st)
	}
	if n == 0 || n > FrameSamples {
		return errors.New("voice: çözücü çıktı vermedi")
	}
	pad := FrameSamples - int(n)
	clear(out[:pad])
	b := d.c.out.bytes()
	for i := range int(n) {
		out[pad+i] = int16(binary.LittleEndian.Uint16(b[2*i:]))
	}
	return nil
}
