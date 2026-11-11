//go:build windows

package input

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32            = windows.NewLazySystemDLL("user32.dll") // G-08: yalnız System32
	pSendInput        = user32.NewProc("SendInput")
	pMapVirtualKeyW   = user32.NewProc("MapVirtualKeyW")
	pGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

const (
	inputMouse    = 0
	inputKeyboard = 1
	mapvkVKToVSC  = 0
)

// amd64 düzeni (winuser.h): INPUT = type(4) + dolgu(4) + birlik(32).
type mouseInput struct {
	DX, DY      int32
	Data, Flags uint32
	Time        uint32
	_           uint32
	Extra       uintptr
}

type keybdInput struct {
	VK, Scan    uint16
	Flags, Time uint32
	_           uint32
	Extra       uintptr
	_           [8]byte
}

type inputRec struct {
	Type uint32
	_    uint32
	U    [32]byte
}

// SendInputInjector Windows SendInput uygulaması.
type SendInputInjector struct{}

var errPartial = errors.New("input: SendInput olayların hepsini uygulamadı")

// Inject olayları tek SendInput çağrısıyla verir (aradaki yerel girdiyle karışmaz).
func (SendInputInjector) Inject(evs []Event) error {
	if len(evs) == 0 {
		return nil
	}
	recs := make([]inputRec, len(evs))
	for i, e := range evs {
		if e.Mouse {
			recs[i].Type = inputMouse
			*(*mouseInput)(unsafe.Pointer(&recs[i].U)) = mouseInput{DX: e.DX, DY: e.DY, Data: uint32(e.Data), Flags: e.Flags}
			continue
		}
		recs[i].Type = inputKeyboard
		scan := e.Scan
		if e.Flags&KeyUnicode == 0 {
			s, _, _ := pMapVirtualKeyW.Call(uintptr(e.VK), mapvkVKToVSC)
			scan = uint16(s)
		}
		*(*keybdInput)(unsafe.Pointer(&recs[i].U)) = keybdInput{VK: e.VK, Scan: scan, Flags: e.Flags}
	}
	n, _, _ := pSendInput.Call(uintptr(len(recs)), uintptr(unsafe.Pointer(&recs[0])), unsafe.Sizeof(recs[0]))
	if int(n) != len(recs) {
		return errPartial // UIPI: odaktaki pencere yükseltilmişse (AC-105) olaylar engellenir
	}
	return nil
}

// VirtualScreen tüm monitörleri kapsayan sanal masaüstü (SM_XVIRTUALSCREEN…).
func VirtualScreen() Rect {
	m := func(i uintptr) int32 { r, _, _ := pGetSystemMetrics.Call(i); return int32(r) }
	x, y := m(76), m(77)
	return Rect{Left: x, Top: y, Right: x + m(78), Bottom: y + m(79)}
}
