//go:build linux

package input

import (
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/portal"
)

// P28g K3 Wayland yolu (mimari-p28g §5.2 Wayland sütunu, §5.2b m.3/m.5, §14 m.6–7): portal RemoteDesktop Notify*
// çağrıları. Koordinat portal akışına görelidir (LinuxInjector sanal dikdörtgeni = akış). Düğmeler evdev BTN_*.
//   - Notify hatası (izin yok, oturum kapandı) çökme değil "kontrol yok" demektir: kapı kapanır, akışa bildirilir (onFail).
//   - Klavye ısınması (D-P28g-T2-3): yalnız kontrol VERİLDİĞİ anda (kapı açıkken) Shift bas-bırak; ardından 1 sn tuş
//     basmaları düşer (sanal klavye oluşurken ilk tuşlar kayboluyordu, K0s-6). Bırakmalar ve fare geçer. Oturum başında
//     ve kapı kapalıyken enjeksiyon yoktur.

// notifier portal.Session'ın girdi yüzü (testte sahte).
type notifier interface {
	PointerMotionAbsolute(x, y float64) error
	PointerButton(button int32, down bool) error
	PointerAxisDiscrete(axis uint32, steps int32) error
	KeyboardKeycode(code int32, down bool) error
	KeyboardKeysym(sym int32, down bool) error
}

// warmDelay ısınmadan sonra tuş basmalarının düştüğü süre.
const warmDelay = time.Second

// portalSink linSink (Wayland).
type portalSink struct {
	mu     sync.Mutex
	s      notifier
	warmTo time.Time
	now    func() time.Time
	onFail func() // ilk Notify hatasında bir kez (kapı kapatılır)
	failed atomic.Bool
}

func newPortalSink(onFail func()) *portalSink { return &portalSink{now: time.Now, onFail: onFail} }

// setSession yeni portal oturumu (önceki kapanmıştır).
func (p *portalSink) setSession(s notifier) {
	p.mu.Lock()
	p.s = s
	p.mu.Unlock()
	p.failed.Store(false)
}

var errNoSession = errors.New("input: portal oturumu yok")

// warm kontrol verildiği anda (gate.OnOpen) ayrı goroutine'de çağrılır.
func (p *portalSink) warm() {
	p.mu.Lock()
	s := p.s
	p.warmTo = p.now().Add(warmDelay)
	p.mu.Unlock()
	if s == nil {
		return
	}
	if s.KeyboardKeycode(evLeftShift, true) != nil || s.KeyboardKeycode(evLeftShift, false) != nil {
		p.fail()
	}
}

func (p *portalSink) fail() {
	if !p.failed.Swap(true) && p.onFail != nil {
		go p.onFail()
	}
}

// apply linSink. Isınma süresinde tuş basmaları düşer.
func (p *portalSink) apply(ops []linOp) error {
	p.mu.Lock()
	s, warming := p.s, p.now().Before(p.warmTo)
	p.mu.Unlock()
	if s == nil {
		return errNoSession
	}
	for _, op := range ops {
		if warming && op.down && (op.kind == opKey || op.kind == opSym) {
			continue
		}
		if err := notifyOp(s, op); err != nil {
			p.fail()
			return err
		}
	}
	return nil
}

// notifyOp tek işlemin portal karşılığı.
func notifyOp(s notifier, op linOp) error {
	switch op.kind {
	case opMove:
		return s.PointerMotionAbsolute(op.x, op.y)
	case opButton:
		b := map[uint8]int32{btnLeft: portal.BtnLeft, btnMiddle: portal.BtnMiddle, btnRight: portal.BtnRight}[op.button]
		if b == 0 {
			return nil
		}
		return s.PointerButton(b, op.down)
	case opWheel:
		axis := portal.AxisV
		if op.axis == 1 {
			axis = portal.AxisH
		}
		return s.PointerAxisDiscrete(axis, op.steps)
	case opKey:
		return s.KeyboardKeycode(int32(op.code), op.down)
	case opSym:
		return s.KeyboardKeysym(int32(op.sym), op.down)
	}
	return nil
}
