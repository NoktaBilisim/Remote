//go:build windows

package servisui

import (
	"errors"
	"image"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/win"
)

// Tepsi simgesi (`--tray`, mimari-p27 §5.4): ipucu "Gözetimsiz erişim: Açık / Kapalı / Bağlantı var: <teknisyen>",
// menü: durum satırı (pasif), "Gözetimsiz erişimi kapat" ya da "Gözetimsiz erişimi aç…", "Ayarlar…". "Çık" yoktur
// (gözetim şeffaflığı); WM_CLOSE yok sayılır. P20 `tray.Icon` menüsü sabit (Destek iste / Aç / Çık) olduğu için
// kullanılmaz; simge pikselleri `tray.IconPixels` ile aynı yoldan üretilir. Kendi kilitli iş parçacığı vardır.

var (
	shell32 = windows.NewLazySystemDLL("shell32.dll")
	user32  = windows.NewLazySystemDLL("user32.dll")
	gdi32   = windows.NewLazySystemDLL("gdi32.dll")

	pShellNotifyIconW       = shell32.NewProc("Shell_NotifyIconW")
	pRegisterWindowMessageW = user32.NewProc("RegisterWindowMessageW")
	pCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	pAppendMenuW            = user32.NewProc("AppendMenuW")
	pSetMenuDefaultItem     = user32.NewProc("SetMenuDefaultItem")
	pTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	pDestroyMenu            = user32.NewProc("DestroyMenu")
	pCreateIconIndirect     = user32.NewProc("CreateIconIndirect")
	pDestroyIcon            = user32.NewProc("DestroyIcon")
	pGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
	pLoadIconW              = user32.NewProc("LoadIconW")
	pCreateDIBSection       = gdi32.NewProc("CreateDIBSection")
	pCreateBitmap           = gdi32.NewProc("CreateBitmap")
)

const (
	nimAdd, nimModify, nimDelete, nimSetVersion = 0, 1, 2, 4
	nifMessage, nifIcon, nifTip, nifShowTip     = 0x01, 0x02, 0x04, 0x80
	nimVersion4                                 = 4
	ninSelect, ninKeySelect, wmContext, wmNull  = 0x0400, 0x0401, 0x007B, 0x0000
	wmCallback                                  = win.WM_APP + 1
	wmStop                                      = win.WM_APP + 2
	iconID, smCxSmIcon, idiApp                  = 1, 49, 32512
	mfString, mfGrayed, mfSeparator             = 0x0000, 0x0001, 0x0800
	tpmRightBtn, tpmNoNotify, tpmReturn         = 0x0002, 0x0080, 0x0100
	trayClass                                   = "NoktaDestekServisTray"
)

// Tepsi komutları.
type trayCmd int

const (
	cmdSettings trayCmd = iota + 1
	cmdDisable
	cmdEnable
)

// notifyIconData NOTIFYICONDATAW (Vista+ tam boy; P20 tray ile aynı düzen).
type notifyIconData struct {
	cbSize           uint32
	hWnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         windows.GUID
	hBalloonIcon     uintptr
}

type iconInfo struct {
	fIcon              int32
	xHotspot, yHotspot uint32
	hbmMask, hbmColor  uintptr
}

type trayIcon struct {
	cmds chan trayCmd
	done chan struct{}

	mu         sync.Mutex
	hwnd       uintptr
	hicon      uintptr
	view       View
	taskbarMsg uint32
}

var (
	curIcon      *trayIcon // tek örnek; yalnız simge iş parçacığında okunur
	trayProcOnce sync.Once
	trayProc     uintptr
	trayClassErr error
)

// startIcon simgeyi ekler; Explorer hazır değilse TaskbarCreated ile yeniden eklenir.
func startIcon(img image.Image, v View) (*trayIcon, error) {
	ic := &trayIcon{cmds: make(chan trayCmd, 4), done: make(chan struct{}), view: v}
	ready := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer close(ic.done)
		trayProcOnce.Do(func() {
			trayProc = windows.NewCallback(trayDispatch)
			trayClassErr = win.RegisterClass(trayClass, trayProc, 0)
		})
		if trayClassErr != nil {
			ready <- trayClassErr
			return
		}
		ic.taskbarMsg = registerMessage("TaskbarCreated")
		curIcon = ic
		h := win.CreateWindow(win.WS_EX_TOOLWINDOW, trayClass, Title, win.WS_POPUP, 0, 0, 0, 0, 0, 0)
		if h == 0 {
			ready <- errors.New("servisui: tepsi penceresi oluşturulamadı")
			return
		}
		ic.mu.Lock()
		ic.hwnd, ic.hicon = h, makeIcon(img)
		ic.add()
		ic.mu.Unlock()
		ready <- nil
		var m win.MSG
		for win.GetMessage(&m) > 0 {
			win.TranslateDispatch(&m)
		}
	}()
	return ic, <-ready
}

// setView ipucunu ve menü durumunu günceller (her iş parçacığından; ipucu değişmediyse dokunmaz).
func (ic *trayIcon) setView(v View) {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	changed := ic.view.Tip != v.Tip
	ic.view = v
	if changed {
		n := ic.base(nifTip | nifShowTip)
		copy(n.szTip[:], utf16Trunc(v.Tip, len(n.szTip)))
		notify(nimModify, &n)
	}
}

func (ic *trayIcon) close() {
	win.PostMessage(ic.hwnd, wmStop, 0, 0)
	<-ic.done
	ic.mu.Lock()
	if ic.hicon != 0 {
		_, _, _ = pDestroyIcon.Call(ic.hicon)
		ic.hicon = 0
	}
	ic.mu.Unlock()
}

func (ic *trayIcon) send(c trayCmd) {
	select {
	case ic.cmds <- c:
	default:
	}
}

func (ic *trayIcon) base(flags uint32) notifyIconData {
	n := notifyIconData{hWnd: ic.hwnd, uID: iconID, uFlags: flags}
	n.cbSize = uint32(unsafe.Sizeof(n))
	return n
}

// add NIM_ADD + NOTIFYICON_VERSION_4; ic.mu altında.
func (ic *trayIcon) add() {
	n := ic.base(nifMessage | nifIcon | nifTip | nifShowTip)
	n.uCallbackMessage, n.hIcon = wmCallback, ic.hicon
	copy(n.szTip[:], utf16Trunc(ic.view.Tip, len(n.szTip)))
	notify(nimAdd, &n)
	v := ic.base(0)
	v.uVersion = nimVersion4
	notify(nimSetVersion, &v)
}

func notify(op uintptr, n *notifyIconData) {
	_, _, _ = pShellNotifyIconW.Call(op, uintptr(unsafe.Pointer(n)))
}

func registerMessage(name string) uint32 {
	r, _, _ := pRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(win.Str(name))))
	return uint32(r)
}

func trayDispatch(h uintptr, msg uint32, wp, lp uintptr) uintptr {
	ic := curIcon
	if ic == nil || h != ic.hwnd {
		return win.DefWindowProc(h, msg, wp, lp)
	}
	switch {
	case msg == wmCallback:
		switch uint32(lp & 0xFFFF) {
		case ninSelect, ninKeySelect:
			ic.send(cmdSettings)
		case wmContext:
			ic.menu(int32(int16(wp&0xFFFF)), int32(int16((wp>>16)&0xFFFF)))
		}
		return 0
	case msg == wmStop:
		ic.mu.Lock()
		n := ic.base(0)
		notify(nimDelete, &n)
		ic.mu.Unlock()
		win.DestroyWindow(h)
		win.PostQuitMessage()
		return 0
	case msg == win.WM_CLOSE: // "Çık" yok; başka süreçlerin kapatma isteği yok sayılır
		return 0
	case ic.taskbarMsg != 0 && msg == ic.taskbarMsg: // Explorer yeniden başladı
		ic.mu.Lock()
		ic.add()
		ic.mu.Unlock()
		return 0
	}
	return win.DefWindowProc(h, msg, wp, lp)
}

// menu durum satırı (pasif), açma/kapatma, Ayarlar… (varsayılan).
func (ic *trayIcon) menu(x, y int32) {
	ic.mu.Lock()
	v := ic.view
	ic.mu.Unlock()
	hm, _, _ := pCreatePopupMenu.Call()
	if hm == 0 {
		return
	}
	defer func() { _, _, _ = pDestroyMenu.Call(hm) }()
	appendMenu(hm, mfString|mfGrayed, 0, MenuText(v.StatusText))
	appendMenu(hm, mfSeparator, 0, "")
	switch v.Primary {
	case ActDisable:
		appendMenu(hm, mfString, uintptr(cmdDisable), MenuDisable)
	case ActEnable:
		appendMenu(hm, mfString, uintptr(cmdEnable), MenuEnable)
	}
	appendMenu(hm, mfString, uintptr(cmdSettings), MenuSettings)
	_, _, _ = pSetMenuDefaultItem.Call(hm, uintptr(cmdSettings), 0)
	win.SetForegroundWindow(ic.hwnd) // menü dışına tıklanınca kapansın
	r, _, _ := pTrackPopupMenu.Call(hm, tpmReturn|tpmRightBtn|tpmNoNotify, uintptr(x), uintptr(y), 0, ic.hwnd, 0)
	win.PostMessage(ic.hwnd, wmNull, 0, 0)
	if r != 0 {
		ic.send(trayCmd(r))
	}
}

func appendMenu(hm, flags, id uintptr, text string) {
	if text == "" {
		_, _, _ = pAppendMenuW.Call(hm, flags, id, 0)
		return
	}
	_, _, _ = pAppendMenuW.Call(hm, flags, id, uintptr(unsafe.Pointer(win.Str(text))))
}
