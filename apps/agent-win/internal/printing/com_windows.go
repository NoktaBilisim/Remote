//go:build windows

package printing

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// CGO'suz COM/WinRT: capture/com_windows.go ile aynı elle vtable kalıbı (yöntem i = vtable[i], ilk argüman nesne).
// capture'daki tür paket içi ve hata türü capture.Error'a bağlı olduğundan burada küçük eşi var; ortak bir WinRT
// paketi K4 kararıdır (implementation.md "P28a K0").
type comObj struct{ vtbl *[64]uintptr }

type hresult int32

func (h hresult) failed() bool { return h < 0 }

// HRError WinRT/COM hatası; ileti yalnız adım adı ve HRESULT taşır (PDF içeriği/dosya adı yok).
type HRError struct {
	Op string
	HR uint32
}

func (e *HRError) Error() string { return fmt.Sprintf("printing: %s hr=0x%08X", e.Op, e.HR) }

func (h hresult) err(op string) error { return &HRError{Op: op, HR: uint32(h)} }

// call vtable yöntemini çağırır (uintptrescapes: dönüştürülmüş işaretçiler çağrı boyunca canlı, S6-1).
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

// procHR DLL işlevini çağırır, HRESULT'u hataya çevirir.
//
//go:uintptrescapes
func procHR(p *windows.LazyProc, op string, args ...uintptr) error {
	if err := p.Find(); err != nil {
		return &HRError{Op: op}
	}
	r, _, _ := p.Call(args...)
	if hr := hresult(int32(uint32(r))); hr.failed() {
		return hr.err(op)
	}
	return nil
}

func guid(d1 uint32, d2, d3 uint16, d4 ...byte) windows.GUID {
	g := windows.GUID{Data1: d1, Data2: d2, Data3: d3}
	copy(g.Data4[:], d4)
	return g
}

var (
	modCombase = windows.NewLazySystemDLL("combase.dll")

	pRoInitialize           = modCombase.NewProc("RoInitialize")
	pRoUninitialize         = modCombase.NewProc("RoUninitialize")
	pRoGetActivationFactory = modCombase.NewProc("RoGetActivationFactory")
	pRoActivateInstance     = modCombase.NewProc("RoActivateInstance")
	pWindowsCreateString    = modCombase.NewProc("WindowsCreateString")
	pWindowsDeleteString    = modCombase.NewProc("WindowsDeleteString")

	iidIAsyncInfo = guid(0x00000036, 0x0000, 0x0000, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46)
)

const (
	roInitMultithreaded = 1

	vtAsyncInfoStatus    = 7 // IAsyncInfo.get_Status
	vtAsyncInfoErrorCode = 8 // IAsyncInfo.get_ErrorCode
	vtAsyncInfoCancel    = 9 // IAsyncInfo.Cancel
	vtAsyncGetResults    = 8 // IAsyncOperation<T>/IAsyncAction.GetResults (6 put_Completed, 7 get_Completed)

	asyncStarted   = 0
	asyncCompleted = 1
	asyncPoll      = 10 * time.Millisecond // mimari-p28 §5.1
)

// roInit iş parçacığı için WinRT'yi MTA başlatır; çağıran runtime.LockOSThread yapmış olmalıdır.
func roInit() error {
	r, _, _ := pRoInitialize.Call(roInitMultithreaded)
	if hr := hresult(int32(uint32(r))); hr.failed() {
		return hr.err("RoInitialize")
	}
	return nil
}

func roUninit() { _, _, _ = pRoUninitialize.Call() }

// hstring geçici HSTRING; çağıran WindowsDeleteString ile bırakır (deleteHString).
func hstring(s string) (uintptr, error) {
	name, err := windows.UTF16FromString(s)
	if err != nil {
		return 0, err
	}
	var hs uintptr
	if err := procHR(pWindowsCreateString, "WindowsCreateString", uintptr(unsafe.Pointer(&name[0])), uintptr(len(name)-1),
		uintptr(unsafe.Pointer(&hs))); err != nil {
		return 0, err
	}
	return hs, nil
}

func deleteHString(hs uintptr) { _, _, _ = pWindowsDeleteString.Call(hs) }

// activationFactory sınıfın statik fabrikası.
func activationFactory(class string, iid *windows.GUID) (*comObj, error) {
	hs, err := hstring(class)
	if err != nil {
		return nil, err
	}
	defer deleteHString(hs)
	var f *comObj
	if err := procHR(pRoGetActivationFactory, "RoGetActivationFactory", hs, uintptr(unsafe.Pointer(iid)),
		uintptr(unsafe.Pointer(&f))); err != nil {
		return nil, err
	}
	return f, nil
}

// activate varsayılan kurucuyla örnek oluşturur ve iid arayüzünü döner.
func activate(class string, iid *windows.GUID) (*comObj, error) {
	hs, err := hstring(class)
	if err != nil {
		return nil, err
	}
	defer deleteHString(hs)
	var insp *comObj
	if err := procHR(pRoActivateInstance, "RoActivateInstance", hs, uintptr(unsafe.Pointer(&insp))); err != nil {
		return nil, err
	}
	defer insp.release()
	return insp.query(iid)
}

// await IAsyncOperation/IAsyncAction'ı IAsyncInfo.Status yoklamasıyla bekler (10 ms); süre dolarsa Cancel.
func await(op *comObj, timeout time.Duration, name string) error {
	info, err := op.query(&iidIAsyncInfo)
	if err != nil {
		return err
	}
	defer info.release()
	deadline := time.Now().Add(timeout)
	for {
		var st int32
		if hr := info.call(vtAsyncInfoStatus, uintptr(unsafe.Pointer(&st))); hr.failed() {
			return hr.err(name + ".Status")
		}
		switch {
		case st == asyncCompleted:
			return nil
		case st != asyncStarted:
			var code int32
			info.call(vtAsyncInfoErrorCode, uintptr(unsafe.Pointer(&code)))
			return hresult(code).err(name)
		case !time.Now().Before(deadline):
			info.call(vtAsyncInfoCancel)
			return &HRError{Op: name + ".Timeout"}
		}
		time.Sleep(asyncPoll)
	}
}
