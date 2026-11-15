package capture

import (
	"errors"
	"fmt"
)

// Reason ekran yakalama hatasının sabit, kişisel veri içermeyen neden kodu (istemci 0.10.2). Müşteri durum satırında
// ve tanılama logunda (internal/diag) gösterilir; 0.11.0'dan (AC-234) itibaren `share.state.reason` ile teknisyen
// konsoluna da gider. Değerler contracts `SHARE_FAIL_REASON_PATTERN` (`^[A-Z0-9_]{1,32}$`) ile uyumludur.
type Reason string

const (
	ReasonDXGIUnsupported   Reason = "DXGI_UNSUPPORTED"    // DuplicateOutput desteklenmiyor (hibrit GPU, HDR, eski sürücü)
	ReasonDXGIAccessDenied  Reason = "DXGI_ACCESS_DENIED"  // güvenli masaüstü / kilit ekranı / oturum
	ReasonDXGINotAvailable  Reason = "DXGI_NOT_AVAILABLE"  // çoğaltma sınırı, tam ekran uygulama, uzak masaüstü
	ReasonNoOutput          Reason = "NO_OUTPUT"           // monitör DXGI çıkışında/GDI'da bulunamadı
	ReasonD3DDevice         Reason = "D3D_DEVICE"          // D3D11 cihazı oluşturulamadı
	ReasonFirstFrameTimeout Reason = "FIRST_FRAME_TIMEOUT" // çoğaltma açıldı ama süresinde kare gelmedi
	ReasonGDI               Reason = "GDI_FAILED"          // GDI yedek yakalama da başarısız
	ReasonMFStartup         Reason = "MF_STARTUP"          // Media Foundation yok (Windows N, Media Feature Pack)
	ReasonNoH264Encoder     Reason = "NO_H264_ENCODER"     // donanım ve yazılım H.264 kodlayıcı yok
	ReasonEncoderConfig     Reason = "ENCODER_CONFIG"      // kodlayıcı türleri/parametreleri kabul etmedi
	ReasonEncodeFailed      Reason = "ENCODE_FAILED"       // yayın sırasında kodlama hatası
	// AC-248 pencere modu (WGC, P17 I4).
	ReasonWGCUnsupported    Reason = "WGC_UNSUPPORTED"    // Windows.Graphics.Capture yok (Windows 10 1903 öncesi, Server Core)
	ReasonWindowClosed      Reason = "WINDOW_CLOSED"      // paylaşılan pencere kapandı
	ReasonWindowUnavailable Reason = "WINDOW_UNAVAILABLE" // pencere yakalamaya açılamadı (CreateForWindow reddetti)
	ReasonOther             Reason = "OTHER"
)

// Error tipli yakalama hatası. Op sabit işlem adıdır (ör. "DuplicateOutput"); HR varsa HRESULT. Method hatanın
// ait olduğu yakalama yoludur (boşsa bilinmiyor; ShareMethod nedenden çıkarır).
type Error struct {
	Reason Reason
	Op     string
	HR     uint32
	Method Method
}

// ShareMethod AC-234 `share.state.method` değeri (contracts `SHARE_METHODS`: DXGI | GDI | WGC). DXGI1
// (DuplicateOutput1) DXGI ailesidir. Method boşsa yalnız nedenin kesin belirlediği yol döner (GDI_FAILED → GDI;
// DXGI_*, D3D_DEVICE, FIRST_FRAME_TIMEOUT → DXGI); belirlenemezse "" (alan gönderilmez).
func (e *Error) ShareMethod() string {
	switch e.Method {
	case MethodDXGI, MethodDXGI1:
		return string(MethodDXGI)
	case MethodGDI:
		return string(MethodGDI)
	case MethodWGC:
		return string(MethodWGC)
	}
	switch e.Reason {
	case ReasonWGCUnsupported, ReasonWindowClosed, ReasonWindowUnavailable:
		return string(MethodWGC)
	case ReasonGDI:
		return string(MethodGDI)
	case ReasonDXGIUnsupported, ReasonDXGIAccessDenied, ReasonDXGINotAvailable, ReasonD3DDevice, ReasonFirstFrameTimeout:
		return string(MethodDXGI)
	}
	return ""
}

// windowFinal pencere modunda kalıcı neden: yeniden açmak düzeltmez, paylaşım durur (share.state stopped).
func windowFinal(err error) bool {
	e, ok := AsError(err)
	return ok && (e.Reason == ReasonWindowClosed || e.Reason == ReasonWindowUnavailable || e.Reason == ReasonWGCUnsupported)
}

func (e *Error) Error() string {
	if e.HR != 0 {
		return fmt.Sprintf("capture: %s: %s (0x%08X)", e.Op, e.Reason, e.HR)
	}
	return fmt.Sprintf("capture: %s: %s", e.Op, e.Reason)
}

// Code durum satırı için kod: OTHER'da HRESULT eklenir (başka türlü ayırt edilemez).
func (e *Error) Code() string {
	if e.Reason == ReasonOther && e.HR != 0 {
		return fmt.Sprintf("%s 0x%08X", e.Reason, e.HR)
	}
	return string(e.Reason)
}

// stage hatanın oluştuğu adım; aynı HRESULT farklı adımda farklı neden olabilir.
type stage int

const (
	stageCOM stage = iota
	stageMF
	stageOutput
	stageDevice
	stageDuplicate
	stageFirstFrame
	stageGDI
	stageEncoderCreate
	stageEncoderConfig
	stageEncode
)

// Bilinen HRESULT'lar (winerror.h).
const (
	hrEAccessDenied          uint32 = 0x80070005
	hrENoInterface           uint32 = 0x80004002
	hrDXGIUnsupported        uint32 = 0x887A0004
	hrDXGINotCurrentlyAvail  uint32 = 0x887A0022
	hrDXGISessionDisconnectd uint32 = 0x887A0028
)

// classify adım + HRESULT → neden kodu.
func classify(st stage, hr uint32) Reason {
	switch st {
	case stageMF:
		return ReasonMFStartup
	case stageOutput:
		return ReasonNoOutput
	case stageDevice:
		if hr == hrEAccessDenied {
			return ReasonDXGIAccessDenied
		}
		return ReasonD3DDevice
	case stageDuplicate:
		switch hr {
		case hrDXGIUnsupported, hrENoInterface:
			return ReasonDXGIUnsupported
		case hrEAccessDenied:
			return ReasonDXGIAccessDenied
		case hrDXGINotCurrentlyAvail, hrDXGISessionDisconnectd:
			return ReasonDXGINotAvailable
		}
	case stageFirstFrame:
		return ReasonFirstFrameTimeout
	case stageGDI:
		return ReasonGDI
	case stageEncoderCreate:
		return ReasonNoH264Encoder
	case stageEncoderConfig:
		return ReasonEncoderConfig
	case stageEncode:
		return ReasonEncodeFailed
	}
	return ReasonOther
}

// tag hatayı adımına göre sınıflandırır: *Error ise işlem adı ve HRESULT korunur; değilse yalnız op ile yeni hata
// (yabancı hata metni — ör. DLL yükleme iletisi — kayda girmez).
func tag(err error, st stage, op string) *Error {
	if err == nil {
		return nil
	}
	var e *Error
	if errors.As(err, &e) {
		c := *e
		if c.Op == "" {
			c.Op = op
		}
		c.Reason = classify(st, c.HR)
		return &c
	}
	return &Error{Reason: classify(st, 0), Op: op}
}

// AsError hatadan tipli yakalama hatasını çıkarır.
func AsError(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}
