//go:build windows

package capture

import (
	"errors"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// vtable dizinleri (mfobjects.h / mftransform.h, IMFAttributes 3..32).
const (
	vtAttrGetUINT32     = 7
	vtAttrGetBlobSize   = 14
	vtAttrGetBlob       = 15
	vtAttrSetUINT32     = 21
	vtAttrSetUINT64     = 22
	vtAttrSetGUID       = 24
	vtActivateObject    = 33
	vtActivateShutdown  = 34
	vtEventGetType      = 33
	vtEventGetStatus    = 35
	vtSampleSetTime     = 36
	vtSampleSetDuration = 38
	vtSampleContiguous  = 41
	vtSampleAddBuffer   = 42
	vtBufLock           = 3
	vtBufUnlock         = 4
	vtBufSetCurLen      = 6
	vtGenGetEvent       = 3
	vtCodecSetValue     = 9

	vtMFTGetStreamIDs     = 5
	vtMFTGetOutStreamInfo = 7
	vtMFTGetAttributes    = 8
	vtMFTGetOutAvailType  = 14
	vtMFTSetInputType     = 15
	vtMFTSetOutputType    = 16
	vtMFTGetOutputCurType = 18
	vtMFTProcessMessage   = 23
	vtMFTProcessInput     = 24
	vtMFTProcessOutput    = 25
)

const (
	mfVersion            = 0x00020070
	mfStartupLite        = 1
	mftEnumSyncMFT       = 0x1
	mftEnumHardware      = 0x4
	mftEnumSortAndFilter = 0x40
	clsctxInproc         = 0x1

	mftMsgBeginStreaming = 0x10000000
	mftMsgStartOfStream  = 0x10000003
	mftMsgEndOfStream    = 0x10000002

	mftOutProvidesSamples   = 0x100
	mftOutCanProvideSamples = 0x200
	meTransformNeedInput    = 601
	meTransformHaveOutput   = 602
	mfEventFlagNoWait       = 1
	interlaceProgressive    = 2
	h264ProfileBaseline     = 66
	vtUI4                   = 19
	vtBool                  = 11

	eNotImpl         hresult = -0x7FFFBFFF // 0x80004001
	mfENeedMoreInput hresult = -0x3FF2928E // 0xC00D6D72
	mfEStreamChange  hresult = -0x3FF2929F // 0xC00D6D61
	mfENotAccepting  hresult = -0x3FF2C94B // 0xC00D36B5
	mfENoEventsAvail hresult = -0x3FF2C180 // 0xC00D3E80
)

var (
	mftCategoryVideoEncoder = guid(0xf79eac7d, 0xe545, 0x4387, 0xbd, 0xee, 0xd6, 0x47, 0xd7, 0xbd, 0xe4, 0x2a)
	mfMediaTypeVideo        = guid(0x73646976, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71)
	mfVideoFormatH264       = guid(0x34363248, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71)
	mfVideoFormatNV12       = guid(0x3231564e, 0x0000, 0x0010, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71)
	clsidMSH264Encoder      = guid(0x6ca50344, 0x051a, 0x4ded, 0x97, 0x79, 0xa4, 0x33, 0x05, 0x16, 0x5e, 0x35)

	mfMTMajorType     = guid(0x48eba18e, 0xf8c9, 0x4687, 0xbf, 0x11, 0x0a, 0x74, 0xc9, 0xf9, 0x6a, 0x8f)
	mfMTSubtype       = guid(0xf7e34c9a, 0x42e8, 0x4714, 0xb7, 0x4b, 0xcb, 0x29, 0xd7, 0x2c, 0x35, 0xe5)
	mfMTFrameSize     = guid(0x1652c33d, 0xd6b2, 0x4012, 0xb8, 0x34, 0x72, 0x03, 0x08, 0x49, 0xa3, 0x7d)
	mfMTFrameRate     = guid(0xc459a2e8, 0x3d2c, 0x4e44, 0xb1, 0x32, 0xfe, 0xe5, 0x15, 0x6c, 0x7b, 0xb0)
	mfMTPixelAspect   = guid(0xc6376a1e, 0x8d0a, 0x4027, 0xbe, 0x45, 0x6d, 0x9a, 0x0a, 0xd3, 0x9b, 0xb6)
	mfMTInterlaceMode = guid(0xe2724bb8, 0xe676, 0x4806, 0xb4, 0xb2, 0xa8, 0xd6, 0xef, 0xb4, 0x4c, 0xcd)
	mfMTAvgBitrate    = guid(0x20332624, 0xfb0d, 0x4d9e, 0xbd, 0x0d, 0xcb, 0xf6, 0x78, 0x6c, 0x10, 0x2e)
	mfMTMpeg2Profile  = guid(0xad76a80b, 0x2d5c, 0x4e0b, 0xb3, 0x75, 0x64, 0xe5, 0x20, 0x13, 0x70, 0x36)
	mfMTSeqHeader     = guid(0x3c036de7, 0x3ad0, 0x4c9e, 0x92, 0x16, 0xee, 0x6d, 0x6a, 0xc2, 0x1c, 0xb3)
	mfMTDefaultStride = guid(0x644b4e48, 0x1e02, 0x4516, 0xb0, 0xeb, 0xc0, 0x1c, 0xa9, 0xd4, 0x9a, 0xc6)
	mfTransformAsync  = guid(0xf81a699a, 0x649a, 0x497d, 0x8c, 0x73, 0x29, 0xf8, 0xfe, 0xd6, 0xad, 0x7a)
	mfTransformUnlock = guid(0xe5666d6b, 0x3422, 0x4eb6, 0xa4, 0x21, 0xda, 0x7d, 0xb1, 0xf8, 0xe2, 0x07)
	mfLowLatency      = guid(0x9c27891a, 0xed7a, 0x40e1, 0x88, 0xe8, 0xb2, 0x27, 0x27, 0xa0, 0x24, 0xee)

	codecRateControlMode = guid(0x1c0608e9, 0x370c, 0x4710, 0x8a, 0x58, 0xcb, 0x61, 0x81, 0xc4, 0x24, 0x23)
	codecMeanBitRate     = guid(0xf7222374, 0x2144, 0x4815, 0xb5, 0x50, 0xa3, 0x7f, 0x8e, 0x12, 0xee, 0x52)
	codecGOPSize         = guid(0x95f31b26, 0x95a4, 0x41aa, 0x93, 0x03, 0x24, 0x6a, 0x7f, 0xc6, 0xee, 0xf1)
	codecForceKeyFrame   = guid(0x398c1b98, 0x8353, 0x475a, 0x9e, 0xf2, 0x8f, 0x26, 0x5d, 0x26, 0x03, 0x45)
	codecLowLatency      = mfLowLatency // CODECAPI_AVLowLatencyMode ile aynı GUID
	codecQualityVsSpeed  = guid(0x98332df8, 0x03cd, 0x476b, 0x89, 0xfa, 0x3f, 0x9e, 0x44, 0x2d, 0xec, 0x9f)
)

type mftRegTypeInfo struct{ Major, Sub windows.GUID }

type mftOutStreamInfo struct{ Flags, Size, Alignment uint32 }

type mftOutputDataBuffer struct {
	StreamID uint32
	Sample   *comObj
	Status   uint32
	Events   *comObj
}

// variant VARIANT (x64: 24 bayt); yalnız VT_UI4 ve VT_BOOL kullanılır.
type variant struct {
	VT  uint16
	_   [3]uint16
	Val uint64
	_   uint64
}

var errEncoderTimeout = errors.New("capture: kodlayıcı yanıt vermedi")

// encoder Media Foundation H.264 kodlayıcı MFT (Baseline, CBR, düşük gecikme): donanım MFT'si (çoğu asenkron) ya da
// yazılım "H264 Encoder MFT" (CLSID_MSH264EncoderMFT, senkron). Hangisinin önce deneneceğine ve yayında yazılıma
// geçişe selectEncoder karar verir (AC-245).
type encoder struct {
	act, mft, codec, events *comObj
	async                   bool
	inID, outID             uint32
	outInfo                 mftOutStreamInfo
	w, h                    int
	pts                     int64 // 100 ns
	needInput               int   // asenkron: bekleyen METransformNeedInput sayısı
	ps                      paramSets
}

// openEncoder hw ise donanım, değilse yazılım kodlayıcı kurar (aynı çözünürlük, kare hızı, profil). Hata tiplidir:
// NO_H264_ENCODER (MFT yok, ör. Windows N) veya ENCODER_CONFIG (türler/parametreler kabul edilmedi).
func openEncoder(w, h, fps int, hw bool) (Encoder, error) {
	e, err := createEncoder(w, h, fps, hw)
	if err != nil {
		return nil, err
	}
	return e, nil
}

func createEncoder(w, h, fps int, hw bool) (*encoder, error) {
	e := &encoder{w: w, h: h}
	if err := e.activate(hw); err != nil {
		return nil, tag(err, stageEncoderCreate, "MFTEnumEx")
	}
	if err := e.configure(w, h, fps); err != nil {
		e.Close()
		return nil, tag(err, stageEncoderConfig, "Configure")
	}
	return e, nil
}

func (e *encoder) activate(hw bool) error {
	flags := uintptr(mftEnumSyncMFT | mftEnumSortAndFilter)
	if hw {
		flags = mftEnumHardware | mftEnumSortAndFilter
	}
	in := mftRegTypeInfo{mfMediaTypeVideo, mfVideoFormatNV12}
	out := mftRegTypeInfo{mfMediaTypeVideo, mfVideoFormatH264}
	var arr **comObj
	var n uint32
	err := procHR(pMFTEnumEx, "MFTEnumEx", uintptr(unsafe.Pointer(&mftCategoryVideoEncoder)), flags,
		uintptr(unsafe.Pointer(&in)), uintptr(unsafe.Pointer(&out)), uintptr(unsafe.Pointer(&arr)), uintptr(unsafe.Pointer(&n)))
	if err == nil && n > 0 {
		list := unsafe.Slice(arr, n)
		var hr hresult = -1
		for i, a := range list {
			if hr.failed() {
				if hr = a.call(vtActivateObject, uintptr(unsafe.Pointer(&iidIMFTransform)), uintptr(unsafe.Pointer(&e.mft))); !hr.failed() {
					e.act = list[i]
					continue
				}
			}
			a.release()
		}
		windows.CoTaskMemFree(unsafe.Pointer(arr))
		if e.mft != nil {
			return nil
		}
	} else if err == nil {
		windows.CoTaskMemFree(unsafe.Pointer(arr))
	}
	if hw {
		return &Error{Reason: ReasonNoH264Encoder, Op: "MFTEnumEx(HW)"}
	}
	return procHR(pCoCreateInstance, "CoCreateInstance(H264 Encoder MFT)", uintptr(unsafe.Pointer(&clsidMSH264Encoder)), 0,
		clsctxInproc, uintptr(unsafe.Pointer(&iidIMFTransform)), uintptr(unsafe.Pointer(&e.mft)))
}

func (e *encoder) configure(w, h, fps int) error {
	var attrs *comObj
	if hr := e.mft.call(vtMFTGetAttributes, uintptr(unsafe.Pointer(&attrs))); !hr.failed() && attrs != nil {
		var async uint32
		if hr := attrs.call(vtAttrGetUINT32, uintptr(unsafe.Pointer(&mfTransformAsync)), uintptr(unsafe.Pointer(&async))); !hr.failed() && async != 0 {
			e.async = true
			attrs.call(vtAttrSetUINT32, uintptr(unsafe.Pointer(&mfTransformUnlock)), 1)
		}
		attrs.call(vtAttrSetUINT32, uintptr(unsafe.Pointer(&mfLowLatency)), 1)
		attrs.release()
	}
	var ids [2]uint32
	if hr := e.mft.call(vtMFTGetStreamIDs, 1, uintptr(unsafe.Pointer(&ids[0])), 1, uintptr(unsafe.Pointer(&ids[1]))); !hr.failed() {
		e.inID, e.outID = ids[0], ids[1]
	} else if hr != eNotImpl {
		return hr.err("GetStreamIDs")
	}
	if c, err := e.mft.query(&iidICodecAPI); err == nil {
		e.codec = c
		e.setCodec(&codecRateControlMode, vtUI4, 0) // eAVEncCommonRateControlMode_CBR
		e.setCodec(&codecMeanBitRate, vtUI4, uint64(bitrateFor(w, h, fps)))
		e.setCodec(&codecGOPSize, vtUI4, uint64(fps)*uint64(gopDuration/time.Second))
		e.setCodec(&codecLowLatency, vtBool, 0xFFFF)
		e.setCodec(&codecQualityVsSpeed, vtUI4, 0) // hız öncelikli (AC-41)
	}
	outT, err := e.mediaType(w, h, fps, &mfVideoFormatH264)
	if err != nil {
		return err
	}
	outT.call(vtAttrSetUINT32, uintptr(unsafe.Pointer(&mfMTAvgBitrate)), uintptr(bitrateFor(w, h, fps)))
	outT.call(vtAttrSetUINT32, uintptr(unsafe.Pointer(&mfMTMpeg2Profile)), h264ProfileBaseline)
	hr := e.mft.call(vtMFTSetOutputType, uintptr(e.outID), uintptr(unsafe.Pointer(outT)), 0)
	outT.release()
	if hr.failed() {
		return hr.err("SetOutputType")
	}
	inT, err := e.mediaType(w, h, fps, &mfVideoFormatNV12)
	if err != nil {
		return err
	}
	inT.call(vtAttrSetUINT32, uintptr(unsafe.Pointer(&mfMTDefaultStride)), uintptr(w))
	hr = e.mft.call(vtMFTSetInputType, uintptr(e.inID), uintptr(unsafe.Pointer(inT)), 0)
	inT.release()
	if hr.failed() {
		return hr.err("SetInputType")
	}
	e.learnSeqHeader()
	if hr := e.mft.call(vtMFTGetOutStreamInfo, uintptr(e.outID), uintptr(unsafe.Pointer(&e.outInfo))); hr.failed() {
		return hr.err("GetOutputStreamInfo")
	}
	if e.async {
		ev, err := e.mft.query(&iidIMFMediaEventGenerator)
		if err != nil {
			return err
		}
		e.events = ev
	}
	e.mft.call(vtMFTProcessMessage, mftMsgBeginStreaming, 0)
	e.mft.call(vtMFTProcessMessage, mftMsgStartOfStream, 0)
	return nil
}

func (e *encoder) mediaType(w, h, fps int, sub *windows.GUID) (*comObj, error) {
	var t *comObj
	if err := procHR(pMFCreateMediaType, "MFCreateMediaType", uintptr(unsafe.Pointer(&t))); err != nil {
		return nil, err
	}
	t.call(vtAttrSetGUID, uintptr(unsafe.Pointer(&mfMTMajorType)), uintptr(unsafe.Pointer(&mfMediaTypeVideo)))
	t.call(vtAttrSetGUID, uintptr(unsafe.Pointer(&mfMTSubtype)), uintptr(unsafe.Pointer(sub)))
	setUINT64(t, &mfMTFrameSize, uint64(w)<<32|uint64(h))
	setUINT64(t, &mfMTFrameRate, uint64(fps)<<32|1)
	setUINT64(t, &mfMTPixelAspect, 1<<32|1)
	t.call(vtAttrSetUINT32, uintptr(unsafe.Pointer(&mfMTInterlaceMode)), interlaceProgressive)
	return t, nil
}

// setUINT64 IMFAttributes::SetUINT64. UINT64 değerle geçer: 64 bit ABI'de tek yazmaç, 32 bit stdcall'da iki sözcük
// (düşük önce). Sabit uintptr'a doğrudan çevrilmez (386'da taşma derleme hatası, S-P17-5 ile aynı inceleme).
func setUINT64(t *comObj, key *windows.GUID, v uint64) {
	if unsafe.Sizeof(uintptr(0)) == 8 {
		t.call(vtAttrSetUINT64, uintptr(unsafe.Pointer(key)), uintptr(v))
		return
	}
	t.call(vtAttrSetUINT64, uintptr(unsafe.Pointer(key)), uintptr(uint32(v)), uintptr(uint32(v>>32)))
}

func (e *encoder) setCodec(id *windows.GUID, vt uint16, val uint64) {
	if e.codec == nil {
		return
	}
	v := variant{VT: vt, Val: val}
	e.codec.call(vtCodecSetValue, uintptr(unsafe.Pointer(id)), uintptr(unsafe.Pointer(&v)))
}

// SetBitrate kare hızı değişince CBR hedefini günceller (desteklemeyen kodlayıcıda etkisiz).
func (e *encoder) SetBitrate(bps int) { e.setCodec(&codecMeanBitRate, vtUI4, uint64(bps)) }

// learnSeqHeader çıkış medya türündeki SPS/PPS'i (varsa) önbelleğe alır.
func (e *encoder) learnSeqHeader() {
	var t *comObj
	if hr := e.mft.call(vtMFTGetOutputCurType, uintptr(e.outID), uintptr(unsafe.Pointer(&t))); hr.failed() || t == nil {
		return
	}
	defer t.release()
	var n uint32
	if hr := t.call(vtAttrGetBlobSize, uintptr(unsafe.Pointer(&mfMTSeqHeader)), uintptr(unsafe.Pointer(&n))); hr.failed() || n == 0 || n > 4096 {
		return
	}
	b := make([]byte, n)
	if hr := t.call(vtAttrGetBlob, uintptr(unsafe.Pointer(&mfMTSeqHeader)), uintptr(unsafe.Pointer(&b[0])), uintptr(n), 0); !hr.failed() {
		e.ps.learn(b)
	}
}

// Encode tek NV12 kareyi kodlar; çıktı Annex-B erişim birimi (IDR önünde SPS/PPS). Kodlayıcı gecikmesinde boş dönebilir.
func (e *encoder) Encode(f *NV12, dur time.Duration, key bool) ([]byte, bool, error) {
	if key {
		e.setCodec(&codecForceKeyFrame, vtUI4, 1)
	}
	smp, err := e.inputSample(f, dur)
	if err != nil {
		return nil, false, err
	}
	defer smp.release()
	var out []byte
	if e.async {
		out, err = e.encodeAsync(smp)
	} else {
		out, err = e.encodeSync(smp)
	}
	if err != nil || len(out) == 0 {
		return nil, false, err
	}
	au, isKey := e.ps.fix(out)
	return au, isKey, nil
}

func (e *encoder) inputSample(f *NV12, dur time.Duration) (*comObj, error) {
	var buf, smp *comObj
	if err := procHR(pMFCreateMemoryBuffer, "MFCreateMemoryBuffer", uintptr(len(f.Data)), uintptr(unsafe.Pointer(&buf))); err != nil {
		return nil, err
	}
	defer buf.release()
	var p *byte
	if hr := buf.call(vtBufLock, uintptr(unsafe.Pointer(&p)), 0, 0); hr.failed() {
		return nil, hr.err("IMFMediaBuffer.Lock")
	}
	copy(unsafe.Slice(p, len(f.Data)), f.Data)
	buf.call(vtBufUnlock)
	buf.call(vtBufSetCurLen, uintptr(len(f.Data)))
	if err := procHR(pMFCreateSample, "MFCreateSample", uintptr(unsafe.Pointer(&smp))); err != nil {
		return nil, err
	}
	smp.call(vtSampleAddBuffer, uintptr(unsafe.Pointer(buf)))
	d := int64(dur / 100)
	smp.call(vtSampleSetTime, uintptr(e.pts))
	smp.call(vtSampleSetDuration, uintptr(d))
	e.pts += d
	return smp, nil
}

func (e *encoder) encodeSync(smp *comObj) ([]byte, error) {
	hr := e.mft.call(vtMFTProcessInput, uintptr(e.inID), uintptr(unsafe.Pointer(smp)), 0)
	var out []byte
	if hr == mfENotAccepting { // önce bekleyen çıktı alınır
		b, err := e.drain()
		if err != nil {
			return nil, err
		}
		out = b
		hr = e.mft.call(vtMFTProcessInput, uintptr(e.inID), uintptr(unsafe.Pointer(smp)), 0)
	}
	if hr.failed() {
		return nil, hr.err("ProcessInput")
	}
	b, err := e.drain()
	return append(out, b...), err
}

// drain MF_E_TRANSFORM_NEED_MORE_INPUT gelene kadar çıktı toplar.
func (e *encoder) drain() ([]byte, error) {
	var out []byte
	for i := 0; i < 16; i++ {
		b, more, err := e.processOutput()
		if err != nil || !more {
			return append(out, b...), err
		}
		out = append(out, b...)
	}
	return out, nil
}

// encodeAsync asenkron (donanım) MFT olay döngüsü: METransformNeedInput beklenir, girdi verilir, ardından bu karenin
// METransformHaveOutput olayı (veya bir sonraki NeedInput) en çok 500 ms beklenir.
func (e *encoder) encodeAsync(smp *comObj) ([]byte, error) {
	var out []byte
	deadline := time.Now().Add(500 * time.Millisecond)
	for e.needInput == 0 {
		ev, err := e.nextEvent(deadline)
		if err != nil {
			return nil, err
		}
		switch ev {
		case meTransformNeedInput:
			e.needInput++
		case meTransformHaveOutput:
			b, _, err := e.processOutput()
			if err != nil {
				return nil, err
			}
			out = append(out, b...)
		}
	}
	if hr := e.mft.call(vtMFTProcessInput, uintptr(e.inID), uintptr(unsafe.Pointer(smp)), 0); hr.failed() {
		return nil, hr.err("ProcessInput")
	}
	e.needInput--
	for len(out) == 0 && e.needInput == 0 {
		ev, err := e.nextEvent(deadline)
		if err != nil {
			return out, err
		}
		switch ev {
		case meTransformNeedInput:
			e.needInput++
		case meTransformHaveOutput:
			b, _, err := e.processOutput()
			if err != nil {
				return nil, err
			}
			out = append(out, b...)
		}
	}
	return out, nil
}

func (e *encoder) nextEvent(deadline time.Time) (uint32, error) {
	for {
		var ev *comObj
		hr := e.events.call(vtGenGetEvent, mfEventFlagNoWait, uintptr(unsafe.Pointer(&ev)))
		if hr == mfENoEventsAvail {
			if time.Now().After(deadline) {
				return 0, errEncoderTimeout
			}
			time.Sleep(time.Millisecond)
			continue
		}
		if hr.failed() {
			return 0, hr.err("GetEvent")
		}
		var typ uint32
		var st hresult
		ev.call(vtEventGetType, uintptr(unsafe.Pointer(&typ)))
		ev.call(vtEventGetStatus, uintptr(unsafe.Pointer(&st)))
		ev.release()
		if st.failed() {
			return 0, st.err("MFT olayı")
		}
		return typ, nil
	}
}

// processOutput tek çıktı örneği alır. more=false: kodlayıcı yeni girdi istiyor.
func (e *encoder) processOutput() (out []byte, more bool, err error) {
	db := mftOutputDataBuffer{StreamID: e.outID}
	var own *comObj
	if e.outInfo.Flags&(mftOutProvidesSamples|mftOutCanProvideSamples) == 0 {
		size := max(int(e.outInfo.Size), e.w*e.h*3/2)
		var buf *comObj
		if err := procHR(pMFCreateMemoryBuffer, "MFCreateMemoryBuffer", uintptr(size), uintptr(unsafe.Pointer(&buf))); err != nil {
			return nil, false, err
		}
		if err := procHR(pMFCreateSample, "MFCreateSample", uintptr(unsafe.Pointer(&own))); err != nil {
			buf.release()
			return nil, false, err
		}
		own.call(vtSampleAddBuffer, uintptr(unsafe.Pointer(buf)))
		buf.release()
		db.Sample = own
	}
	defer own.release()
	var status uint32
	hr := e.mft.call(vtMFTProcessOutput, 0, 1, uintptr(unsafe.Pointer(&db)), uintptr(unsafe.Pointer(&status)))
	db.Events.release()
	if db.Sample != nil && db.Sample != own {
		defer db.Sample.release()
	}
	switch {
	case hr == mfENeedMoreInput:
		return nil, false, nil
	case hr == mfEStreamChange: // çıkış türü yeniden anlaşılır (bazı donanım kodlayıcıları)
		var t *comObj
		if hr := e.mft.call(vtMFTGetOutAvailType, uintptr(e.outID), 0, uintptr(unsafe.Pointer(&t))); hr.failed() {
			return nil, false, hr.err("GetOutputAvailableType")
		}
		hr := e.mft.call(vtMFTSetOutputType, uintptr(e.outID), uintptr(unsafe.Pointer(t)), 0)
		t.release()
		if hr.failed() {
			return nil, false, hr.err("SetOutputType")
		}
		e.learnSeqHeader()
		e.mft.call(vtMFTGetOutStreamInfo, uintptr(e.outID), uintptr(unsafe.Pointer(&e.outInfo)))
		return nil, true, nil
	case hr.failed():
		return nil, false, hr.err("ProcessOutput")
	case db.Sample == nil:
		return nil, true, nil
	}
	var buf *comObj
	if hr := db.Sample.call(vtSampleContiguous, uintptr(unsafe.Pointer(&buf))); hr.failed() {
		return nil, false, hr.err("ConvertToContiguousBuffer")
	}
	defer buf.release()
	var p *byte
	var n uint32
	if hr := buf.call(vtBufLock, uintptr(unsafe.Pointer(&p)), 0, uintptr(unsafe.Pointer(&n))); hr.failed() {
		return nil, false, hr.err("IMFMediaBuffer.Lock")
	}
	if n > 0 {
		out = append([]byte(nil), unsafe.Slice(p, n)...)
	}
	buf.call(vtBufUnlock)
	return out, true, nil
}

// Close MFT'yi durdurup bırakır (tekrar çağrılabilir).
func (e *encoder) Close() {
	if e.mft != nil {
		e.mft.call(vtMFTProcessMessage, mftMsgEndOfStream, 0)
	}
	e.events.release()
	e.codec.release()
	e.mft.release()
	if e.act != nil {
		e.act.call(vtActivateShutdown)
		e.act.release()
	}
	e.events, e.codec, e.mft, e.act = nil, nil, nil, nil
}
