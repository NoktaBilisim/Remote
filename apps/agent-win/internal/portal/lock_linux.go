//go:build linux

package portal

import (
	"context"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

// GNOME kilit ekranı (mimari-p28g §5.2b m.1, §13 S-P28g-1/2): `org.gnome.ScreenSaver.ActiveChanged(true)` sinyali
// (yalnız kayıtlı adın şu anki sahibinden, S-P28g-10) + 1 sn `GetActive` yoklaması. Sahip değişirse eşleme yeniden
// kurulur. Okunamayan durum Known=false'tur (kontrol verilmez; açıksa kapanır — fail-closed).
const (
	saverName   = "org.gnome.ScreenSaver"
	saverPath   = dbus.ObjectPath("/org/gnome/ScreenSaver")
	saverIface  = "org.gnome.ScreenSaver"
	lockPoll    = time.Second
	lockTimeout = 800 * time.Millisecond
)

// LockState kilit ekranı durumu.
type LockState struct {
	Known  bool // durum okunabildi (GetActive yanıt verdi)
	Locked bool
}

// LockWatcher kilit izleyicisi.
type LockWatcher struct {
	bus      Bus
	onChange func(LockState)

	mu    sync.Mutex
	state LockState
	owner string
	sub   *Sub
}

// WatchLock izleyiciyi başlatır; ilk durum dönmeden önce eşzamanlı ölçülür. onChange her değişiklikte (izleyici
// goroutine'inden) çağrılır. ctx bitince durur.
func WatchLock(ctx context.Context, b Bus, onChange func(LockState)) *LockWatcher {
	w := &LockWatcher{bus: b, onChange: onChange}
	w.mu.Lock()
	w.state = w.refresh()
	w.mu.Unlock()
	go w.loop(ctx)
	return w
}

// State son bilinen durum.
func (w *LockWatcher) State() LockState {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.state
}

// refresh sahibi denetler (değiştiyse yeniden abone olur) ve GetActive okur. w.mu altında.
func (w *LockWatcher) refresh() LockState {
	owner, err := w.bus.Owner(saverName)
	if err != nil || owner == "" {
		w.dropSub()
		return LockState{}
	}
	if owner != w.owner || w.sub == nil {
		w.dropSub()
		sub, err := w.bus.Watch(Match{Sender: owner, Path: saverPath, Iface: saverIface, Member: "ActiveChanged"})
		if err != nil {
			return LockState{}
		}
		w.owner, w.sub = owner, sub
	}
	ctx, cancel := context.WithTimeout(context.Background(), lockTimeout)
	defer cancel()
	body, err := w.bus.Call(ctx, owner, saverPath, saverIface+".GetActive")
	var active bool
	if err != nil || dbus.Store(body, &active) != nil {
		return LockState{}
	}
	return LockState{Known: true, Locked: active}
}

func (w *LockWatcher) dropSub() {
	if w.sub != nil {
		w.sub.Cancel()
		w.sub = nil
	}
	w.owner = ""
}

// set durumu yazar ve değiştiyse bildirir.
func (w *LockWatcher) set(st LockState) {
	w.mu.Lock()
	changed := st != w.state
	w.state = st
	w.mu.Unlock()
	if changed && w.onChange != nil {
		w.onChange(st)
	}
}

func (w *LockWatcher) loop(ctx context.Context) {
	t := time.NewTicker(lockPoll)
	defer t.Stop()
	defer func() {
		w.mu.Lock()
		w.dropSub()
		w.mu.Unlock()
	}()
	for {
		w.mu.Lock()
		var c <-chan *dbus.Signal
		if w.sub != nil {
			c = w.sub.C
		}
		w.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case sig := <-c:
			var active bool
			if dbus.Store(sig.Body, &active) == nil {
				w.set(LockState{Known: true, Locked: active})
			}
		case <-t.C:
			w.mu.Lock()
			st := w.refresh()
			w.mu.Unlock()
			w.set(st)
		}
	}
}
