//go:build windows && (amd64 || arm64)

package capture

import (
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// P17 I0 (D-WGC prototipi, K-E11-3): tek pencerenin Windows.Graphics.Capture ile yakalanması. CGO'suz ve yeni
// bağımlılıksız; WinRT çağrıları com_windows.go'daki elle vtable kalıbıyla yapılır. Akış:
//
//	D3D11CreateDevice(BGRA) → IDXGIDevice → CreateDirect3D11DeviceFromDXGIDevice → IDirect3DDevice (WinRT)
//	RoGetActivationFactory("…GraphicsCaptureItem", IGraphicsCaptureItemInterop) → CreateForWindow(hwnd) → IGraphicsCaptureItem
//	RoGetActivationFactory("…Direct3D11CaptureFramePool", Statics2) → CreateFreeThreaded → CreateCaptureSession → StartCapture
//	TryGetNextFrame → Surface → IDirect3DDxgiInterfaceAccess → ID3D11Texture2D → staging → Map (dxgi_windows.go ile aynı)
//
// Sınıfların hiçbiri varsayılan kurucuyla etkinleştirilmez; RoActivateInstance yerine statik fabrikalar
// (RoGetActivationFactory) kullanılır. Çağıran, iş parçacığını kilitlemiş ve COM'u MTA başlatmış olmalıdır
// (source.run'daki CoInitializeEx MTA, RoInitialize(RO_INIT_MULTITHREADED) ile eşdeğerdir). Çerçeve havuzu serbest
// iş parçacıklıdır (Windows 10 1903+): DispatcherQueue ya da olay işleyicisi gerekmez, yoklama yeterlidir.
// SizeInt32 değerle geçirilir: amd64 ve arm64 ABI'sinde 8 baytlık yapı tek tamsayı yazmacındadır (build tag bu yüzden).
//
// Arayüz kimlikleri ve vtable sıraları Windows SDK meta verisinden (mingw-w64 windows.graphics.capture.h,
// windows.graphics.capture.interop.h, windows.graphics.directx.direct3d11.h, windows.foundation.h) doğrulanmıştır.
// IInspectable türevlerinde 0–2 IUnknown, 3–5 GetIids/GetRuntimeClassName/GetTrustLevel; arayüz yöntemleri 6'dan başlar.

var (
	modCombase = windows.NewLazySystemDLL("combase.dll")

	pRoGetActivationFactory = modCombase.NewProc("RoGetActivationFactory")
	pWindowsCreateString    = modCombase.NewProc("WindowsCreateString")
	pWindowsDeleteString    = modCombase.NewProc("WindowsDeleteString")
	pCreateD3D11FromDXGI    = modD3D11.NewProc("CreateDirect3D11DeviceFromDXGIDevice")
)

var (
	iidIDXGIDevice                    = guid(0x54ec77fa, 0x1377, 0x44e6, 0x8c, 0x32, 0x88, 0xfd, 0x5f, 0x44, 0xc8, 0x4c)
	iidIDirect3DDevice                = guid(0xa37624ab, 0x8d5f, 0x4650, 0x9d, 0x3e, 0x9e, 0xae, 0x3d, 0x9b, 0xc6, 0x70)
	iidIDirect3DDxgiInterfaceAccess   = guid(0xa9b3d012, 0x3df2, 0x4ee3, 0xb8, 0xd1, 0x86, 0x95, 0xf4, 0x57, 0xd3, 0xc1)
	iidIGraphicsCaptureItemInterop    = guid(0x3628e81b, 0x3cac, 0x4c60, 0xb7, 0xf4, 0x23, 0xce, 0x0e, 0x0c, 0x33, 0x56)
	iidIGraphicsCaptureItem           = guid(0x79c3f95b, 0x31f7, 0x4ec2, 0xa4, 0x64, 0x63, 0x2e, 0xf5, 0xd3, 0x07, 0x60)
	iidIGraphicsCaptureSessionStatics = guid(0x2224a540, 0x5974, 0x49aa, 0xb2, 0x32, 0x08, 0x82, 0x53, 0x6f, 0x4c, 0xb5)
	iidIDirect3D11CaptureFramePoolSt2 = guid(0x589b103f, 0x6bbc, 0x5df5, 0xa9, 0x91, 0x02, 0xe2, 0x8b, 0x3b, 0x66, 0xd5)
	iidIClosable                      = guid(0x30d5a829, 0x7fa4, 0x4026, 0x83, 0xbb, 0xd7, 0x5b, 0xae, 0x4e, 0xa9, 0x9e)
)

const (
	classGraphicsCaptureItem        = "Windows.Graphics.Capture.GraphicsCaptureItem"
	classGraphicsCaptureSession     = "Windows.Graphics.Capture.GraphicsCaptureSession"
	classDirect3D11CaptureFramePool = "Windows.Graphics.Capture.Direct3D11CaptureFramePool"

	wgcPoolBuffers               = 2
	wgcPixelFormat               = dxgiFormatB8G8R8A8 // DirectXPixelFormat.B8G8R8A8UIntNormalized = 87
	d3dDriverTypeHardware        = 1
	d3dDriverTypeWARP            = 5
	d3d11CreateDeviceBGRASupport = 0x20
	wgcPollInterval              = 5 * time.Millisecond

	vtInteropCreateForWindow  = 3  // IGraphicsCaptureItemInterop (IUnknown türevi)
	vtDxgiAccessGetInterface  = 3  // IDirect3DDxgiInterfaceAccess (IUnknown türevi)
	vtSessionStaticsSupported = 6  // IGraphicsCaptureSessionStatics.IsSupported
	vtPoolStatics2CreateFT    = 6  // IDirect3D11CaptureFramePoolStatics2.CreateFreeThreaded
	vtPoolRecreate            = 6  // IDirect3D11CaptureFramePool.Recreate
	vtPoolTryGetNextFrame     = 7  // IDirect3D11CaptureFramePool.TryGetNextFrame
	vtPoolCreateSession       = 10 // IDirect3D11CaptureFramePool.CreateCaptureSession
	vtItemGetSize             = 7  // IGraphicsCaptureItem.get_Size
	vtSessionStartCapture     = 6  // IGraphicsCaptureSession.StartCapture
	vtFrameGetSurface         = 6  // IDirect3D11CaptureFrame.get_Surface
	vtFrameGetContentSize     = 8  // IDirect3D11CaptureFrame.get_ContentSize
	vtClosableClose           = 6  // IClosable.Close
)

type sizeInt32 struct{ W, H int32 }

// packed SizeInt32'yi değerle geçirmek için tek yazmaçlık biçime çevirir (Width düşük 32 bit).
func (s sizeInt32) packed() uintptr { return uintptr(uint32(s.W)) | uintptr(uint32(s.H))<<32 }

// activationFactory sınıfın statik fabrikasını iid arayüzüyle döner. HSTRING çağrı süresince yaşar.
func activationFactory(class string, iid *windows.GUID) (*comObj, error) {
	name, err := windows.UTF16FromString(class)
	if err != nil {
		return nil, &Error{Reason: ReasonOther, Op: "WGC.ClassName"}
	}
	var hs uintptr
	if err := procHR(pWindowsCreateString, "WindowsCreateString", uintptr(unsafe.Pointer(&name[0])), uintptr(len(name)-1),
		uintptr(unsafe.Pointer(&hs))); err != nil {
		return nil, err
	}
	defer func() { _, _, _ = pWindowsDeleteString.Call(hs) }()
	var f *comObj
	if err := procHR(pRoGetActivationFactory, "RoGetActivationFactory", hs, uintptr(unsafe.Pointer(iid)),
		uintptr(unsafe.Pointer(&f))); err != nil {
		return nil, err
	}
	return f, nil
}

// wgcSupported GraphicsCaptureSession.IsSupported: WGC sınıfları yoksa (Windows 10 1803 öncesi, Server Core) veya
// oturum desteklemiyorsa false. combase.dll yoksa hata.
func wgcSupported() (bool, error) {
	st, err := activationFactory(classGraphicsCaptureSession, &iidIGraphicsCaptureSessionStatics)
	if err != nil {
		return false, err
	}
	defer st.release()
	var ok byte // WinRT boolean = 1 bayt
	if hr := st.call(vtSessionStaticsSupported, uintptr(unsafe.Pointer(&ok))); hr.failed() {
		return false, hr.err("GraphicsCaptureSession.IsSupported")
	}
	return ok != 0, nil
}

// wgcWindow tek pencerenin WGC oturumu. Yalnız açıldığı (COM'a bağlı) iş parçacığında kullanılır.
type wgcWindow struct {
	device, ctx, winrtDev, item, pool, session, staging *comObj
	poolSize                                            sizeInt32
	w, h                                                int // son karenin içerik boyutu (staging dokusu ≥ bu)
}

// openWGCWindow hwnd için yakalamayı başlatır. Pencere simge durumundaysa oturum açılır ama kare gelmez; pencere
// kapanınca TryGetNextFrame boş döner (I4: IsWindow/IsIconic ile ayırt edilip kaplama gösterilir).
func openWGCWindow(hwnd uintptr) (*wgcWindow, error) {
	c := &wgcWindow{}
	ok := false
	defer func() {
		if !ok {
			c.close()
		}
	}()
	if err := c.createDevice(); err != nil {
		return nil, err
	}
	interop, err := activationFactory(classGraphicsCaptureItem, &iidIGraphicsCaptureItemInterop)
	if err != nil {
		return nil, err
	}
	defer interop.release()
	if hr := interop.call(vtInteropCreateForWindow, hwnd, uintptr(unsafe.Pointer(&iidIGraphicsCaptureItem)),
		uintptr(unsafe.Pointer(&c.item))); hr.failed() {
		return nil, hr.err("CreateForWindow") // E_INVALIDARG: geçersiz/alt pencere; E_ACCESSDENIED: başka masaüstü
	}
	if hr := c.item.call(vtItemGetSize, uintptr(unsafe.Pointer(&c.poolSize))); hr.failed() {
		return nil, hr.err("GraphicsCaptureItem.Size")
	}
	st2, err := activationFactory(classDirect3D11CaptureFramePool, &iidIDirect3D11CaptureFramePoolSt2)
	if err != nil {
		return nil, err
	}
	defer st2.release()
	if hr := st2.call(vtPoolStatics2CreateFT, uintptr(unsafe.Pointer(c.winrtDev)), wgcPixelFormat, wgcPoolBuffers,
		c.poolSize.packed(), uintptr(unsafe.Pointer(&c.pool))); hr.failed() {
		return nil, hr.err("CreateFreeThreaded")
	}
	if hr := c.pool.call(vtPoolCreateSession, uintptr(unsafe.Pointer(c.item)), uintptr(unsafe.Pointer(&c.session))); hr.failed() {
		return nil, hr.err("CreateCaptureSession")
	}
	if hr := c.session.call(vtSessionStartCapture); hr.failed() {
		return nil, hr.err("StartCapture")
	}
	ok = true
	return c, nil
}

// createDevice BGRA destekli D3D11 cihazı (donanım; yoksa WARP) ve onu saran WinRT IDirect3DDevice'ı oluşturur.
func (c *wgcWindow) createDevice() error {
	var err error
	for _, drv := range []uintptr{d3dDriverTypeHardware, d3dDriverTypeWARP} {
		if err = procHR(pD3D11CreateDevice, "D3D11CreateDevice", 0, drv, 0, d3d11CreateDeviceBGRASupport, 0, 0,
			d3d11SDKVersion, uintptr(unsafe.Pointer(&c.device)), 0, uintptr(unsafe.Pointer(&c.ctx))); err == nil {
			break
		}
	}
	if err != nil {
		return tag(err, stageDevice, "D3D11CreateDevice")
	}
	dxgiDev, err := c.device.query(&iidIDXGIDevice)
	if err != nil {
		return err
	}
	defer dxgiDev.release()
	var insp *comObj
	if err := procHR(pCreateD3D11FromDXGI, "CreateDirect3D11DeviceFromDXGIDevice", uintptr(unsafe.Pointer(dxgiDev)),
		uintptr(unsafe.Pointer(&insp))); err != nil {
		return err
	}
	defer insp.release()
	c.winrtDev, err = insp.query(&iidIDirect3DDevice)
	return err
}

// acquire en çok timeoutMs boyunca yeni kare yoklar; gelirse BGRA yüzeyi (içerik boyutunda) fn'e verir ve true döner.
// Kare gelmezse false, nil (pencere simge durumunda, değişmemiş ya da kapanmış). Arayüz duplicator.acquire ile
// aynıdır; I4 bu türü source içindeki yakalayıcı arayüzüne bağlar.
func (c *wgcWindow) acquire(timeoutMs uint32, fn func(px []byte, w, h, pitch int) error) (bool, error) {
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	for {
		var frame *comObj
		if hr := c.pool.call(vtPoolTryGetNextFrame, uintptr(unsafe.Pointer(&frame))); hr.failed() {
			return false, hr.err("TryGetNextFrame")
		}
		if frame != nil {
			return c.consume(frame, fn)
		}
		if !time.Now().Before(deadline) {
			return false, nil
		}
		time.Sleep(wgcPollInterval)
	}
}

func (c *wgcWindow) consume(frame *comObj, fn func(px []byte, w, h, pitch int) error) (bool, error) {
	defer closeAndRelease(frame)
	var content sizeInt32
	if hr := frame.call(vtFrameGetContentSize, uintptr(unsafe.Pointer(&content))); hr.failed() {
		return false, hr.err("Frame.ContentSize")
	}
	if err := c.copyFrame(frame); err != nil {
		return false, err
	}
	// Pencere boyutu değiştiyse havuz yeni boyutla yeniden kurulur; bu kare eski dokudan kırpılarak verilir.
	if content.W > 0 && content.H > 0 && content != c.poolSize {
		if hr := c.pool.call(vtPoolRecreate, uintptr(unsafe.Pointer(c.winrtDev)), wgcPixelFormat, wgcPoolBuffers,
			content.packed()); hr.failed() {
			return false, hr.err("FramePool.Recreate")
		}
		c.poolSize = content
	}
	var m d3d11Mapped
	if hr := c.ctx.call(vtCtxMap, uintptr(unsafe.Pointer(c.staging)), 0, d3d11MapRead, 0, uintptr(unsafe.Pointer(&m))); hr.failed() {
		return false, hr.err("Map")
	}
	defer c.ctx.call(vtCtxUnmap, uintptr(unsafe.Pointer(c.staging)), 0)
	w, h := min(int(content.W), c.w), min(int(content.H), c.h)
	pitch := int(m.RowPitch)
	if m.Data == nil || w <= 0 || h <= 0 || pitch < w*4 {
		return false, errBadFrame
	}
	if err := fn(unsafe.Slice(m.Data, pitch*(h-1)+w*4), w, h, pitch); err != nil {
		return false, err
	}
	return true, nil
}

// copyFrame kare yüzeyini staging dokusuna kopyalar; doku boyutu değiştiyse staging yeniden oluşturulur.
func (c *wgcWindow) copyFrame(frame *comObj) error {
	var surface *comObj
	if hr := frame.call(vtFrameGetSurface, uintptr(unsafe.Pointer(&surface))); hr.failed() {
		return hr.err("Frame.Surface")
	}
	defer surface.release()
	access, err := surface.query(&iidIDirect3DDxgiInterfaceAccess)
	if err != nil {
		return err
	}
	defer access.release()
	var tex *comObj
	if hr := access.call(vtDxgiAccessGetInterface, uintptr(unsafe.Pointer(&iidID3D11Texture2D)), uintptr(unsafe.Pointer(&tex))); hr.failed() {
		return hr.err("GetInterface")
	}
	defer tex.release()
	var td d3d11Texture2DDesc
	tex.call(vtTexture2DGetDesc, uintptr(unsafe.Pointer(&td)))
	if c.staging != nil && (int(td.Width) != c.w || int(td.Height) != c.h) {
		c.staging.release()
		c.staging = nil
	}
	if c.staging == nil {
		td.MipLevels, td.ArraySize, td.SampleCount, td.SampleQuality = 1, 1, 1, 0
		td.Usage, td.BindFlags, td.CPUAccessFlags, td.MiscFlags = d3d11UsageStaging, 0, d3d11CPUAccessRead, 0
		if hr := c.device.call(vtDeviceCreateTexture2D, uintptr(unsafe.Pointer(&td)), 0, uintptr(unsafe.Pointer(&c.staging))); hr.failed() {
			return hr.err("CreateTexture2D")
		}
		c.w, c.h = int(td.Width), int(td.Height)
	}
	c.ctx.call(vtCtxCopyResource, uintptr(unsafe.Pointer(c.staging)), uintptr(unsafe.Pointer(tex)))
	return nil
}

// closeAndRelease IClosable olan WinRT nesnesini (kare, havuz, oturum) kapatıp bırakır.
func closeAndRelease(o *comObj) {
	if o == nil {
		return
	}
	if cl, err := o.query(&iidIClosable); err == nil {
		cl.call(vtClosableClose)
		cl.release()
	}
	o.release()
}

func (c *wgcWindow) close() {
	closeAndRelease(c.session)
	closeAndRelease(c.pool)
	c.item.release()
	c.winrtDev.release()
	c.staging.release()
	c.ctx.release()
	c.device.release()
	c.session, c.pool, c.item, c.winrtDev, c.staging, c.ctx, c.device = nil, nil, nil, nil, nil, nil, nil
}
