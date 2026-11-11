// Package env müşteri masaüstünün kontrolü engelleyen durumlarını izler (AC-105): odaktaki pencere yükseltilmiş
// (UIPI nedeniyle SendInput ulaşmaz) ve Güvenli Masaüstü (UAC/Ctrl+Alt+Del/kilit ekranı; yakalama da durur).
// Değişiklik `env.state{elevatedForeground, secureDesktop}` olarak teknisyene bildirilir.
package env

import (
	"context"
	"time"
)

// State env.state alanları.
type State struct {
	ElevatedForeground bool
	SecureDesktop      bool
}

// Every yoklama aralığı (uyarının ≤ 1 sn içinde görünmesi için).
const Every = 500 * time.Millisecond

// Watch probe'u every aralıkla yoklar; ilk değer ve her değişiklikte emit çağrılır. ctx bitince döner.
func Watch(ctx context.Context, probe func() State, every time.Duration, emit func(State)) {
	last := probe()
	emit(last)
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if s := probe(); s != last {
				last = s
				emit(s)
			}
		}
	}
}
