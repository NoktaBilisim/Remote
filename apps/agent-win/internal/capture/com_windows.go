//go:build windows

package capture

import (
	"fmt"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// CGO'suz COM: arayüz işaretçisinin ilk alanı vtable'dır; yöntem i, vtable[i] adresindeki stdcall/x64 işlevidir
// (ilk argüman nesnenin kendisi). Dizinler Windows SDK başlıklarındaki (mingw-w64 d3d11.h, dxgi1_2.h, mfobjects.h,
// mftransform.h) C vtable sırasından doğrulanmıştır.
type comObj struct{ vtbl *[64]uintptr }

type hresult int32

func (h hresult) failed() bool { return h < 0 }

func (h hresult) err(op string) error { return fmt.Errorf("capture: %s: 0x%08X", op, uint32(h)) }

// call vtable yöntemini çağırır. uintptrescapes: işaretçiden dönüştürülmüş argümanlar yığına taşınır ve çağrı boyunca
// canlı kalır (x/sys LazyProc.Call ile aynı kural).
//
//go:uintptrescapes
func (o *comObj) call(i int, args ...uintptr) hresult {
	a := make([]uintptr, 0, len(args)+1)
	a = append(append(a, uintptr(unsafe.Pointer(o))), args...)
	r, _, _ := syscall.SyscallN(o.vtbl[i], a...)
	return hresult(int32(uint32(r)))
}

func (o *comObj) release() {
	if o != nil {
		o.call(2)
	}
}

func (o *comObj) query(iid *windows.GUID) (*comObj, error) {
	var p *comObj
	if hr := o.call(0, uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&p))); hr.failed() {
		return nil, hr.err("QueryInterface")
	}
	return p, nil
}

// procHR DLL işlevini çağırır ve HRESULT'u hataya çevirir. uintptrescapes (S6-1): değişken argümanlı sarmalayıcı
// olduğu için LazyProc.Call'ın kuralı buraya geçmez; işaret olmadan `&yerel` dönüşümleri yığın büyümesinde bayatlayabilir.
//
//go:uintptrescapes
func procHR(p *windows.LazyProc, op string, args ...uintptr) error {
	if err := p.Find(); err != nil {
		return fmt.Errorf("capture: %s: %w", op, err)
	}
	r, _, _ := p.Call(args...)
	if hr := hresult(int32(uint32(r))); hr.failed() {
		return hr.err(op)
	}
	return nil
}

var (
	modD3D11  = windows.NewLazySystemDLL("d3d11.dll")
	modDXGI   = windows.NewLazySystemDLL("dxgi.dll")
	modMFPlat = windows.NewLazySystemDLL("mfplat.dll")
	modOle32  = windows.NewLazySystemDLL("ole32.dll")

	pD3D11CreateDevice    = modD3D11.NewProc("D3D11CreateDevice")
	pCreateDXGIFactory1   = modDXGI.NewProc("CreateDXGIFactory1")
	pMFStartup            = modMFPlat.NewProc("MFStartup")
	pMFShutdown           = modMFPlat.NewProc("MFShutdown")
	pMFTEnumEx            = modMFPlat.NewProc("MFTEnumEx")
	pMFCreateMediaType    = modMFPlat.NewProc("MFCreateMediaType")
	pMFCreateSample       = modMFPlat.NewProc("MFCreateSample")
	pMFCreateMemoryBuffer = modMFPlat.NewProc("MFCreateMemoryBuffer")
	pCoCreateInstance     = modOle32.NewProc("CoCreateInstance")
)

func guid(d1 uint32, d2, d3 uint16, d4 ...byte) windows.GUID {
	g := windows.GUID{Data1: d1, Data2: d2, Data3: d3}
	copy(g.Data4[:], d4)
	return g
}

// Arayüz kimlikleri (mingw-w64 başlıklarından).
var (
	iidIDXGIFactory1          = guid(0x770aae78, 0xf26f, 0x4dba, 0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87)
	iidIDXGIOutput1           = guid(0x00cddea8, 0x939b, 0x4b83, 0xa3, 0x40, 0xa6, 0x85, 0x22, 0x66, 0x66, 0xcc)
	iidID3D11Texture2D        = guid(0x6f15aaf2, 0xd208, 0x4e89, 0x9a, 0xb4, 0x48, 0x95, 0x35, 0xd3, 0x4f, 0x9c)
	iidIMFTransform           = guid(0xbf94c121, 0x5b05, 0x4e6f, 0x80, 0x00, 0xba, 0x59, 0x89, 0x61, 0x41, 0x4d)
	iidIMFMediaEventGenerator = guid(0x2cd0bd52, 0xbcd5, 0x4b89, 0xb6, 0x2c, 0xea, 0xdc, 0x0c, 0x03, 0x1e, 0x7d)
	iidICodecAPI              = guid(0x901db4c7, 0x31ce, 0x41a2, 0x85, 0xdc, 0x8f, 0xa0, 0xbf, 0x41, 0xb8, 0xda)
)
