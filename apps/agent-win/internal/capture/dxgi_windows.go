//go:build windows

package capture

import (
	"encoding/binary"
	"unsafe"

	"golang.org/x/sys/windows"
)

// vtable dizinleri (SDK başlıklarından; mingw-w64 dxgi.h, dxgi1_2.h, dxgi1_5.h, dxgi1_6.h, d3d11.h).
const (
	vtFactory1EnumAdapters1 = 12
	vtAdapterEnumOutputs    = 7
	vtAdapter1GetDesc1      = 10
	vtOutputGetDesc         = 7
	vtOutput1DuplicateOut   = 22
	vtOutput5DuplicateOut1  = 26
	vtOutput6GetDesc1       = 27
	vtDuplGetDesc           = 7
	vtDuplAcquireNextFrame  = 8
	vtDuplGetDirtyRects     = 9
	vtDuplGetMoveRects      = 10
	vtDuplGetPointerShape   = 11
	vtDuplReleaseFrame      = 14
	vtDeviceCreateTexture2D = 5
	vtTexture2DGetDesc      = 10
	vtCtxMap                = 14
	vtCtxUnmap              = 15
	vtCtxCopyResource       = 47
)

const (
	dxgiErrNotFound    hresult = -0x7785FFFE // 0x887A0002
	dxgiErrWaitTimeout hresult = -0x7785FFD9 // 0x887A0027

	d3dDriverTypeUnknown = 0
	d3d11SDKVersion      = 7
	d3d11UsageStaging    = 3
	d3d11CPUAccessRead   = 0x20000
	d3d11MapRead         = 1

	dxgiFormatB8G8R8A8     = 87 // DXGI_FORMAT_B8G8R8A8_UNORM
	dxgiFormatB8G8R8A8SRGB = 91 // DXGI_FORMAT_B8G8R8A8_UNORM_SRGB (aynı bayt düzeni)
)

type dxgiOutputDesc struct {
	DeviceName         [32]uint16
	DesktopCoordinates struct{ Left, Top, Right, Bottom int32 }
	AttachedToDesktop  int32
	Rotation           uint32
	Monitor            uintptr
}

type dxgiOutduplDesc struct {
	Width, Height    uint32
	RefreshNum       uint32
	RefreshDen       uint32
	Format           uint32
	ScanlineOrdering uint32
	Scaling          uint32
	Rotation         uint32
	DesktopInSysMem  int32
}

type dxgiOutduplFrameInfo struct {
	LastPresentTime         int64
	LastMouseUpdateTime     int64
	AccumulatedFrames       uint32
	RectsCoalesced          int32
	ProtectedContentMasked  int32
	PointerX, PointerY      int32
	PointerVisible          int32
	TotalMetadataBufferSize uint32
	PointerShapeBufferSize  uint32
}

type dxgiOutduplPointerShapeInfo struct {
	Type, Width, Height, Pitch uint32
	HotSpotX, HotSpotY         int32
}

type d3d11Texture2DDesc struct {
	Width, Height, MipLevels, ArraySize uint32
	Format                              uint32
	SampleCount, SampleQuality          uint32
	Usage, BindFlags, CPUAccessFlags    uint32
	MiscFlags                           uint32
}

type d3d11Mapped struct {
	Data       *byte
	RowPitch   uint32
	DepthPitch uint32
}

// duplicator tek monitörün DXGI Desktop Duplication oturumu. Yalnız kendi (COM'a bağlı) iş parçacığında kullanılır.
type duplicator struct {
	device, ctx, dup, staging *comObj
	w, h                      int // yakalanan yüzey (döndürülmemiş)
	rot                       Rotation
	cur                       Cursor // son bildirilen imleç (konum + şekil); kareye bindirmeyi çağıran yapar
	shapeBuf                  []byte
	dmg                       Damage // son acquire'ın değişen bölgesi (fn içinde geçerli; AC-246)
	meta                      []byte // GetFrameMoveRects/GetFrameDirtyRects tamponu (yeniden kullanılır)
	rects                     []Rect
}

// openDuplicator GDI aygıt adı (\\.\DISPLAYn) eşleşen DXGI çıkışı için D3D11 cihazı ve çoğaltma oturumu açar.
// dup1=false: IDXGIOutput1::DuplicateOutput (yalnız BGRA masaüstü; HDR/gelişmiş renkte ve bazı hibrit GPU
// yapılandırmalarında DXGI_ERROR_UNSUPPORTED). dup1=true: IDXGIOutput5::DuplicateOutput1 yalnız
// DXGI_FORMAT_B8G8R8A8_UNORM'u destekleyen format listesiyle (Windows 10 1703+); HDR masaüstü sisteme BGRA'ya
// çevrilerek verilir, mevcut BGRA→NV12 hattı değişmez. Süreç manifestte Per-Monitor V2 DPI farkındadır (DuplicateOutput1
// bunu ister); yüzey fiziksel piksel boyutundadır. Hatalar adımına göre sınıflandırılır (reason.go).
func openDuplicator(device string, dup1 bool) (*duplicator, error) {
	var factory *comObj
	if err := procHR(pCreateDXGIFactory1, "CreateDXGIFactory1", uintptr(unsafe.Pointer(&iidIDXGIFactory1)),
		uintptr(unsafe.Pointer(&factory))); err != nil {
		return nil, tag(err, stageDevice, "CreateDXGIFactory1")
	}
	defer factory.release()
	_, adapter, output, rot := findOutput(factory, device)
	if output == nil {
		return nil, &Error{Reason: ReasonNoOutput, Op: "FindOutput"}
	}
	defer adapter.release()
	defer output.release()
	d := &duplicator{rot: rot}
	if err := procHR(pD3D11CreateDevice, "D3D11CreateDevice", uintptr(unsafe.Pointer(adapter)), d3dDriverTypeUnknown, 0, 0,
		0, 0, d3d11SDKVersion, uintptr(unsafe.Pointer(&d.device)), 0, uintptr(unsafe.Pointer(&d.ctx))); err != nil {
		return nil, tag(err, stageDevice, "D3D11CreateDevice")
	}
	if err := d.duplicate(output, dup1); err != nil {
		d.close()
		return nil, tag(err, stageDuplicate, "DuplicateOutput")
	}
	var dd dxgiOutduplDesc
	d.dup.call(vtDuplGetDesc, uintptr(unsafe.Pointer(&dd)))
	if dd.Rotation >= 2 && dd.Rotation <= 4 { // DXGI_MODE_ROTATION_ROTATE90/180/270
		d.rot = Rotation(dd.Rotation - 1)
	}
	return d, nil
}

func (d *duplicator) duplicate(output *comObj, dup1 bool) error {
	if !dup1 {
		out1, err := output.query(&iidIDXGIOutput1)
		if err != nil {
			return err
		}
		defer out1.release()
		if hr := out1.call(vtOutput1DuplicateOut, uintptr(unsafe.Pointer(d.device)), uintptr(unsafe.Pointer(&d.dup))); hr.failed() {
			return hr.err("DuplicateOutput")
		}
		return nil
	}
	out5, err := output.query(&iidIDXGIOutput5)
	if err != nil {
		return err
	}
	defer out5.release()
	formats := [1]uint32{dxgiFormatB8G8R8A8}
	if hr := out5.call(vtOutput5DuplicateOut1, uintptr(unsafe.Pointer(d.device)), 0, uintptr(len(formats)),
		uintptr(unsafe.Pointer(&formats[0])), uintptr(unsafe.Pointer(&d.dup))); hr.failed() {
		return hr.err("DuplicateOutput1")
	}
	return nil
}

func (d *duplicator) rotation() Rotation { return d.rot }

func (d *duplicator) cursor() *Cursor { return &d.cur }

// findOutput aygıt adı eşleşen çıkışı ve adaptörünü (sırası ai) döner; bulunamazsa output nil.
func findOutput(factory *comObj, device string) (ai int, adapter, output *comObj, rot Rotation) {
	for ; ; ai++ {
		var a *comObj
		if hr := factory.call(vtFactory1EnumAdapters1, uintptr(ai), uintptr(unsafe.Pointer(&a))); hr.failed() {
			return -1, nil, nil, RotNone
		}
		for oi := uintptr(0); ; oi++ {
			var o *comObj
			if hr := a.call(vtAdapterEnumOutputs, oi, uintptr(unsafe.Pointer(&o))); hr.failed() {
				break
			}
			var desc dxgiOutputDesc
			if hr := o.call(vtOutputGetDesc, uintptr(unsafe.Pointer(&desc))); !hr.failed() &&
				windows.UTF16ToString(desc.DeviceName[:]) == device {
				if desc.Rotation >= 2 && desc.Rotation <= 4 {
					rot = Rotation(desc.Rotation - 1)
				}
				return ai, a, o, rot
			}
			o.release()
		}
		a.release()
	}
}

// acquire en çok timeoutMs bekler; masaüstü görüntüsü veya imleç (konum, görünürlük, şekil) değiştiyse yüzeyi
// eşleyip fn'e verir (fn dönene kadar geçerli) ve true döner. Yalnız imleç değiştiyse yeni kare kopyalanmaz; staging
// dokusu son masaüstü görüntüsünü tuttuğundan o yeniden eşlenir. Zaman aşımında ya da görüntü birikmemişse
// (AccumulatedFrames == 0 ve LastPresentTime == 0) ve imleç de değişmediyse kare atlanır: false, nil (AC-246).
// Yeni görüntüde değişen bölge (damage) kirli/taşıma dikdörtgenlerinden çıkarılır. Diğer hatalar (ACCESS_LOST,
// masaüstü değişimi, cihaz kaybı) çağırana döner; çağıran oturumu kapatıp yeniden kurar.
func (d *duplicator) acquire(timeoutMs uint32, fn func(px []byte, w, h, pitch int) error) (bool, error) {
	var info dxgiOutduplFrameInfo
	var res *comObj
	hr := d.dup.call(vtDuplAcquireNextFrame, uintptr(timeoutMs), uintptr(unsafe.Pointer(&info)), uintptr(unsafe.Pointer(&res)))
	if hr == dxgiErrWaitTimeout {
		return false, nil
	}
	if hr.failed() {
		return false, hr.err("AcquireNextFrame")
	}
	defer d.dup.call(vtDuplReleaseFrame)
	defer res.release()
	pointer, err := d.updatePointer(&info)
	if err != nil {
		return false, err
	}
	if info.AccumulatedFrames != 0 || info.LastPresentTime != 0 {
		if err := d.copyFrame(res); err != nil {
			return false, err
		}
		d.dmg = d.frameDamage(&info)
	} else if !pointer || d.staging == nil {
		return false, nil
	} else {
		d.dmg = Damage{} // görüntü aynı; yalnız imleç
	}
	var m d3d11Mapped
	if hr := d.ctx.call(vtCtxMap, uintptr(unsafe.Pointer(d.staging)), 0, d3d11MapRead, 0, uintptr(unsafe.Pointer(&m))); hr.failed() {
		return false, hr.err("Map")
	}
	defer d.ctx.call(vtCtxUnmap, uintptr(unsafe.Pointer(d.staging)), 0)
	pitch := int(m.RowPitch)
	if m.Data == nil || pitch < d.w*4 {
		return false, errBadFrame
	}
	if err := fn(unsafe.Slice(m.Data, pitch*(d.h-1)+d.w*4), d.w, d.h, pitch); err != nil {
		return false, err
	}
	return true, nil
}

// damage son acquire'ın değişen bölgesi (frameConv; fn içinde çağrılır).
func (d *duplicator) damage() Damage { return d.dmg }

// frameDamage kirli dikdörtgenleri (yüzey koordinatı) okur. Taşıma dikdörtgeni varsa, meta veri yoksa/okunamazsa ya da
// dikdörtgen sayısı maxDirtyRects'i aşarsa tam dönüşüm (Full) istenir (mimari §8.1 AC-246).
func (d *duplicator) frameDamage(info *dxgiOutduplFrameInfo) Damage {
	n := int(info.TotalMetadataBufferSize)
	if n == 0 {
		return Damage{Full: true}
	}
	if cap(d.meta) < n {
		d.meta = make([]byte, n)
	}
	buf := d.meta[:n]
	var need uint32
	if hr := d.dup.call(vtDuplGetMoveRects, uintptr(n), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&need))); hr.failed() || need != 0 {
		return Damage{Full: true}
	}
	need = 0
	if hr := d.dup.call(vtDuplGetDirtyRects, uintptr(n), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&need))); hr.failed() {
		return Damage{Full: true}
	}
	count := int(need) / 16 // RECT: 4 × int32
	if count == 0 || count > maxDirtyRects || int(need) > n {
		return Damage{Full: true}
	}
	d.rects = d.rects[:0]
	for i := 0; i < count; i++ {
		r := buf[i*16:]
		d.rects = append(d.rects, Rect{
			X0: int(int32(binary.LittleEndian.Uint32(r[0:]))), Y0: int(int32(binary.LittleEndian.Uint32(r[4:]))),
			X1: int(int32(binary.LittleEndian.Uint32(r[8:]))), Y1: int(int32(binary.LittleEndian.Uint32(r[12:]))),
		})
	}
	return Damage{Rects: d.rects}
}

// updatePointer karedeki imleç bilgisini d.cur'a işler; görünen imleç değiştiyse true. Konum ve görünürlük yalnız
// LastMouseUpdateTime ≠ 0 iken geçerlidir. İmleç başka monitördeyse bu çıktının çoğaltması Visible=false bildirir;
// böylece imleç yalnız bulunduğu monitörün görüntüsüne çizilir.
func (d *duplicator) updatePointer(info *dxgiOutduplFrameInfo) (bool, error) {
	changed := false
	if info.LastMouseUpdateTime != 0 {
		vis := info.PointerVisible != 0
		x, y := int(info.PointerX), int(info.PointerY)
		changed = vis != d.cur.Visible || (vis && (x != d.cur.X || y != d.cur.Y))
		d.cur.Visible, d.cur.X, d.cur.Y = vis, x, y
	}
	if info.PointerShapeBufferSize == 0 {
		return changed, nil
	}
	size := int(info.PointerShapeBufferSize)
	if cap(d.shapeBuf) < size {
		d.shapeBuf = make([]byte, size)
	}
	buf := d.shapeBuf[:size]
	var need uint32
	var si dxgiOutduplPointerShapeInfo
	if hr := d.dup.call(vtDuplGetPointerShape, uintptr(size), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&need)),
		uintptr(unsafe.Pointer(&si))); hr.failed() {
		return false, hr.err("GetFramePointerShape")
	}
	d.cur.Shape = PointerShape{Type: si.Type, W: int(si.Width), H: int(si.Height), Pitch: int(si.Pitch), Data: buf}
	return changed || d.cur.Visible, nil
}

// copyFrame yeni masaüstü yüzeyini CPU'dan okunabilir staging dokusuna kopyalar (ilk karede dokuyu oluşturur).
func (d *duplicator) copyFrame(res *comObj) error {
	tex, err := res.query(&iidID3D11Texture2D)
	if err != nil {
		return err
	}
	defer tex.release()
	if d.staging == nil {
		var td d3d11Texture2DDesc
		tex.call(vtTexture2DGetDesc, uintptr(unsafe.Pointer(&td)))
		if td.Format != dxgiFormatB8G8R8A8 && td.Format != dxgiFormatB8G8R8A8SRGB {
			return &Error{Reason: ReasonDXGIUnsupported, Op: "SurfaceFormat"} // BGRA dışı yüzey (ör. FP16) işlenmez
		}
		td.MipLevels, td.ArraySize, td.SampleCount, td.SampleQuality = 1, 1, 1, 0
		td.Usage, td.BindFlags, td.CPUAccessFlags, td.MiscFlags = d3d11UsageStaging, 0, d3d11CPUAccessRead, 0
		if hr := d.device.call(vtDeviceCreateTexture2D, uintptr(unsafe.Pointer(&td)), 0, uintptr(unsafe.Pointer(&d.staging))); hr.failed() {
			return hr.err("CreateTexture2D")
		}
		d.w, d.h = int(td.Width), int(td.Height)
	}
	d.ctx.call(vtCtxCopyResource, uintptr(unsafe.Pointer(d.staging)), uintptr(unsafe.Pointer(tex)))
	return nil
}

func (d *duplicator) close() {
	d.staging.release()
	d.dup.release()
	d.ctx.release()
	d.device.release()
	d.staging, d.dup, d.ctx, d.device = nil, nil, nil, nil
}
