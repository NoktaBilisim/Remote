//go:build linux

package input

import (
	"errors"
	"sync"
	"unsafe"

	"remote-support/agent-win/internal/linux/glib"
	"remote-support/agent-win/internal/linux/x11"
)

// P28g K3 (mimari-p28g §5.4 "X11 FFI kuralları", D-P28g-T2-2; §14 m.1; ADR-0038 m.6): XTest, XI2 ve XGrabKey için
// libX11 + libXi + libXtst purego bağlamaları. Kitaplıklar yalnız izin listeli mutlak yoldan açılır; sembol yoksa hata
// (fail-closed, kontrol yok). X hata/IO işleyicisi KURULMAZ: XTest/XI2 Display'inde X hatası süreç çıkışıdır (kabul,
// m.2). Kısayol hataları GDK hata tuzağıyla ana iş parçacığında alınır (x11.Trap).
//
// C yapı alanları yalnız aşağıdaki adlı sabit ofsetlerden okunur (amd64 LP64). Sabitler CI'da libx11-dev/libxi-dev
// başlıklarından üretilen dosyayla (P28G_XI2_OFFSETS) TestP28gK3XI2OffsetsMatchHeaders içinde karşılaştırılır.
const (
	sizeXEvent = 192 // sizeof(XEvent)

	offCookieType      = 0  // XGenericEventCookie.type (int)
	offCookieExtension = 32 // XGenericEventCookie.extension (int)
	offCookieEvtype    = 36 // XGenericEventCookie.evtype (int)
	offCookieData      = 48 // XGenericEventCookie.data (void*)

	offRawEvtype   = 36 // XIRawEvent.evtype
	offRawSourceid = 52 // XIRawEvent.sourceid

	sizeEventMask     = 16 // sizeof(XIEventMask)
	offMaskDeviceid   = 0  // XIEventMask.deviceid
	offMaskLen        = 4  // XIEventMask.mask_len
	offMaskPtr        = 8  // XIEventMask.mask
	sizeDeviceInfo    = 40 // sizeof(XIDeviceInfo)
	offInfoDeviceid   = 0  // XIDeviceInfo.deviceid
	offInfoName       = 8  // XIDeviceInfo.name (char*)
	offInfoUse        = 16 // XIDeviceInfo.use
	offInfoAttachment = 20 // XIDeviceInfo.attachment

	offClientWindow = 32 // XClientMessageEvent.window
	offClientFormat = 48 // XClientMessageEvent.format

	offKeyType    = 0  // XKeyEvent.type
	offKeyState   = 80 // XKeyEvent.state
	offKeyKeycode = 84 // XKeyEvent.keycode
)

// X protokol sabitleri (X.h, XI2.h).
const (
	xKeyPress      = 2
	xClientMessage = 33
	xGenericEvent  = 35

	xiAllDevices       = 0
	xiAllMasterDevices = 1
	xiSlavePointer     = 3
	xiSlaveKeyboard    = 4

	xiHierarchyChanged = 11
	xiRawKeyPress      = 13
	xiRawButtonRelease = 16
	xiRawMotion        = 17

	xShiftMask   = 1
	xLockMask    = 2
	xControlMask = 4
	xMod2Mask    = 16 // NumLock (Xorg varsayılan eşlemesi)

	grabModeAsync = 1

	xkShiftL         = 0xffe1
	xkISOLevel3Shift = 0xfe03
	xkF11            = 0xffc8
	xkF12            = 0xffc9
)

var xl struct {
	once sync.Once
	err  error

	openDisplay      func(name *byte) uintptr
	closeDisplay     func(d uintptr) int32
	defaultRoot      func(d uintptr) uint64
	flush            func(d uintptr) int32
	sync             func(d uintptr, discard int32) int32
	keysymToKeycode  func(d uintptr, sym uint64) uint8
	keycodeToKeysym  func(d uintptr, kc uint8, group, level int32) uint64 // XkbKeycodeToKeysym
	queryExtension   func(d uintptr, name *byte, op, ev, er *int32) int32
	nextEvent        func(d uintptr, ev unsafe.Pointer) int32
	getEventData     func(d uintptr, cookie unsafe.Pointer) int32
	freeEventData    func(d uintptr, cookie unsafe.Pointer)
	sendEvent        func(d uintptr, w uint64, propagate int32, mask int64, ev unsafe.Pointer) int32
	createSimpleWin  func(d uintptr, parent uint64, x, y int32, w, h, border uint32, bc, bg uint64) uint64
	queryPointer     func(d uintptr, w uint64, root, child *uint64, rx, ry, wx, wy *int32, mask *uint32) int32
	grabKey          func(d uintptr, kc int32, mods uint32, w uint64, owner int32, pm, km int32) int32
	ungrabKey        func(d uintptr, kc int32, mods uint32, w uint64) int32
	xiQueryVersion   func(d uintptr, maj, min *int32) int32
	xiSelectEvents   func(d uintptr, w uint64, masks unsafe.Pointer, n int32) int32
	xiQueryDevice    func(d uintptr, id int32, n *int32) uintptr
	xiFreeDeviceInfo func(info uintptr)
	xtQueryExtension func(d uintptr, ev, er, maj, min *int32) int32
	xtMotion         func(d uintptr, screen, x, y int32, delay uint64) int32
	xtButton         func(d uintptr, button uint32, press int32, delay uint64) int32
	xtKey            func(d uintptr, kc uint32, press int32, delay uint64) int32
}

var errXlibThreads = errors.New("input: XInitThreads yapılmadı")

// bindX kitaplıkları açar ve sembolleri bağlar. XInitThreads (x11.InitThreads, gtk.New'de) önce yapılmış olmalı.
func bindX() error {
	if !x11.Ready() {
		return errXlibThreads
	}
	xl.once.Do(func() {
		hx, err1 := glib.Open(glib.Path(glib.LibX11))
		hi, err2 := glib.Open(glib.Path(glib.LibXi))
		ht, err3 := glib.Open(glib.Path(glib.LibXtst))
		if xl.err = errors.Join(err1, err2, err3); xl.err != nil {
			return
		}
		xl.err = errors.Join(
			glib.Func(&xl.openDisplay, hx, "XOpenDisplay"),
			glib.Func(&xl.closeDisplay, hx, "XCloseDisplay"),
			glib.Func(&xl.defaultRoot, hx, "XDefaultRootWindow"),
			glib.Func(&xl.flush, hx, "XFlush"),
			glib.Func(&xl.sync, hx, "XSync"),
			glib.Func(&xl.keysymToKeycode, hx, "XKeysymToKeycode"),
			glib.Func(&xl.keycodeToKeysym, hx, "XkbKeycodeToKeysym"),
			glib.Func(&xl.queryExtension, hx, "XQueryExtension"),
			glib.Func(&xl.nextEvent, hx, "XNextEvent"),
			glib.Func(&xl.getEventData, hx, "XGetEventData"),
			glib.Func(&xl.freeEventData, hx, "XFreeEventData"),
			glib.Func(&xl.sendEvent, hx, "XSendEvent"),
			glib.Func(&xl.createSimpleWin, hx, "XCreateSimpleWindow"),
			glib.Func(&xl.queryPointer, hx, "XQueryPointer"),
			glib.Func(&xl.grabKey, hx, "XGrabKey"),
			glib.Func(&xl.ungrabKey, hx, "XUngrabKey"),
			glib.Func(&xl.xiQueryVersion, hi, "XIQueryVersion"),
			glib.Func(&xl.xiSelectEvents, hi, "XISelectEvents"),
			glib.Func(&xl.xiQueryDevice, hi, "XIQueryDevice"),
			glib.Func(&xl.xiFreeDeviceInfo, hi, "XIFreeDeviceInfo"),
			glib.Func(&xl.xtQueryExtension, ht, "XTestQueryExtension"),
			glib.Func(&xl.xtMotion, ht, "XTestFakeMotionEvent"),
			glib.Func(&xl.xtButton, ht, "XTestFakeButtonEvent"),
			glib.Func(&xl.xtKey, ht, "XTestFakeKeyEvent"),
		)
	})
	return xl.err
}

// at C belleğinde base+off adresindeki T değeri (yalnız adlı sabit ofsetlerle çağrılır).
func at[T any](base uintptr, off uintptr) T {
	p := *(*unsafe.Pointer)(unsafe.Pointer(&base)) // C belleği (Go GC'si yönetmez); vet unsafeptr kalıbı glib.GoString ile aynı
	return *(*T)(unsafe.Add(p, off))
}

// openXDisplay DISPLAY'e yeni bir Xlib bağlantısı (her iş parçacığı kendi Display'ini kullanır; m.1).
func openXDisplay() uintptr { return xl.openDisplay(nil) }

// xtestDevice XIQueryDevice dönüşünden XTEST alt aygıt kimlikleri (yalnız bu çağrıda okunur ve serbest bırakılır;
// m.3). Ad yalnız kimliği bulmak için kullanılır; karşılaştırma kimlikle yapılır (S-P28g-13).
func xtestDevices(d uintptr) []int32 {
	var n int32
	info := xl.xiQueryDevice(d, xiAllDevices, &n)
	if info == 0 {
		return nil
	}
	defer xl.xiFreeDeviceInfo(info)
	var ids []int32
	for i := int32(0); i < n && i < 256; i++ {
		base := info + uintptr(i)*sizeDeviceInfo
		use := at[int32](base, offInfoUse)
		if use != xiSlavePointer && use != xiSlaveKeyboard {
			continue
		}
		if isXTestName(glib.GoString(at[uintptr](base, offInfoName))) {
			ids = append(ids, at[int32](base, offInfoDeviceid))
		}
	}
	return ids
}
