//go:build windows

package voice

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// CGO'suz COM: capture/com_windows.go ile aynı elle vtable kalıbı (yöntem i = vtable[i], ilk argüman nesne). Ayrı dosyada
// durur ki S6-1 denetimi (internal/win/unsafeptr_test.go) `call`'ın //go:uintptrescapes işaretini burada da zorlasın.
type comObj struct{ vtbl *[32]uintptr }

type hresult int32

func (h hresult) err(op string) error {
	if h < 0 {
		return &HRError{Op: op, HR: uint32(h)}
	}
	return nil
}

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

func guid(d1 uint32, d2, d3 uint16, d4 ...byte) windows.GUID {
	g := windows.GUID{Data1: d1, Data2: d2, Data3: d3}
	copy(g.Data4[:], d4)
	return g
}
