//go:build windows

package input

import (
	"runtime"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/control"
)

var (
	pSetWindowsHookExW  = user32.NewProc("SetWindowsHookExW")
	pCallNextHookEx     = user32.NewProc("CallNextHookEx")
	pUnhookWindowsHook  = user32.NewProc("UnhookWindowsHookEx")
	pRegisterHotKey     = user32.NewProc("RegisterHotKey")
	pUnregisterHotKey   = user32.NewProc("UnregisterHotKey")
	pGetMessageW        = user32.NewProc("GetMessageW")
	pPostThreadMessageW = user32.NewProc("PostThreadMessageW")
)

const (
	whKeyboardLL   = 13
	whMouseLL      = 14
	wmQuit         = 0x0012
	wmHotkey       = 0x0312
	wmApp          = 0x8000
	wmHooksOn      = wmApp + 1
	wmHooksOff     = wmApp + 2
	modControl     = 0x0002
	modShift       = 0x0004
	modNoRepeat    = 0x4000
	hotkeyID       = 1
	llmhfInjected  = 0x01
	llkhfInjected  = 0x10
	hookMouseFlags = 12 // MSLLHOOKSTRUCT.flags ofseti (pt 8 + mouseData 4)
	hookKbdFlags   = 8  // KBDLLHOOKSTRUCT.flags ofseti (vkCode 4 + scanCode 4)
)

// Host global kapatma kısayolu (AC-102) ve düşük seviye fare/klavye kancaları (AC-104 yerel öncelik) için kendi
// mesaj döngüsü olan kilitli iş parçacığı.
//
// S7-7: kısayol program açılırken kaydedilir (G-21: izin diyaloğu kısayolun alınıp alınamadığını bilmeli), ama LL
// kancaları yalnız kapı açıkken kuruludur (gate.OnOpen → wmHooksOn, gate.OnCloseGen → wmHooksOff{nesil}; S7-16). Kancaların tek
// işi yerel önceliktir; enjekte tıklama ayrımı artık kancaya değil olayın kendi kaynağına bakar (internal/ui, S7-5).
//
// S7-3: bu iş parçacığında çalışan hiçbir kod kilit beklemez. Kanca prosedürleri yalnız atomik yazar; kısayol
// gate.Shut ile kapıyı atomik kapatır, ReleaseAll ve akış bildirimi ayrı goroutine'de çalışır. (SendInput,
// Applier kilidi tutulurken bu iş parçacığının kancayı işlemesini bekler.)
type Host struct {
	tid    uint32
	done   chan struct{}
	Hotkey control.Hotkey
	// HotkeyErr control.ErrNoHotkey ise kontrol izni verilemez (G-21).
	HotkeyErr error
}

var (
	cbOnce         sync.Once
	mouseCB, kbdCB uintptr
	hostGate       atomic.Pointer[control.Gate]
)

func flagsAt(lp uintptr, off uintptr) uint32 {
	p := *(*unsafe.Pointer)(unsafe.Pointer(&lp)) // lParam işletim sistemi belleğidir
	return *(*uint32)(unsafe.Add(p, off))
}

// onLocal AC-104: enjekte olmayan yerel olay uzaktan girdiyi 1 sn askıya alır. Yalnız atomik yazma (S7-3).
func onLocal(injected bool) {
	if !injected {
		if g := hostGate.Load(); g != nil {
			g.Suspend(time.Now())
		}
	}
}

func callbacks() {
	cbOnce.Do(func() {
		mouseCB = windows.NewCallback(func(code int, wp, lp uintptr) uintptr {
			if code >= 0 {
				onLocal(flagsAt(lp, hookMouseFlags)&llmhfInjected != 0)
			}
			r, _, _ := pCallNextHookEx.Call(0, uintptr(code), wp, lp)
			return r
		})
		kbdCB = windows.NewCallback(func(code int, wp, lp uintptr) uintptr {
			if code >= 0 {
				onLocal(flagsAt(lp, hookKbdFlags)&llkhfInjected != 0)
			}
			r, _, _ := pCallNextHookEx.Call(0, uintptr(code), wp, lp)
			return r
		})
	})
}

// Start kısayolu (yedeğiyle) kaydeder ve kapının açılış/kapanışına göre LL kancalarını kurup kaldırır. Kısayola
// basılınca kapı ÖNCE atomik kapatılır (gate.Shut; ≤ 100 ms, hiçbir şey beklenmez), onHotkey ayrı goroutine'de
// çağrılır (control.state{VIEW,HOTKEY}). Kanca kurulamazsa yerel öncelik çalışmaz ama kapı ve kısayol çalışır.
func Start(g *control.Gate, onHotkey func()) *Host {
	hostGate.Store(g)
	callbacks()
	h := &Host{done: make(chan struct{})}
	ready := make(chan struct{})
	go h.run(g, onHotkey, ready)
	<-ready
	g.OnOpen(func() { h.post(wmHooksOn, 0) })
	g.OnCloseGen(func(gen uint64) { h.post(wmHooksOff, uintptr(gen)) })
	return h
}

// run Host iş parçacığı: kısayolu kaydeder (sonra ready kapanır), GetMessage döngüsünü işletir; çıkışta kısayolu ve
// kancaları kaldırır.
func (h *Host) run(g *control.Gate, onHotkey func(), ready chan<- struct{}) {
	runtime.LockOSThread()
	defer close(h.done)
	h.tid = windows.GetCurrentThreadId()
	h.Hotkey, h.HotkeyErr = control.RegisterHotkey(registerHotkey)
	close(ready)
	var hooks llHooks
	var msg [48]byte // MSG (amd64)
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&msg[0])), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		hooks.dispatch(g, onHotkey, &msg)
	}
	if h.HotkeyErr == nil {
		_, _, _ = pUnregisterHotKey.Call(0, hotkeyID)
	}
	hooks.unhook()
}

func registerHotkey(k control.Hotkey) error {
	r, _, err := pRegisterHotKey.Call(0, hotkeyID, modControl|modShift|modNoRepeat, uintptr(k.VK))
	if r == 0 {
		return err
	}
	return nil
}

// llHooks Host iş parçacığının kurduğu LL fare/klavye kancaları (yalnız o iş parçacığında kullanılır).
type llHooks struct{ mouse, kbd uintptr }

// dispatch Host mesajı: kısayol → kapıyı kapat; wmHooksOn/wmHooksOff → kancaları kur/kaldır.
func (k *llHooks) dispatch(g *control.Gate, onHotkey func(), msg *[48]byte) {
	switch *(*uint32)(unsafe.Pointer(&msg[8])) {
	case wmHotkey:
		g.Shut(onHotkey)
	case wmHooksOn:
		if g.IsOpen() { // açılış mesajı kuyruktayken kapı kapandıysa kurma
			if k.mouse == 0 {
				k.mouse = hook(whMouseLL, mouseCB)
			}
			if k.kbd == 0 {
				k.kbd = hook(whKeyboardLL, kbdCB)
			}
		}
	case wmHooksOff:
		// S7-16: Shut'ın goroutine'inden gecikmiş gelen kaldırma isteği, arada yeniden açılmış kapının
		// kancalarını kaldırmaz; yalnız kapanan nesil hâlâ geçerliyse (kapı kapalı, yeniden açılmamış) uygulanır.
		if g.StillClosed(uint64(*(*uintptr)(unsafe.Pointer(&msg[16])))) { // MSG.wParam (amd64)
			k.unhook()
		}
	}
}

func (k *llHooks) unhook() {
	for _, x := range []*uintptr{&k.mouse, &k.kbd} {
		if *x != 0 {
			_, _, _ = pUnhookWindowsHook.Call(*x)
			*x = 0
		}
	}
}

// post LL kancalarını kurma/kaldırma isteğini Host iş parçacığına iletir (bloklamaz; kanca kuran iş parçacığı o).
// Kaldırma isteği wParam'da kapanan açılışın neslini taşır (S7-16).
func (h *Host) post(msg uint32, wp uintptr) {
	_, _, _ = pPostThreadMessageW.Call(uintptr(h.tid), uintptr(msg), wp, 0)
}

func hook(id int, cb uintptr) uintptr {
	var mod windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &mod) // kendi exe modülü
	r, _, _ := pSetWindowsHookExW.Call(uintptr(id), cb, uintptr(mod), 0)
	return r
}

// Stop kancaları ve kısayolu kaldırır.
func (h *Host) Stop() {
	_, _, _ = pPostThreadMessageW.Call(uintptr(h.tid), wmQuit, 0, 0)
	<-h.done
}
