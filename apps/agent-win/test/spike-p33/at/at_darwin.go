//go:build darwin

// Package at AudioToolbox AudioConverter ile Opus kodlayıcı/çözücü (K0s-A1). purego, cgo yok. Giriş geri çağrısı
// süreçte bir kez kurulur (init); C'ye bağlam olarak yalnız tamsayı tutamaç verilir; C'nin geri çağrı sonrasında okuduğu
// tamponlar (PCM, paket, paket tanımı) malloc belleğidir.
package at

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/test/spike-p33/mac"
)

const (
	FmtOpus = 0x6f707573 // 'opus'
	FmtLPCM = 0x6c70636d // 'lpcm'

	propPrime        = 0x7072696d // 'prim'
	propBitRate      = 0x62726174 // 'brat'
	propApplicable   = 0x61656272 // 'aebr'
	propQuality      = 0x63647175 // 'cdqu'
	propCurOut       = 0x61636f64 // 'acod'
	propCurIn        = 0x61636964 // 'acid'
	propMaxOutPkt    = 0x786f7073 // 'xops'
	propSettings     = 0x61637073 // 'acps'
	propCompCookie   = 0x636d6763 // 'cmgc'
	propDecompCookie = 0x646d6763 // 'dmgc'
	fmtEncoders      = 0x6176656e // 'aven'
	fmtDecoders      = 0x61766465 // 'avde'

	statusNoData = 0x6e6f6474 // 'nodt' — geri çağrının "şimdilik veri yok" özel kodu

	SampleRate = 48000
	Frame      = 960
	MaxPacket  = 1275
	MaxFrame   = 5760
)

// ASBD AudioStreamBasicDescription (40 bayt).
type ASBD struct {
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

// LPCM 48 kHz s16 paketli.
func LPCM(ch uint32) ASBD {
	return ASBD{SampleRate: SampleRate, FormatID: FmtLPCM, FormatFlags: 0x4 | 0x8, BytesPerPacket: 2 * ch,
		FramesPerPkt: 1, BytesPerFrame: 2 * ch, Channels: ch, BitsPerChannel: 16}
}

// Opus 48 kHz, 960 çerçeve/paket.
func Opus(ch, frames uint32) ASBD {
	return ASBD{SampleRate: SampleRate, FormatID: FmtOpus, FramesPerPkt: frames, Channels: ch}
}

var (
	convNew     func(in, out *ASBD, conv *uintptr) int32
	convDispose func(conv uintptr) int32
	convReset   func(conv uintptr) int32
	convSet     func(conv uintptr, id, size uint32, data unsafe.Pointer) int32
	convGet     func(conv uintptr, id uint32, size *uint32, data unsafe.Pointer) int32
	convGetInfo func(conv uintptr, id uint32, size *uint32, writable *bool) int32
	convFill    func(conv, proc, user uintptr, n *uint32, abl, desc uintptr) int32
	fmtGetInfo  func(id, specSize uint32, spec unsafe.Pointer, size *uint32) int32
	fmtGet      func(id, specSize uint32, spec unsafe.Pointer, size *uint32, out unsafe.Pointer) int32

	inputProc uintptr
	states    sync.Map // tutamaç → *feed
	nextID    uintptr
	idMu      sync.Mutex
)

// feed bir çeviricinin giriş durumu (C belleğini gösterir).
type feed struct {
	data     mac.CMem // PCM ya da paket
	desc     mac.CMem // AudioStreamPacketDescription (16 bayt)
	n        uint32   // sağlanacak bayt
	packets  uint32   // sağlanacak paket (PCM'de çerçeve)
	ch       uint32
	pending  bool
	isPacket bool
	calls    int // geri çağrı sayısı (tanı)
}

func init() {
	h, err := objc.Framework("AudioToolbox")
	mac.Must(err)
	mac.Must(objc.Func(&convNew, h, "AudioConverterNew"))
	mac.Must(objc.Func(&convDispose, h, "AudioConverterDispose"))
	mac.Must(objc.Func(&convReset, h, "AudioConverterReset"))
	mac.Must(objc.Func(&convSet, h, "AudioConverterSetProperty"))
	mac.Must(objc.Func(&convGet, h, "AudioConverterGetProperty"))
	mac.Must(objc.Func(&convGetInfo, h, "AudioConverterGetPropertyInfo"))
	mac.Must(objc.Func(&convFill, h, "AudioConverterFillComplexBuffer"))
	mac.Must(objc.Func(&fmtGetInfo, h, "AudioFormatGetPropertyInfo"))
	mac.Must(objc.Func(&fmtGet, h, "AudioFormatGetProperty"))
	inputProc = purego.NewCallback(func(_ uintptr, ioNum uintptr, ioData uintptr, outDesc uintptr, user uintptr) int32 {
		v, ok := states.Load(user)
		num := (*uint32)(mac.Ptr(ioNum))
		abl := unsafe.Slice((*byte)(mac.Ptr(ioData)), 24)
		if !ok {
			*num = 0
			return statusNoData
		}
		f := v.(*feed)
		f.calls++
		if !f.pending {
			*num = 0
			binary.LittleEndian.PutUint32(abl[12:], 0)
			binary.LittleEndian.PutUint64(abl[16:], 0)
			return statusNoData
		}
		f.pending = false
		binary.LittleEndian.PutUint32(abl[0:], 1)
		binary.LittleEndian.PutUint32(abl[8:], f.ch)
		binary.LittleEndian.PutUint32(abl[12:], f.n)
		binary.LittleEndian.PutUint64(abl[16:], uint64(f.data.P))
		*num = f.packets
		if f.isPacket && outDesc != 0 {
			d := f.desc.Bytes()
			binary.LittleEndian.PutUint64(d[0:], 0)
			binary.LittleEndian.PutUint32(d[8:], 0)
			binary.LittleEndian.PutUint32(d[12:], f.n)
			*(*uintptr)(mac.Ptr(outDesc)) = f.desc.P
		}
		return 0
	})
}

func newID(f *feed) uintptr {
	idMu.Lock()
	nextID++
	id := nextID
	idMu.Unlock()
	states.Store(id, f)
	return id
}

// OSErr OSStatus (dört karakterli kodlar okunur yazılır).
type OSErr int32

func (e OSErr) Error() string {
	u := uint32(e)
	b := []byte{byte(u >> 24), byte(u >> 16), byte(u >> 8), byte(u)}
	ok := true
	for _, c := range b {
		if c < 32 || c > 126 {
			ok = false
		}
	}
	if ok {
		return fmt.Sprintf("OSStatus '%s' (%d)", b, int32(e))
	}
	return fmt.Sprintf("OSStatus %d", int32(e))
}

// Conv bir AudioConverter + giriş/çıkış C tamponları.
type Conv struct {
	ref  uintptr
	id   uintptr
	f    *feed
	out  mac.CMem // çıktı verisi
	abl  mac.CMem // AudioBufferList (24 bayt)
	odsc mac.CMem // çıktı paket tanımları
	in   ASBD
	o    ASBD
}

func newConv(in, out ASBD, dataCap, outCap int, isPacket bool) (*Conv, error) {
	var ref uintptr
	if st := convNew(&in, &out, &ref); st != 0 {
		return nil, OSErr(st)
	}
	c := &Conv{ref: ref, in: in, o: out}
	c.f = &feed{data: mac.Alloc(dataCap), desc: mac.Alloc(16), ch: in.Channels, isPacket: isPacket}
	c.id = newID(c.f)
	c.out = mac.Alloc(outCap)
	c.abl = mac.Alloc(24)
	c.odsc = mac.Alloc(16 * 8)
	return c, nil
}

// Close çeviriciyi ve tamponları bırakır.
func (c *Conv) Close() {
	convDispose(c.ref)
	states.Delete(c.id)
	c.f.data.Free()
	c.f.desc.Free()
	c.out.Free()
	c.abl.Free()
	c.odsc.Free()
}

// Reset AudioConverterReset.
func (c *Conv) Reset() error {
	if st := convReset(c.ref); st != 0 {
		return OSErr(st)
	}
	return nil
}

// GetU32 / SetU32 tamsayı özellik.
func (c *Conv) GetU32(id uint32) (uint32, error) {
	var v uint32
	sz := uint32(4)
	if st := convGet(c.ref, id, &sz, unsafe.Pointer(&v)); st != 0 {
		return 0, OSErr(st)
	}
	return v, nil
}

func (c *Conv) SetU32(id, v uint32) error {
	if st := convSet(c.ref, id, 4, unsafe.Pointer(&v)); st != 0 {
		return OSErr(st)
	}
	return nil
}

// GetBytes özelliği ham bayt olarak okur.
func (c *Conv) GetBytes(id uint32) ([]byte, error) {
	var sz uint32
	var w bool
	if st := convGetInfo(c.ref, id, &sz, &w); st != 0 {
		return nil, OSErr(st)
	}
	if sz == 0 {
		return nil, nil
	}
	buf := make([]byte, sz)
	if st := convGet(c.ref, id, &sz, unsafe.Pointer(&buf[0])); st != 0 {
		return nil, OSErr(st)
	}
	return buf[:sz], nil
}

// SetBytes ham bayt özellik.
func (c *Conv) SetBytes(id uint32, b []byte) error {
	if len(b) == 0 {
		return nil
	}
	if st := convSet(c.ref, id, uint32(len(b)), unsafe.Pointer(&b[0])); st != 0 {
		return OSErr(st)
	}
	return nil
}

// Settings kAudioConverterPropertySettings (CFArray) açıklaması.
func (c *Conv) Settings() string {
	var arr uintptr
	sz := uint32(unsafe.Sizeof(arr))
	if st := convGet(c.ref, propSettings, &sz, unsafe.Pointer(&arr)); st != 0 {
		return OSErr(st).Error()
	}
	if arr == 0 {
		return "<boş>"
	}
	defer mac.CFRelease(arr)
	return mac.Describe(arr)
}

// fill bir FillComplexBuffer çağrısı: dönen (paket sayısı, durum).
func (c *Conv) fill(capPackets uint32, outBytes int) (uint32, int32) {
	abl := c.abl.Bytes()
	binary.LittleEndian.PutUint32(abl[0:], 1)
	binary.LittleEndian.PutUint32(abl[8:], c.o.Channels)
	binary.LittleEndian.PutUint32(abl[12:], uint32(outBytes))
	binary.LittleEndian.PutUint64(abl[16:], uint64(c.out.P))
	n := capPackets
	var desc uintptr
	if c.o.FormatID != FmtLPCM {
		desc = c.odsc.P
	}
	st := convFill(c.ref, inputProc, c.id, &n, c.abl.P, desc)
	return n, st
}

// ---------- Kodlayıcı ----------

// Encoder PCM s16 mono 48 kHz → Opus 20 ms.
type Encoder struct {
	*Conv
	FillCalls int // FillComplexBuffer çağrısı
	queued    [][]byte
}

// EncodeInfo kurulum bilgisi.
type EncodeInfo struct {
	PrimeLeading, PrimeTrailing uint32
	BitRate                     uint32
	MaxOutPacket                uint32
	Quality                     uint32
	Applicable                  []float64
	CookieLen                   int
	Cookie                      []byte
	OutASBD                     ASBD
	Settings                    string
}

// NewEncoder kodlayıcı kurar ve bit hızını ayarlar.
func NewEncoder(bitrate uint32) (*Encoder, error) {
	c, err := newConv(LPCM(1), Opus(1, Frame), Frame*2, 4096, false)
	if err != nil {
		return nil, err
	}
	if bitrate > 0 {
		if err := c.SetU32(propBitRate, bitrate); err != nil {
			c.Close()
			return nil, fmt.Errorf("brat: %w", err)
		}
	}
	return &Encoder{Conv: c}, nil
}

// Info kurulum özelliklerini okur.
func (e *Encoder) Info() EncodeInfo {
	var inf EncodeInfo
	if b, err := e.GetBytes(propPrime); err == nil && len(b) >= 8 {
		inf.PrimeLeading, inf.PrimeTrailing = binary.LittleEndian.Uint32(b), binary.LittleEndian.Uint32(b[4:])
	}
	inf.BitRate, _ = e.GetU32(propBitRate)
	inf.MaxOutPacket, _ = e.GetU32(propMaxOutPkt)
	inf.Quality, _ = e.GetU32(propQuality)
	if b, err := e.GetBytes(propApplicable); err == nil {
		for i := 0; i+16 <= len(b); i += 16 {
			inf.Applicable = append(inf.Applicable, math.Float64frombits(binary.LittleEndian.Uint64(b[i:])),
				math.Float64frombits(binary.LittleEndian.Uint64(b[i+8:])))
		}
	}
	if b, err := e.GetBytes(propCompCookie); err == nil {
		inf.CookieLen, inf.Cookie = len(b), b
	}
	if b, err := e.GetBytes(propCurOut); err == nil && len(b) >= 40 {
		inf.OutASBD = *(*ASBD)(unsafe.Pointer(&b[0]))
	}
	inf.Settings = e.Settings()
	return inf
}

// Encode 960 örneği verir; üretilen 0..n paketi döner (her paket kopya).
func (e *Encoder) Encode(pcm []int16) ([][]byte, error) {
	if len(pcm) != Frame {
		return nil, errors.New("960 örnek")
	}
	d := e.f.data.Bytes()
	for i, s := range pcm {
		binary.LittleEndian.PutUint16(d[2*i:], uint16(s))
	}
	e.f.n, e.f.packets, e.f.pending = Frame*2, Frame, true
	var out [][]byte
	for {
		n, st := e.fill(1, e.out.N)
		e.FillCalls++
		if n > 0 {
			dsc := e.odsc.Bytes()
			sz := binary.LittleEndian.Uint32(dsc[12:])
			off := binary.LittleEndian.Uint64(dsc[0:])
			b := e.out.Bytes()
			if int(off)+int(sz) > len(b) {
				return out, errors.New("paket tanımı taşıyor")
			}
			out = append(out, append([]byte(nil), b[off:off+uint64(sz)]...))
		}
		if st != 0 && st != statusNoData {
			return out, OSErr(st)
		}
		if st == statusNoData || n == 0 {
			break
		}
	}
	return out, nil
}

// ---------- Çözücü ----------

// Decoder Opus → PCM s16 mono (ya da outCh) 48 kHz.
type Decoder struct {
	*Conv
	pcm []int16
}

// NewDecoder inCh kanallı Opus girişi, outCh kanallı PCM çıkışı; cookie varsa dmgc.
func NewDecoder(inCh, outCh uint32, cookie []byte) (*Decoder, error) {
	return NewDecoderFrames(inCh, outCh, Frame, cookie)
}

// NewDecoderFrames giriş ASBD'sinde çerçeve/paket değeri seçilebilir (0 = değişken).
func NewDecoderFrames(inCh, outCh, frames uint32, cookie []byte) (*Decoder, error) {
	c, err := newConv(Opus(inCh, frames), LPCM(outCh), MaxPacket+64, MaxFrame*2*int(outCh), true)
	if err != nil {
		return nil, err
	}
	if len(cookie) > 0 {
		if err := c.SetBytes(propDecompCookie, cookie); err != nil {
			c.Close()
			return nil, fmt.Errorf("dmgc: %w", err)
		}
	}
	return &Decoder{Conv: c, pcm: make([]int16, MaxFrame*int(outCh))}, nil
}

// Decode bir paketi çözer; boş paket "kayıp" olarak 0 baytla verilir. Dönen dilim sonraki çağrıya kadar geçerli.
func (d *Decoder) Decode(pkt []byte) ([]int16, error) { return d.DecodeCap(pkt, MaxFrame) }

// DecodeCap çıktı kapasitesi (çerçeve) sınırlı çözme; boş pakette PLC uzunluğunu belirler.
func (d *Decoder) DecodeCap(pkt []byte, capFrames uint32) ([]int16, error) {
	if len(pkt) > d.f.data.N {
		return nil, errors.New("paket büyük")
	}
	copy(d.f.data.Bytes(), pkt)
	d.f.n, d.f.packets, d.f.pending = uint32(len(pkt)), 1, true
	ch := int(d.o.Channels)
	n, st := d.fill(capFrames, int(capFrames)*2*ch)
	if st != 0 && st != statusNoData {
		return nil, OSErr(st)
	}
	b := d.out.Bytes()
	cnt := int(n) * ch
	for i := range cnt {
		d.pcm[i] = int16(binary.LittleEndian.Uint16(b[2*i:]))
	}
	return d.pcm[:cnt], nil
}

// ClassDesc AudioClassDescription.
type ClassDesc struct{ Type, SubType, Manufacturer string }

func fourcc(u uint32) string {
	return string([]byte{byte(u >> 24), byte(u >> 16), byte(u >> 8), byte(u)})
}

// Codecs kAudioFormatProperty_Encoders/Decoders listesi (Opus için).
func Codecs(decoders bool) ([]ClassDesc, error) {
	id := uint32(fmtEncoders)
	if decoders {
		id = fmtDecoders
	}
	f := uint32(FmtOpus)
	var sz uint32
	if st := fmtGetInfo(id, 4, unsafe.Pointer(&f), &sz); st != 0 {
		return nil, OSErr(st)
	}
	if sz == 0 {
		return nil, nil
	}
	buf := make([]byte, sz)
	if st := fmtGet(id, 4, unsafe.Pointer(&f), &sz, unsafe.Pointer(&buf[0])); st != 0 {
		return nil, OSErr(st)
	}
	var out []ClassDesc
	for i := 0; i+12 <= int(sz); i += 12 {
		out = append(out, ClassDesc{fourcc(binary.LittleEndian.Uint32(buf[i:])), fourcc(binary.LittleEndian.Uint32(buf[i+4:])),
			fourcc(binary.LittleEndian.Uint32(buf[i+8:]))})
	}
	return out, nil
}

// Calls giriş geri çağrısı sayısı (tanı).
func (c *Conv) Calls() int { return c.f.calls }
