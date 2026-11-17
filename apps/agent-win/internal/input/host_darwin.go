//go:build darwin

package input

import (
	"errors"
	"runtime"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/control"
)

// P28f K3 (mimari-p28f §5.2, S-P28f-10; ADR-0037 m.3): kapatma kısayolu (Carbon RegisterEventHotKey, Control+Shift+F12,
// yedek F11; ek izin istemez, arka planda çalışır) ve yerel girdi önceliği (AC-104) için olay musluğu.
//
//   - Musluk yalnız kapı açıkken kurulu (S7-7): gate.OnOpen kendi kilitli iş parçacığını uyandırır; iş parçacığı
//     musluğu kurar ve CFRunLoop'u 50 ms dilimlerle döndürür, kapı kapanınca kaldırır.
//   - Fail-closed: musluk kurulamazsa ya da sistem kapatıp (kCGEventTapDisabledBy*) yeniden açılamazsa, ya da
//     Erişilebilirlik izni geri alınırsa kapı gate.Shut ile ATOMİK kapanır (≤ 50 ms) ve onLost çağrılır
//     (akış control.state{VIEW, SYSTEM}). Kontrol isteğinde ControlReady aynı koşulları önceden yoklar (OS_PERMISSION).
//   - Musluk etkin (Default) seçenekle kurulur, olayı değiştirmeden döner: yalnız Erişilebilirlik izni gerekir
//     (ListenOnly Girdi İzleme izni isterdi; rehber yalnız Erişilebilirlik'i anlatır). Elle doğrulama listede.
//   - Geri çağrılar yalnız atomik okur/yazar (S7-3); bağlam Go işaretçisi değil, paket düzeyi atomikler (FFI kuralı 1).

const (
	cgSessionEventTap   = 1
	cgHeadInsertTap     = 0
	cgTapOptionDefault  = 0
	cgTapDisabledByTime = 0xFFFFFFFE
	cgTapDisabledByUser = 0xFFFFFFFF
	tapSlice            = 0.05 // sn: CFRunLoop dilimi = kapanış/izin yoklama aralığı
	carbonControlKey    = 0x1000
	carbonShiftKey      = 0x0200
	hotkeySig           = 0x4E4B4453 // 'NKDS'
)

// tapMask yerel girdi sayılan olay türleri: fare (basma/bırakma/hareket/sürükleme/tekerlek) ve klavye.
const tapMask = 1<<cgLeftMouseDown | 1<<cgLeftMouseUp | 1<<cgRightMouseDown | 1<<cgRightMouseUp | 1<<cgMouseMoved |
	1<<cgLeftMouseDragged | 1<<cgRightMouseDragged | 1<<cgKeyDown | 1<<cgKeyUp | 1<<cgFlagsChanged | 1<<cgScrollWheel |
	1<<cgOtherMouseDown | 1<<cgOtherMouseUp | 1<<cgOtherMouseDragged

type hotKeyID struct {
	Sig uint32
	ID  uint32
}

type eventTypeSpec struct {
	Class uint32
	Kind  uint32
}

// Geri çağrıların okuduğu süreç durumu (macOS istemcisinde tek oturum = tek Host).
var (
	hostGate   atomic.Pointer[control.Gate]
	hostHotkey atomic.Pointer[func()]
	hostLost   atomic.Pointer[func()]
	curTap     atomic.Uintptr
	tapCB      uintptr
	hotkeyCB   uintptr
)

// FFI kuralı 2: geri çağrı yuvaları yalnız init'te bir kez.
func init() {
	tapCB = purego.NewCallback(func(proxy uintptr, typ uint32, ev uintptr, ref uintptr) uintptr {
		switch typ {
		case cgTapDisabledByTime, cgTapDisabledByUser:
			if t := curTap.Load(); t != 0 {
				cg.tapEnable(t, true)
				if !cg.tapIsEnabled(t) {
					lose()
				}
			}
			return ev
		}
		if LocalInput(cg.getInt(ev, fieldSourcePID), cg.getInt(ev, fieldUserData)) {
			if g := hostGate.Load(); g != nil {
				g.Suspend(time.Now())
			}
		}
		return ev
	})
	hotkeyCB = purego.NewCallback(func(call, event, ud uintptr) int32 {
		if g := hostGate.Load(); g != nil {
			var after func()
			if f := hostHotkey.Load(); f != nil {
				after = *f
			}
			g.Shut(after) // ≤ 100 ms: atomik; bildirim ayrı goroutine'de (AC-102)
		}
		return 0
	})
}

// lose kapıyı atomik kapatır ve akışa bildirir (S-P28f-10).
func lose() {
	g := hostGate.Load()
	if g == nil {
		return
	}
	var after func()
	if f := hostLost.Load(); f != nil {
		after = *f
	}
	g.Shut(after)
}

// Host kısayol + olay musluğu. Hotkey kaydedilen kısayol; HotkeyErr control.ErrNoHotkey ise kontrol izni verilemez (G-21).
type Host struct {
	Hotkey    control.Hotkey
	HotkeyErr error
	hkRef     uintptr
	wake      chan struct{}
	stop      chan struct{}
	stopped   atomic.Bool
}

var errCarbon = errors.New("input: Carbon kısayolu kaydedilemedi")

// Start kısayolu kaydeder ve kapının açılışında musluğu kuracak iş parçacığını başlatır. ANA iş parçacığında, NSApp
// döngüsü başlamadan çağrılır (Carbon işleyicisi uygulama hedefine kurulur, ana döngüde çalışır). onHotkey kısayolda,
// onLost musluk/izin kaybında kapı kapandıktan sonra ayrı goroutine'de çağrılır.
func Start(g *control.Gate, onHotkey, onLost func()) *Host {
	hostGate.Store(g)
	hostHotkey.Store(&onHotkey)
	hostLost.Store(&onLost)
	h := &Host{wake: make(chan struct{}, 1), stop: make(chan struct{})}
	if err := bind(); err != nil {
		h.HotkeyErr = control.ErrNoHotkey
		return h
	}
	h.Hotkey, h.HotkeyErr = control.RegisterHotkey(h.register)
	h.Hotkey.Label = macLabel(h.Hotkey.Label)
	go h.tapLoop(g)
	g.OnOpen(func() {
		select {
		case h.wake <- struct{}{}:
		default:
		}
	})
	return h
}

// macLabel Windows etiketini Mac klavyesindeki adla yazar ("Ctrl+Shift+F12" → "Control+Shift+F12").
func macLabel(l string) string {
	if l == "" {
		return ""
	}
	return strings.Replace(l, "Ctrl+", "Control+", 1)
}

// register Carbon kısayolu (Control+Shift+F12 / F11). İşleyici bir kez kurulur.
func (h *Host) register(k control.Hotkey) error {
	kvk := map[uint32]uint32{control.HotkeyPrimary.VK: kvkF12, control.HotkeyFallback.VK: kvkF11}[k.VK]
	if kvk == 0 {
		return errCarbon
	}
	target := cg.appTarget()
	if target == 0 {
		return errCarbon
	}
	if !handlerInstalled.Load() {
		spec := eventTypeSpec{Class: 0x6B657962 /* 'keyb' */, Kind: 5 /* kEventHotKeyPressed */}
		var ref uintptr
		if cg.installHandler(target, hotkeyCB, 1, &spec, 0, &ref) != 0 {
			return errCarbon
		}
		handlerInstalled.Store(true)
	}
	var ref uintptr
	if cg.registerHotKey(kvk, carbonControlKey|carbonShiftKey, hotKeyID{Sig: hotkeySig, ID: 1}, target, 0, &ref) != 0 ||
		ref == 0 {
		return errCarbon
	}
	h.hkRef = ref
	return nil
}

var handlerInstalled atomic.Bool

// tapLoop musluk iş parçacığı (CFRunLoop bu OS iş parçacığına bağlıdır).
func (h *Host) tapLoop(g *control.Gate) {
	runtime.LockOSThread()
	for {
		select {
		case <-h.stop:
			return
		case <-h.wake:
		}
		if g.IsOpen() {
			h.runTap(g)
		}
	}
}

// runTap musluğu kurar ve kapı açık kaldıkça döndürür. Kurulamazsa ya da yeniden açılamazsa kapı kapanır.
func (h *Host) runTap(g *control.Gate) {
	tap := cg.tapCreate(cgSessionEventTap, cgHeadInsertTap, cgTapOptionDefault, tapMask, tapCB, 0)
	if tap == 0 {
		lose()
		return
	}
	src := cg.portSource(0, tap, 0)
	if src == 0 {
		cg.portInvalidate(tap)
		cg.release(tap)
		lose()
		return
	}
	rl := cg.rlCurrent()
	cg.rlAddSource(rl, src, cg.defaultMode)
	cg.tapEnable(tap, true)
	curTap.Store(tap)
	for g.IsOpen() && !h.stopped.Load() {
		cg.rlRunInMode(cg.defaultMode, tapSlice, false)
		if !cg.tapIsEnabled(tap) {
			cg.tapEnable(tap, true)
			if !cg.tapIsEnabled(tap) {
				lose()
				break
			}
		}
		if !cg.axTrusted() { // izin oturum sırasında geri alındı
			lose()
			break
		}
	}
	curTap.Store(0)
	cg.tapEnable(tap, false)
	cg.rlRemoveSource(rl, src, cg.defaultMode)
	cg.portInvalidate(tap)
	cg.release(src)
	cg.release(tap)
}

// Stop kısayolu kaldırır ve musluk iş parçacığını durdurur.
func (h *Host) Stop() {
	if h.stopped.Swap(true) {
		return
	}
	close(h.stop)
	if h.hkRef != 0 {
		cg.unregisterHK(h.hkRef)
		h.hkRef = 0
	}
}

// ControlReady AC-391 / S-P28f-10: kontrol verilebilir mi — CoreGraphics bağlı, olay işareti var, Erişilebilirlik izni
// verilmiş ve olay musluğu kurulabiliyor (deneme musluğu hemen kaldırılır). false → flow OS_PERMISSION gönderir.
// İzin her istekte yeniden yoklanır; izin verildikten sonra yeniden başlatma gerekmez.
func ControlReady() bool {
	if bind() != nil || marker == 0 || !cg.axTrusted() {
		return false
	}
	tap := cg.tapCreate(cgSessionEventTap, cgHeadInsertTap, cgTapOptionDefault, tapMask, tapCB, 0)
	if tap == 0 {
		return false
	}
	cg.tapEnable(tap, false)
	cg.portInvalidate(tap)
	cg.release(tap)
	return true
}
