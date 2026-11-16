//go:build windows

package win

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// P28u (mimari-p28u §7.3, §7.5): onay diyaloğunun örtülme taraması (GW_HWNDPREV zinciri, WindowFromPoint) ve kilit
// (LockWorkStation). K6s spike'ta test dosyalarında tanımlıydı; üretim kodu buradan kullanır.

var pLockWorkStation = user32.NewProc("LockWorkStation")

// GW_HWNDPREV z-sırasında bir üstteki pencere.
const GW_HWNDPREV = 3

// PrevWindow GetWindow(h, GW_HWNDPREV); yoksa 0.
func PrevWindow(h uintptr) uintptr {
	r, _, _ := pGetWindow.Call(h, GW_HWNDPREV)
	return r
}

// Visible IsWindowVisible (WS_VISIBLE; saydamlık/alfa bakılmaz).
func Visible(h uintptr) bool { return h != 0 && windows.IsWindowVisible(windows.HWND(h)) }

// WindowRect GetWindowRect (DWM çerçevesi değil: örtülme için geniş dikdörtgen güvenli yöndür); alınamazsa false.
func WindowRect(h uintptr) (RECT, bool) {
	var r RECT
	if ok, _, _ := pGetWindowRect.Call(h, uintptr(unsafe.Pointer(&r))); ok == 0 {
		return RECT{}, false
	}
	return r, true
}

// WindowAt WindowFromPoint (alt pencere dahil, köke çıkmaz); nokta boşsa 0.
func WindowAt(x, y int32) uintptr {
	var h uintptr
	if unsafe.Sizeof(uintptr(0)) == 8 {
		h, _, _ = pWindowFromPoint.Call(uintptr(uint32(x)) | uintptr(uint32(y))<<32)
	} else {
		h, _, _ = pWindowFromPoint.Call(uintptr(x), uintptr(y))
	}
	return h
}

// LockWorkStation iş istasyonunu kilitler (çağıran iş parçacığı giriş masaüstünde olmalı); başarısızsa hata.
func LockWorkStation() error {
	if r, _, err := pLockWorkStation.Call(); r == 0 {
		return err
	}
	return nil
}
