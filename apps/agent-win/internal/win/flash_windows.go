//go:build windows

package win

import "unsafe"

// P20 K6 (K-P20-9): talep sohbetinde yeni teknisyen mesajı → pencere öne gelene kadar yanıp sönme. Ayrı dosya: paralel
// paketlerin win_windows.go düzenlemeleriyle çakışmasın.

var pFlashWindowEx = user32.NewProc("FlashWindowEx")

const (
	flashwAll       = 0x00000003 // FLASHW_CAPTION | FLASHW_TRAY
	flashwTimerNoFG = 0x0000000C // pencere öne gelene kadar
)

// flashInfo FLASHWINFO.
type flashInfo struct {
	cbSize    uint32
	hwnd      uintptr
	dwFlags   uint32
	uCount    uint32
	dwTimeout uint32
}

// FlashUntilFocus FlashWindowEx(FLASHW_ALL | FLASHW_TIMERNOFG): başlık ve görev çubuğu düğmesi pencere öne gelene kadar
// yanıp söner.
func FlashUntilFocus(h uintptr) {
	fi := flashInfo{hwnd: h, dwFlags: flashwAll | flashwTimerNoFG}
	fi.cbSize = uint32(unsafe.Sizeof(fi))
	_, _, _ = pFlashWindowEx.Call(uintptr(unsafe.Pointer(&fi)))
}
