//go:build windows

package env

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32             = windows.NewLazySystemDLL("user32.dll") // G-08
	pOpenInputDesktop  = user32.NewProc("OpenInputDesktop")
	pCloseDesktop      = user32.NewProc("CloseDesktop")
	pGetUserObjectInfo = user32.NewProc("GetUserObjectInformationW")
)

const (
	desktopReadObjects = 0x0001
	uoiName            = 2
)

// Probe Windows durumu. İstemci kendisi yükseltilmişse (normalde asInvoker) hiçbir pencere engellemez.
func Probe() State {
	return State{ElevatedForeground: elevatedForeground(), SecureDesktop: secureDesktop()}
}

func elevatedForeground() bool {
	if windows.GetCurrentProcessToken().IsElevated() {
		return false
	}
	fg := windows.GetForegroundWindow()
	if fg == 0 {
		return false
	}
	var pid uint32
	if _, err := windows.GetWindowThreadProcessId(fg, &pid); err != nil || pid == 0 {
		return false
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return err == windows.ERROR_ACCESS_DENIED
	}
	defer windows.CloseHandle(h)
	var tok windows.Token
	if err := windows.OpenProcessToken(h, windows.TOKEN_QUERY, &tok); err != nil {
		// Orta bütünlükteki süreç yükseltilmiş sürecin belirtecini açamaz.
		return err == windows.ERROR_ACCESS_DENIED
	}
	defer tok.Close()
	return tok.IsElevated()
}

// secureDesktop giriş masaüstü açılamıyorsa veya adı "Default" değilse (Winlogon: UAC/kilit) true.
func secureDesktop() bool {
	d, _, _ := pOpenInputDesktop.Call(0, 0, desktopReadObjects)
	if d == 0 {
		return true
	}
	defer func() { _, _, _ = pCloseDesktop.Call(d) }()
	var buf [64]uint16
	var need uint32
	r, _, _ := pGetUserObjectInfo.Call(d, uoiName, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)*2),
		uintptr(unsafe.Pointer(&need)))
	if r == 0 {
		return false
	}
	return windows.UTF16ToString(buf[:]) != "Default"
}

// SelfElevated S7-9: istemci yönetici olarak (yükseltilmiş belirteçle) çalışıyor mu. Bu durumda UIPI sınırı kalkar;
// kullanıcı oturum penceresinde ve kontrol izni diyaloğunda uyarılır.
func SelfElevated() bool { return windows.GetCurrentProcessToken().IsElevated() }
