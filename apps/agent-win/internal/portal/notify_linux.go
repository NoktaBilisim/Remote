//go:build linux

package portal

import (
	"context"
	"time"

	"github.com/godbus/dbus/v5"
)

// notifyTimeout tek Notify* çağrısının üst sınırı (girdi çağrıları Applier kilidi altında eşzamanlıdır).
const notifyTimeout = time.Second

// Düğme ve eksen değerleri (RemoteDesktop belgesi; düğme evdev BTN_* kodudur).
const (
	BtnLeft   int32  = 0x110
	BtnRight  int32  = 0x111
	BtnMiddle int32  = 0x112
	AxisV     uint32 = 0
	AxisH     uint32 = 1
)

// notify RemoteDesktop.Notify* çağrısı. Oturum kapalıysa ErrClosed; portal hatası ("not allowed", "Invalid session")
// ErrNotAllowed (§14 m.6: çökme değil "izin yok").
func (s *Session) notify(method string, args ...any) error {
	select {
	case <-s.closed:
		return ErrClosed
	default:
	}
	ctx, cancel := context.WithTimeout(context.Background(), notifyTimeout)
	defer cancel()
	if _, err := s.bus.Call(ctx, s.owner, desktopPath, ifRemote+"."+method,
		append([]any{s.handle, map[string]dbus.Variant{}}, args...)...); err != nil {
		return ErrNotAllowed
	}
	return nil
}

// PointerMotionAbsolute işaretçiyi akış koordinatına (piksel, akış boyutu içinde) taşır.
func (s *Session) PointerMotionAbsolute(x, y float64) error {
	return s.notify("NotifyPointerMotionAbsolute", s.stream.Node, x, y)
}

// PointerButton evdev düğme kodu basma/bırakma.
func (s *Session) PointerButton(button int32, down bool) error {
	return s.notify("NotifyPointerButton", button, state(down))
}

// PointerAxisDiscrete tekerlek çentiği (axis AxisV/AxisH; steps + aşağı/sağ).
func (s *Session) PointerAxisDiscrete(axis uint32, steps int32) error {
	return s.notify("NotifyPointerAxisDiscrete", axis, steps)
}

// KeyboardKeycode evdev tuş kodu basma/bırakma.
func (s *Session) KeyboardKeycode(code int32, down bool) error {
	return s.notify("NotifyKeyboardKeycode", code, state(down))
}

// KeyboardKeysym X keysym basma/bırakma (metin karakterleri; düzenden bağımsız).
func (s *Session) KeyboardKeysym(sym int32, down bool) error {
	return s.notify("NotifyKeyboardKeysym", sym, state(down))
}

func state(down bool) uint32 {
	if down {
		return 1
	}
	return 0
}
