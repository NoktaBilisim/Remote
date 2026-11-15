//go:build windows

package desktop

import (
	"errors"
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// K-P27-1: yardımcı SYSTEM jetonuyla konsol oturumunun winsta0 istasyonundadır; giriş masaüstü (Default, Winlogon —
// kilit/giriş ekranı ve UAC onayı —, ekran koruyucu) OpenInputDesktop ile açılır ve iş parçacığı SetThreadDesktop ile
// ona geçer. Ayrıcalık gerekmez: masaüstü nesnesinin ACL'inde SYSTEM vardır (mimari-p27 §5.2 r2 m.1).

var (
	user32               = windows.NewLazySystemDLL("user32.dll") // G-08
	pOpenInputDesktop    = user32.NewProc("OpenInputDesktop")
	pCloseDesktop        = user32.NewProc("CloseDesktop")
	pSetThreadDesktop    = user32.NewProc("SetThreadDesktop")
	pGetThreadDesktop    = user32.NewProc("GetThreadDesktop")
	pGetUserObjectInfoW  = user32.NewProc("GetUserObjectInformationW")
	errNoInputDesktop    = errors.New("desktop: giriş masaüstü açılamadı")
	errSetThreadDesktop  = errors.New("desktop: iş parçacığı masaüstü değiştirilemedi")
	errDesktopNameFailed = errors.New("desktop: masaüstü adı okunamadı")
)

const (
	desktopReadObjects   = 0x0001
	desktopCreateWindow  = 0x0002
	desktopCreateMenu    = 0x0004
	desktopHookControl   = 0x0008
	desktopJournalRecord = 0x0010
	desktopJournalPlay   = 0x0020 // SendInput giriş masaüstüne
	desktopEnumerate     = 0x0040
	desktopWriteObjects  = 0x0080
	uoiName              = 2
	// attachAccess pencere (gösterge), GDI/DXGI yakalama ve SendInput için gereken masaüstü hakları. Masaüstü değiştirme
	// (SwitchDesktop) istenmez: yardımcı hangi masaüstünün görüneceğini değiştirmez, yalnız izler.
	attachAccess = desktopReadObjects | desktopCreateWindow | desktopCreateMenu | desktopHookControl |
		desktopJournalRecord | desktopJournalPlay | desktopEnumerate | desktopWriteObjects
)

// InputName giriş masaüstünün adı (Default / Winlogon / Screen-saver). Açılamazsa hata (geçiş anı; kapı kapalı kalır).
func InputName() (string, error) {
	h, _, _ := pOpenInputDesktop.Call(0, 0, desktopReadObjects)
	if h == 0 {
		return "", errNoInputDesktop
	}
	defer func() { _, _, _ = pCloseDesktop.Call(h) }()
	return objectName(h)
}

// Attach çağıran iş parçacığını (runtime.LockOSThread ile kilitli olmalı; penceresi/kancası olmamalı) giriş masaüstüne
// geçirir; bağlandığı masaüstünün adını döner. release iş parçacığını önceki masaüstüne döndürüp tanıtıcıyı kapatır
// (iş parçacığı pencerelerini kapattıktan sonra çağrılır; başarısızsa tanıtıcı süreç sonunda kapanır).
func Attach() (name string, release func(), err error) {
	prev, _, _ := pGetThreadDesktop.Call(uintptr(windows.GetCurrentThreadId()))
	h, _, _ := pOpenInputDesktop.Call(0, 0, attachAccess)
	if h == 0 {
		return "", nil, errNoInputDesktop
	}
	if r, _, e := pSetThreadDesktop.Call(h); r == 0 {
		_, _, _ = pCloseDesktop.Call(h)
		return "", nil, fmt.Errorf("%w: %v", errSetThreadDesktop, e)
	}
	name, err = objectName(h)
	release = func() {
		if prev != 0 {
			if r, _, _ := pSetThreadDesktop.Call(prev); r == 0 {
				return
			}
		}
		_, _, _ = pCloseDesktop.Call(h)
	}
	if err != nil {
		release()
		return "", nil, err
	}
	return name, release, nil
}

func objectName(h uintptr) (string, error) {
	var buf [64]uint16
	var need uint32
	r, _, _ := pGetUserObjectInfoW.Call(h, uoiName, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)*2),
		uintptr(unsafe.Pointer(&need)))
	if r == 0 {
		return "", errDesktopNameFailed
	}
	return windows.UTF16ToString(buf[:]), nil
}
