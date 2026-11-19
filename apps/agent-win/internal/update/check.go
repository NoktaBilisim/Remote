package update

import (
	"context"
	"math/rand/v2"
	"time"
)

// Denetim sıklığı (AC-478): açılışta 1 kez + 24 sa ± 2 sa rastgele sapma (200 istemci aynı dakikada denetlemesin).
const (
	CheckInterval = 24 * time.Hour
	CheckJitter   = 2 * time.Hour
)

// NextInterval r ∈ [0,1) → [22 sa, 26 sa).
func NextInterval(r float64) time.Duration {
	if r < 0 || r >= 1 {
		r = 0.5
	}
	return CheckInterval - CheckJitter + time.Duration(r*float64(2*CheckJitter))
}

// Timer zamanlayıcı soyutlaması (testte sahte saat).
type Timer func(d time.Duration) <-chan time.Time

// RunChecks check'i hemen (açılış) ve ardından her NextInterval'da bir çağırır; ctx bitince döner. Ağ hatası check'in
// içinde sessizce yutulur (AC-478: hata penceresi yok, sonraki dönem). timer nil ise time.After; rnd nil ise math/rand/v2.
func RunChecks(ctx context.Context, timer Timer, rnd func() float64, check func(context.Context)) {
	if timer == nil {
		timer = time.After
	}
	if rnd == nil {
		rnd = rand.Float64
	}
	for {
		if ctx.Err() != nil {
			return
		}
		check(ctx)
		select {
		case <-ctx.Done():
			return
		case <-timer(NextInterval(rnd())):
		}
	}
}
