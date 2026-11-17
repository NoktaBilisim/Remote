//go:build linux

package capture

import (
	"sync/atomic"

	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/portal"
)

// lockSource kilit ekranı izleyicisinin durumu (deps_linux.go bağlar; portal.LockWatcher.State).
var lockSource atomic.Pointer[func() portal.LockState]

// SetLockSource EnvProbe'un okuyacağı kilit durumu kaynağı.
func SetLockSource(fn func() portal.LockState) { lockSource.Store(&fn) }

// EnvProbe AC-105 Linux karşılığı (mimari-p28g §2 `env/probe_linux.go`; flow.Deps.EnvProbe): GNOME kilit ekranı
// etkinse SecureDesktop=true → teknisyende "Müşteri güvenli masaüstünde". Kontrolün kapanması (REVOKED, ≤ 100 ms)
// bu yoklamaya değil izleyicinin sinyaline bağlıdır (input, K3); okunamayan durum burada uyarı üretmez, kontrolü
// engeller. Yükseltilmiş ön plan penceresi Linux'ta yoktur.
func EnvProbe() env.State {
	if fn := lockSource.Load(); fn != nil {
		st := (*fn)()
		return env.State{SecureDesktop: st.Known && st.Locked}
	}
	return env.State{}
}
