//go:build windows

package tray

import (
	"errors"
	"image"
	"runtime"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/win"
)

var (
	shell32 = windows.NewLazySystemDLL("shell32.dll")
	user32  = windows.NewLazySystemDLL("user32.dll")
	gdi32   = windows.NewLazySystemDLL("gdi32.dll")

	pShellNotifyIconW         = shell32.NewProc("Shell_NotifyIconW")
	pRegisterWindowMessageW   = user32.NewProc("RegisterWindowMessageW")
	pCreatePopupMenu          = user32.NewProc("CreatePopupMenu")
	pAppendMenuW              = user32.NewProc("AppendMenuW")
	pTrackPopupMenu           = user32.NewProc("TrackPopupMenu")
	pDestroyMenu              = user32.NewProc("DestroyMenu")
	pFindWindowExW            = user32.NewProc("FindWindowExW")
	pGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	pAllowSetForegroundWindow = user32.NewProc("AllowSetForegroundWindow")
	pCreateIconIndirect       = user32.NewProc("CreateIconIndirect")
	pDestroyIcon              = user32.NewProc("DestroyIcon")
	pGetSystemMetrics         = user32.NewProc("GetSystemMetrics")
	pLoadIconW                = user32.NewProc("LoadIconW")
	pCreateDIBSection         = gdi32.NewProc("CreateDIBSection")
	pCreateBitmap             = gdi32.NewProc("CreateBitmap")
)

const (
	nimAdd        = 0
	nimModify     = 1
	nimDelete     = 2
	nimSetVersion = 4

	nifMessage  = 0x01
	nifIcon     = 0x02
	nifTip      = 0x04
	nifInfo     = 0x10
	nifShowTip  = 0x80
	niifInfo    = 0x01
	niifQuiet   = 0x80 // NIIF_RESPECT_QUIET_TIME
	nimVersion4 = 4

	ninSelect    = 0x0400
	ninKeySelect = 0x0401
	wmContext    = 0x007B
	wmNull       = 0x0000
	wmCallback   = win.WM_APP + 1 // simge olayları (NOTIFYICON_VERSION_4)
	wmStop       = win.WM_APP + 2

	iconID      = 1
	smCxSmIcon  = 49
	idiApp      = 32512
	mfString    = 0x0000
	tpmRightBtn = 0x0002
	tpmNoNotify = 0x0080
	tpmReturn   = 0x0100

	mbSetForeground = 0x10000

	idMenuBase = 1 // menü öğesi kimliği = idMenuBase + MenuItems dizini
)

// notifyIconData NOTIFYICONDATAW (Vista+ tam boy: amd64 976, 386 956 bayt; tray_windows_test.go).
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
	uVersion         uint32 // uTimeout / uVersion birliği
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         windows.GUID // kullanılmaz: GUID yok (imzasız exe'de yol bağı sorunu), uID ile
	hBalloonIcon     uintptr
}

type iconInfo struct {
	fIcon    int32
	xHotspot uint32
	yHotspot uint32
	hbmMask  uintptr
	hbmColor uintptr
}

// Icon bildirim alanındaki simge; kendi kilitli iş parçacığı ve gizli penceresi vardır (UI iş parçacığından bağımsız).
// Süreçte en çok bir tane bulunur.
type Icon struct {
	cmds chan Command
	done chan struct{}

	mu    sync.Mutex
	hwnd  uintptr
	hicon uintptr
	tip   string // kapsamın ipucu (Tip / TipSession); görünen ipucu VoiceTip ile
	// P28d O-PD-3: mikrofon aygıtı açık (ipucu + menüde "Görüşmeyi bitir").
	voice, muted bool
	showMsg      uint32
	taskbarMsg   uint32
}

var (
	current   *Icon // wndproc'un simgesi (tek örnek); yalnız simge iş parçacığında okunur
	classOnce sync.Once
	classErr  error
	wndProc   uintptr
)

// Start simgeyi ekler. img simge resmidir (exe'de simge kaynağı yok; gömülü Nokta amblemi), nil ise Windows'un
// varsayılan uygulama simgesi. Explorer henüz hazır değilse (oturum açılışı) simge TaskbarCreated ile eklenir.
func Start(img image.Image) (*Icon, error) {
	ic := &Icon{cmds: make(chan Command, 4), done: make(chan struct{}), tip: Tip}
	ready := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer close(ic.done)
		classOnce.Do(func() {
			wndProc = windows.NewCallback(dispatch)
			classErr = win.RegisterClass(WindowClass, wndProc, 0)
		})
		if classErr != nil {
			ready <- classErr
			return
		}
		ic.showMsg = registerMessage(ShowMessage)
		ic.taskbarMsg = registerMessage("TaskbarCreated")
		current = ic
		h := win.CreateWindow(win.WS_EX_TOOLWINDOW, WindowClass, Tip, win.WS_POPUP, 0, 0, 0, 0, 0, 0)
		if h == 0 {
			ready <- errors.New("tray: gizli pencere oluşturulamadı")
			return
		}
		ic.mu.Lock()
		ic.hwnd = h
		ic.hicon = makeIcon(img)
		ic.add()
		ic.mu.Unlock()
		ready <- nil
		var m win.MSG
		for win.GetMessage(&m) > 0 {
			win.TranslateDispatch(&m)
		}
	}()
	if err := <-ready; err != nil {
		return nil, err
	}
	return ic, nil
}

// Commands kullanıcı komutları (tamponlu; dolu kanala gelen yinelenen komut düşer).
func (ic *Icon) Commands() <-chan Command { return ic.cmds }

func (ic *Icon) send(c Command) {
	select {
	case ic.cmds <- c:
	default:
	}
}

// SetTip kapsamın ipucunu değiştirir (sabit metinler; sunucu metni yok). Mikrofon açıkken görünen ipucu ses ipucudur
// (VoiceTip). Her iş parçacığından çağrılabilir.
func (ic *Icon) SetTip(text string) {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	ic.tip = text
	ic.showTip()
}

// SetVoice P28d O-PD-3: mikrofon aygıtı açık/sessizde göstergesi (ipucu + menüde "Görüşmeyi bitir"); on=false kaldırır.
// Her iş parçacığından çağrılabilir.
func (ic *Icon) SetVoice(on, muted bool) {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	ic.voice, ic.muted = on, on && muted
	ic.showTip()
}

// showTip görünen ipucunu yazar. ic.mu altında.
func (ic *Icon) showTip() {
	n := ic.base(nifTip | nifShowTip)
	copy(n.szTip[:], truncate(VoiceTip(ic.tip, ic.voice, ic.muted), len(n.szTip)))
	notify(nimModify, &n)
}

// Balloon gövdesiz bilgi balonu (K-P20-9: metin sabittir; kilit ekranında içerik görünmez). Her iş parçacığından.
func (ic *Icon) Balloon(text string) {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	n := ic.base(nifInfo)
	copy(n.szInfo[:], truncate(text, len(n.szInfo)))
	copy(n.szInfoTitle[:], truncate(BalloonTitle, len(n.szInfoTitle)))
	n.dwInfoFlags = niifInfo | niifQuiet
	notify(nimModify, &n)
}

// Confirm "Çık" onayı (pencere/oturum açıkken). Varsayılan düğme "Hayır".
func (ic *Icon) Confirm(text string) bool {
	return win.MessageBox(0, text, BalloonTitle,
		win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2|win.MB_TOPMOST|mbSetForeground) == win.IDYES
}

// Close simgeyi kaldırır ve iş parçacığını bitirir.
func (ic *Icon) Close() {
	win.PostMessage(ic.hwnd, wmStop, 0, 0)
	<-ic.done
	ic.mu.Lock()
	if ic.hicon != 0 {
		_, _, _ = pDestroyIcon.Call(ic.hicon)
		ic.hicon = 0
	}
	ic.mu.Unlock()
}

func (ic *Icon) base(flags uint32) notifyIconData {
	n := notifyIconData{hWnd: ic.hwnd, uID: iconID, uFlags: flags}
	n.cbSize = uint32(unsafe.Sizeof(n))
	return n
}

// add NIM_ADD + NOTIFYICON_VERSION_4 (klavye: Enter/Boşluk NIN_KEYSELECT, menü tuşu WM_CONTEXTMENU). ic.mu altında.
func (ic *Icon) add() {
	n := ic.base(nifMessage | nifIcon | nifTip | nifShowTip)
	n.uCallbackMessage = wmCallback
	n.hIcon = ic.hicon
	copy(n.szTip[:], truncate(VoiceTip(ic.tip, ic.voice, ic.muted), len(n.szTip)))
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

func loword(v uintptr) uint32 { return uint32(v & 0xFFFF) }

func dispatch(h uintptr, msg uint32, wp, lp uintptr) uintptr {
	ic := current
	if ic == nil || h != ic.hwnd {
		return win.DefWindowProc(h, msg, wp, lp)
	}
	switch {
	case msg == wmCallback:
		switch loword(lp) {
		case ninSelect, ninKeySelect:
			ic.send(CmdOpen)
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
	case msg == win.WM_CLOSE: // başka süreçlerin kapatma isteği yok sayılır; yalnız "Çık"
		return 0
	case ic.showMsg != 0 && msg == ic.showMsg: // ikinci örnek (veri yok)
		ic.send(CmdOpen)
		return 0
	case ic.taskbarMsg != 0 && msg == ic.taskbarMsg: // Explorer yeniden başladı
		ic.mu.Lock()
		ic.add()
		ic.mu.Unlock()
		return 0
	}
	return win.DefWindowProc(h, msg, wp, lp)
}

// menu Destek iste / Aç / Çık (§8d.3); P28d: mikrofon açıkken "Görüşmeyi bitir", her zaman "Lisanslar" (MenuItems).
func (ic *Icon) menu(x, y int32) {
	hm, _, _ := pCreatePopupMenu.Call()
	if hm == 0 {
		return
	}
	defer func() { _, _, _ = pDestroyMenu.Call(hm) }()
	ic.mu.Lock()
	items := MenuItems(ic.voice)
	ic.mu.Unlock()
	for i, it := range items {
		_, _, _ = pAppendMenuW.Call(hm, mfString, uintptr(idMenuBase+i), uintptr(unsafe.Pointer(win.Str(it.Text))))
	}
	win.SetForegroundWindow(ic.hwnd) // menü dışına tıklanınca kapansın (TrackPopupMenu kuralı)
	r, _, _ := pTrackPopupMenu.Call(hm, tpmReturn|tpmRightBtn|tpmNoNotify, uintptr(x), uintptr(y), 0, ic.hwnd, 0)
	win.PostMessage(ic.hwnd, wmNull, 0, 0)
	if i := int(r) - idMenuBase; r != 0 && i >= 0 && i < len(items) {
		ic.send(items[i].Cmd)
	}
}

// makeIcon gömülü resimden küçük simge (SM_CXSMICON); başarısızsa IDI_APPLICATION.
func makeIcon(img image.Image) uintptr {
	if h := iconFromImage(img); h != 0 {
		return h
	}
	h, _, _ := pLoadIconW.Call(0, idiApp)
	return h
}

func iconFromImage(img image.Image) uintptr {
	if img == nil {
		return 0
	}
	size, _, _ := pGetSystemMetrics.Call(smCxSmIcon)
	if size == 0 || size > 256 {
		size = 16
	}
	px := IconPixels(img, int(size))
	bi := win.BITMAPINFOHEADER{Width: int32(size), Height: -int32(size), Planes: 1, BitCount: 32}
	bi.Size = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	color, _, _ := pCreateDIBSection.Call(0, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if color == 0 || bits == nil {
		return 0
	}
	defer win.DeleteObject(color)
	copy(unsafe.Slice((*byte)(bits), len(px)), px)
	mask, _, _ := pCreateBitmap.Call(size, size, 1, 1, 0)
	if mask == 0 {
		return 0
	}
	defer win.DeleteObject(mask)
	ii := iconInfo{fIcon: 1, hbmMask: mask, hbmColor: color}
	h, _, _ := pCreateIconIndirect.Call(uintptr(unsafe.Pointer(&ii)))
	return h
}

// signalScanMax aynı sınıf adlı pencere taramasının üst sınırı (aynı masaüstünde sahte pencere seli döngüyü uzatmaz).
const signalScanMax = 32

// SignalExisting ikinci örnek: kullanıcının çalışan tepsi örneğini öne getirmesini ister ("göster" iletisi, veri
// taşımaz) ve true döner; bulunamazsa false. S-P20-K2: aynı sınıf adlı pencereler gezilir, yalnız süreç belirteci
// kullanıcısı geçerli kullanıcının SID'i olan pencere seçilir (başka kullanıcının — ör. `runas` — sürecine ön plan
// izni ve ileti verilmez). Ön plana geçiş izni yalnız o sürece verilir.
func SignalExisting() bool {
	tu, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return false
	}
	user, self := tu.User.Sid, windows.GetCurrentProcessId()
	cls := win.Str(WindowClass)
	defer runtime.KeepAlive(cls)
	var h uintptr
	for range signalScanMax {
		h, _, _ = pFindWindowExW.Call(0, h, uintptr(unsafe.Pointer(cls)), 0)
		if h == 0 {
			return false
		}
		var pid uint32
		_, _, _ = pGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&pid)))
		if pid == 0 || pid == self || !processUserIs(pid, user) {
			continue
		}
		_, _, _ = pAllowSetForegroundWindow.Call(uintptr(pid))
		if m := registerMessage(ShowMessage); m != 0 {
			win.PostMessage(h, m, 0, 0)
		}
		return true
	}
	return false
}

// processUserIs sürecin belirteç kullanıcısı user mı (açılamayan/sorgulanamayan süreç: false).
func processUserIs(pid uint32, user *windows.SID) bool {
	p, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return false
	}
	defer func() { _ = windows.CloseHandle(p) }()
	var tok windows.Token
	if err := windows.OpenProcessToken(p, windows.TOKEN_QUERY, &tok); err != nil {
		return false
	}
	defer func() { _ = tok.Close() }()
	tu, err := tok.GetTokenUser()
	return err == nil && tu.User.Sid.Equals(user)
}

// LockResult tek örnek mutex'inin sonucu.
type LockResult int

const (
	// LockAcquired bu süreç kullanıcının tepsi örneğidir.
	LockAcquired LockResult = iota
	// LockTaken aynı kullanıcının başka tepsi örneği çalışıyor (G-P20-13: bu süreç tepsiye inmez).
	LockTaken
	// LockForeign mutex başka bir sahibe ait veya açılamadı (G-P20-16): tek örnek kuralı yok sayılır, tepsi yine
	// başlar; diag `tray_mutex_foreign`.
	LockForeign
)

// Lock süreç ömrü boyunca tutulan tepsi mutex'i (handle kapanınca işletim sistemi bırakır).
type Lock struct{ h windows.Handle }

// Release mutex handle'ını kapatır (süreç çıkışında kendiliğinden de kapanır).
func (l *Lock) Release() {
	if l != nil && l.h != 0 {
		_ = windows.CloseHandle(l.h)
		l.h = 0
	}
}

// Acquire `Local\NoktaDestek.Tray.<SID özeti>` mutex'ini oluşturur. Var olan mutex'in sahibi geçerli kullanıcı değilse
// (başka kullanıcının önceden oluşturduğu ad — DoS) LockForeign döner.
//
// Mutex sahibi oluşturulurken açıkça kullanıcı SID'i yapılır ("O:<SID>"; DACL verilmez → belirtecin varsayılan
// DACL'i). Güvenlik tanımlayıcısız (nil) oluşturmada sahip belirtecin TokenOwner'ıdır; yükseltilmiş yönetici
// belirtecinde bu BUILTIN\Administrators olduğundan aynı kullanıcının ikinci örneği sahibi "başkası" sanıp
// LockForeign alırdı (Windows CI). Kullanıcı SID'i her belirteçte geçerli sahiptir (ayrıcalık gerekmez).
func Acquire() (*Lock, LockResult) {
	tu, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, LockForeign
	}
	user := tu.User.Sid
	name, err := windows.UTF16PtrFromString(MutexName(user.String()))
	if err != nil {
		return nil, LockForeign
	}
	sd, err := windows.SecurityDescriptorFromString("O:" + user.String())
	if err != nil {
		return nil, LockForeign
	}
	sa := windows.SecurityAttributes{SecurityDescriptor: sd}
	sa.Length = uint32(unsafe.Sizeof(sa))
	h, err := windows.CreateMutex(&sa, false, name)
	switch {
	case err == nil:
		return &Lock{h: h}, LockAcquired
	case h == 0 || !errors.Is(err, windows.ERROR_ALREADY_EXISTS):
		return nil, LockForeign // ör. ERROR_ACCESS_DENIED: başka sahibin kısıtlı DACL'li nesnesi
	}
	owned := ownedBy(h, user)
	_ = windows.CloseHandle(h)
	if owned {
		return nil, LockTaken
	}
	return nil, LockForeign
}

func ownedBy(h windows.Handle, user *windows.SID) bool {
	sd, err := windows.GetSecurityInfo(h, windows.SE_KERNEL_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return false
	}
	owner, _, err := sd.Owner()
	return err == nil && owner != nil && owner.Equals(user)
}
