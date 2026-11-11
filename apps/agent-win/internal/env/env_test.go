package env

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestAC105WatchEmitsInitialAndChangesOnly(t *testing.T) {
	var cur atomic.Value
	cur.Store(State{})
	out := make(chan State, 8)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go Watch(ctx, func() State { return cur.Load().(State) }, time.Millisecond, func(s State) { out <- s })
	if s := <-out; s != (State{}) {
		t.Fatalf("ilk durum: %+v", s)
	}
	cur.Store(State{ElevatedForeground: true})
	if s := <-out; !s.ElevatedForeground {
		t.Fatalf("yükseltilmiş pencere bildirilmedi: %+v", s)
	}
	cur.Store(State{SecureDesktop: true})
	if s := <-out; !s.SecureDesktop || s.ElevatedForeground {
		t.Fatalf("güvenli masaüstü: %+v", s)
	}
	time.Sleep(20 * time.Millisecond)
	if len(out) != 0 {
		t.Fatal("değişmeyen durum yeniden bildirilmemeli")
	}
}
