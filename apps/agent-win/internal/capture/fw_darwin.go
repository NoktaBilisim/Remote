//go:build darwin

package capture

import (
	"errors"
	"fmt"
	"unsafe"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/darwin/objc"
)

// cmTime CoreMedia CMTime (değerle geçer; K0s purego ile doğrulandı).
type cmTime struct {
	Value     int64
	Timescale int32
	Flags     uint32
	Epoch     int64
}

const cmTimeValid = 1

// C işlevleri (FFI kuralı 7: yalnız izin listeli mutlak çerçeve yolundan; kural 5: sembol yoksa fail-closed).
var (
	cfRelease      func(p uintptr)
	cfRetain       func(p uintptr) uintptr
	cfArrayCount   func(a uintptr) int
	cfArrayAt      func(a uintptr, i int) uintptr
	cfDictGet      func(d, k uintptr) uintptr
	cfNumberGet    func(n uintptr, typ int, out *int64) bool
	cfBooleanValue func(b uintptr) bool

	cmGetImage    func(sb uintptr) uintptr
	cmAttachments func(sb uintptr, create bool) uintptr
	cmGetData     func(sb uintptr) uintptr
	cmBBLen       func(bb uintptr) uintptr
	cmBBCopy      func(bb, off, n uintptr, dst unsafe.Pointer) int32
	cmGetFormat   func(sb uintptr) uintptr
	cmParamSet    func(fd, idx uintptr, p *unsafe.Pointer, n *uintptr, cnt *uintptr, hdr *int32) int32

	cvWidth      func(pb uintptr) uintptr
	cvHeight     func(pb uintptr) uintptr
	cvFormat     func(pb uintptr) uint32
	cvPlaneCount func(pb uintptr) uintptr
	cvPlaneH     func(pb, plane uintptr) uintptr
	cvLock       func(pb uintptr, flags uint64) int32
	cvUnlock     func(pb uintptr, flags uint64) int32
	cvBase       func(pb, plane uintptr) unsafe.Pointer
	cvBPR        func(pb, plane uintptr) uintptr
	cvPoolCreate func(alloc, pool uintptr, out *uintptr) int32

	vtCreate     func(alloc uintptr, w, h int32, codec uint32, spec, srcAttrs, cda, cb, ref uintptr, out *uintptr) int32
	vtSet        func(s, key, val uintptr) int32
	vtCopy       func(s, key, alloc uintptr, out *uintptr) int32
	vtPrepare    func(s uintptr) int32
	vtEncode     func(s, pb uintptr, pts, dur cmTime, props, ref uintptr, info *uint32) int32
	vtComplete   func(s uintptr, until cmTime) int32
	vtInvalidate func(s uintptr)
	vtPool       func(s uintptr) uintptr

	cgPreflight     func() bool
	cgActiveList    func(max uint32, out *uint32, count *uint32) int32
	cgMainDisplay   func() uint32
	cgMirrors       func(id uint32) uint32
	cgBounds        func(id uint32) objc.CGRect
	cgCopyMode      func(id uint32) uintptr
	cgModePixelW    func(m uintptr) uintptr
	cgModePixelH    func(m uintptr) uintptr
	cgModeRelease   func(m uintptr)
	cgSessionCopyDc func() uintptr
)

// CFString/CFBoolean sabitleri (sembol değişkeninin değeri).
var (
	kNotSync    uintptr // kCMSampleAttachmentKey_NotSync
	kSCKStatus  uintptr // SCStreamFrameInfoStatus
	kIOSurface  uintptr // kCVPixelBufferIOSurfacePropertiesKey
	kPixFmt     uintptr // kCVPixelBufferPixelFormatTypeKey
	kPixW       uintptr // kCVPixelBufferWidthKey
	kPixH       uintptr // kCVPixelBufferHeightKey
	kRealTime   uintptr
	kProfile    uintptr
	kBaseline   uintptr // kVTProfileLevel_H264_Baseline_AutoLevel
	kReorder    uintptr
	kAvgBitRate uintptr
	kRateLimits uintptr
	kMaxKeyDur  uintptr
	kExpFPS     uintptr
	kForceKey   uintptr
	kUsingHW    uintptr
	kRequireHW  uintptr // kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder
	kEnableHW   uintptr // kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder
	kMatrix     uintptr // kVTCompressionPropertyKey_YCbCrMatrix
	kPrimaries  uintptr // kVTCompressionPropertyKey_ColorPrimaries
	kTransfer   uintptr // kVTCompressionPropertyKey_TransferFunction
	kVT709      uintptr // kCVImageBufferYCbCrMatrix_ITU_R_709_2 (aynı değer primaries/transfer için de)
	kVTP709     uintptr // kCVImageBufferColorPrimaries_ITU_R_709_2
	kVTT709     uintptr // kCVImageBufferTransferFunction_ITU_R_709_2
	kSCKMatrix  uintptr // kCGDisplayStreamYCbCrMatrix_ITU_R_709_2
	kSRGB       uintptr // kCGColorSpaceSRGB
)

// fwErr çerçeve bağlama sonucu (init'te bir kez; nil değilse yakalama fail-closed).
var fwErr error

// errFrameworks yakalama çerçeveleri bağlanamadı.
var errFrameworks = errors.New("capture: macOS yakalama çerçeveleri bağlanamadı")

type binder struct {
	errs []error
}

func (b *binder) open(name string) uintptr {
	h, err := objc.Framework(name)
	if err != nil {
		b.errs = append(b.errs, err)
	}
	return h
}

func (b *binder) fn(fptr any, h uintptr, name string) {
	if h == 0 {
		return
	}
	if err := objc.Func(fptr, h, name); err != nil {
		b.errs = append(b.errs, err)
	}
}

// konst h'deki işaretçi değerli veri sembolünü (CFStringRef sabiti) okur. Sembol C belleğidir; adres yeniden
// yorumlanır, uintptr → unsafe.Pointer dönüşümü yapılmaz (S6-1).
func (b *binder) konst(h uintptr, name string) uintptr {
	if h == 0 {
		return 0
	}
	sym, err := purego.Dlsym(h, name)
	if err != nil || sym == 0 {
		b.errs = append(b.errs, fmt.Errorf("capture: %s sabiti yok", name))
		return 0
	}
	v := **(**uintptr)(unsafe.Pointer(&sym))
	if v == 0 {
		b.errs = append(b.errs, fmt.Errorf("capture: %s sabiti boş", name))
	}
	return v
}

// bindFrameworks tüm yakalama/kodlama çerçevelerini bağlar; eksik sembol hata listesine girer.
func bindFrameworks() error {
	var b binder
	cf := b.open("CoreFoundation")
	cm := b.open("CoreMedia")
	cv := b.open("CoreVideo")
	vt := b.open("VideoToolbox")
	cg := b.open("CoreGraphics")
	sck := b.open("ScreenCaptureKit")
	b.open("Foundation")
	b.fn(&cfRelease, cf, "CFRelease")
	b.fn(&cfRetain, cf, "CFRetain")
	b.fn(&cfArrayCount, cf, "CFArrayGetCount")
	b.fn(&cfArrayAt, cf, "CFArrayGetValueAtIndex")
	b.fn(&cfDictGet, cf, "CFDictionaryGetValue")
	b.fn(&cfNumberGet, cf, "CFNumberGetValue")
	b.fn(&cfBooleanValue, cf, "CFBooleanGetValue")
	b.fn(&cmGetImage, cm, "CMSampleBufferGetImageBuffer")
	b.fn(&cmAttachments, cm, "CMSampleBufferGetSampleAttachmentsArray")
	b.fn(&cmGetData, cm, "CMSampleBufferGetDataBuffer")
	b.fn(&cmBBLen, cm, "CMBlockBufferGetDataLength")
	b.fn(&cmBBCopy, cm, "CMBlockBufferCopyDataBytes")
	b.fn(&cmGetFormat, cm, "CMSampleBufferGetFormatDescription")
	b.fn(&cmParamSet, cm, "CMVideoFormatDescriptionGetH264ParameterSetAtIndex")
	b.fn(&cvWidth, cv, "CVPixelBufferGetWidth")
	b.fn(&cvHeight, cv, "CVPixelBufferGetHeight")
	b.fn(&cvFormat, cv, "CVPixelBufferGetPixelFormatType")
	b.fn(&cvPlaneCount, cv, "CVPixelBufferGetPlaneCount")
	b.fn(&cvPlaneH, cv, "CVPixelBufferGetHeightOfPlane")
	b.fn(&cvLock, cv, "CVPixelBufferLockBaseAddress")
	b.fn(&cvUnlock, cv, "CVPixelBufferUnlockBaseAddress")
	b.fn(&cvBase, cv, "CVPixelBufferGetBaseAddressOfPlane")
	b.fn(&cvBPR, cv, "CVPixelBufferGetBytesPerRowOfPlane")
	b.fn(&cvPoolCreate, cv, "CVPixelBufferPoolCreatePixelBuffer")
	b.fn(&vtCreate, vt, "VTCompressionSessionCreate")
	b.fn(&vtSet, vt, "VTSessionSetProperty")
	b.fn(&vtCopy, vt, "VTSessionCopyProperty")
	b.fn(&vtPrepare, vt, "VTCompressionSessionPrepareToEncodeFrames")
	b.fn(&vtEncode, vt, "VTCompressionSessionEncodeFrame")
	b.fn(&vtComplete, vt, "VTCompressionSessionCompleteFrames")
	b.fn(&vtInvalidate, vt, "VTCompressionSessionInvalidate")
	b.fn(&vtPool, vt, "VTCompressionSessionGetPixelBufferPool")
	b.fn(&cgPreflight, cg, "CGPreflightScreenCaptureAccess")
	b.fn(&cgActiveList, cg, "CGGetActiveDisplayList")
	b.fn(&cgMainDisplay, cg, "CGMainDisplayID")
	b.fn(&cgMirrors, cg, "CGDisplayMirrorsDisplay")
	b.fn(&cgBounds, cg, "CGDisplayBounds")
	b.fn(&cgCopyMode, cg, "CGDisplayCopyDisplayMode")
	b.fn(&cgModePixelW, cg, "CGDisplayModeGetPixelWidth")
	b.fn(&cgModePixelH, cg, "CGDisplayModeGetPixelHeight")
	b.fn(&cgModeRelease, cg, "CGDisplayModeRelease")
	b.fn(&cgSessionCopyDc, cg, "CGSessionCopyCurrentDictionary")

	kNotSync = b.konst(cm, "kCMSampleAttachmentKey_NotSync")
	kSCKStatus = b.konst(sck, "SCStreamFrameInfoStatus")
	kIOSurface = b.konst(cv, "kCVPixelBufferIOSurfacePropertiesKey")
	kPixFmt = b.konst(cv, "kCVPixelBufferPixelFormatTypeKey")
	kPixW = b.konst(cv, "kCVPixelBufferWidthKey")
	kPixH = b.konst(cv, "kCVPixelBufferHeightKey")
	kRealTime = b.konst(vt, "kVTCompressionPropertyKey_RealTime")
	kProfile = b.konst(vt, "kVTCompressionPropertyKey_ProfileLevel")
	kBaseline = b.konst(vt, "kVTProfileLevel_H264_Baseline_AutoLevel")
	kReorder = b.konst(vt, "kVTCompressionPropertyKey_AllowFrameReordering")
	kAvgBitRate = b.konst(vt, "kVTCompressionPropertyKey_AverageBitRate")
	kRateLimits = b.konst(vt, "kVTCompressionPropertyKey_DataRateLimits")
	kMaxKeyDur = b.konst(vt, "kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration")
	kExpFPS = b.konst(vt, "kVTCompressionPropertyKey_ExpectedFrameRate")
	kForceKey = b.konst(vt, "kVTEncodeFrameOptionKey_ForceKeyFrame")
	kUsingHW = b.konst(vt, "kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder")
	kRequireHW = b.konst(vt, "kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder")
	kEnableHW = b.konst(vt, "kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder")
	kMatrix = b.konst(vt, "kVTCompressionPropertyKey_YCbCrMatrix")
	kPrimaries = b.konst(vt, "kVTCompressionPropertyKey_ColorPrimaries")
	kTransfer = b.konst(vt, "kVTCompressionPropertyKey_TransferFunction")
	kVT709 = b.konst(cv, "kCVImageBufferYCbCrMatrix_ITU_R_709_2")
	kVTP709 = b.konst(cv, "kCVImageBufferColorPrimaries_ITU_R_709_2")
	kVTT709 = b.konst(cv, "kCVImageBufferTransferFunction_ITU_R_709_2")
	kSCKMatrix = b.konst(cg, "kCGDisplayStreamYCbCrMatrix_ITU_R_709_2")
	kSRGB = b.konst(cg, "kCGColorSpaceSRGB")
	if len(b.errs) > 0 {
		return errors.Join(append([]error{errFrameworks}, b.errs...)...)
	}
	return nil
}
