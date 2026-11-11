package capture

import (
	"sync"
	"time"
)

// Kare hızı ve anahtar kare hedefleri (AC-41; mimari §Aşama 2 eksikleri: GOP ≤ 2 sn).
const (
	targetFPS     = 30
	minFPS        = 15
	fpsStep       = 5
	gopDuration   = 2 * time.Second
	keyMinGap     = 500 * time.Millisecond // PLI/FIR selinde en sık zorlanan anahtar kare
	idleKeepAlive = time.Second            // ekran değişmezken son kare bu aralıkla yeniden kodlanır
)

// rateCtl yakalama+dönüştürme+kodlama süresine göre kare hızını hedef (30) ile alt sınır (15) arasında ayarlar.
// Ortalama maliyet karenin bütçesinin %90'ını aşarsa hız düşer; 2 sn boyunca bütçenin yarısının altında kalırsa artar.
type rateCtl struct {
	fps  int
	avg  time.Duration
	good int
}

func newRateCtl() *rateCtl { return &rateCtl{fps: targetFPS} }

// Interval iki kare arasındaki hedef süre.
func (r *rateCtl) Interval() time.Duration { return time.Second / time.Duration(r.fps) }

// FPS geçerli hedef kare hızı.
func (r *rateCtl) FPS() int { return r.fps }

// Observe bir karenin maliyetini kaydeder; hedef kare hızı değiştiyse true döner.
func (r *rateCtl) Observe(cost time.Duration) bool {
	if r.avg == 0 {
		r.avg = cost
	} else {
		r.avg = (r.avg*7 + cost) / 8
	}
	budget := r.Interval()
	switch {
	case r.avg > budget*9/10 && r.fps > minFPS:
		r.fps = max(minFPS, r.fps-fpsStep)
		r.good = 0
		return true
	case r.avg < budget/2 && r.fps < targetFPS:
		r.good++
		if r.good >= 2*r.fps {
			r.fps = min(targetFPS, r.fps+fpsStep)
			r.good = 0
			return true
		}
	default:
		r.good = 0
	}
	return false
}

// bitrateFor çözünürlük ve kare hızına göre CBR hedefi (~0,075 bit/piksel; 1080p30 ≈ 4,7 Mbit/s), 0,3–8 Mbit/s arası.
func bitrateFor(w, h, fps int) int {
	b := w * h * fps * 3 / 40
	return min(8_000_000, max(300_000, b))
}

// keyClock anahtar kare zamanlaması: periyodik (GOP) ve istek üzerine (PLI/FIR, yeni yayın), istekler keyMinGap ile
// sınırlı. Request başka goroutine'den çağrılabilir.
type keyClock struct {
	mu   sync.Mutex
	req  bool
	last time.Time
}

// Request bir sonraki uygun karede anahtar kare ister.
func (k *keyClock) Request() {
	k.mu.Lock()
	k.req = true
	k.mu.Unlock()
}

// Due now anında anahtar kare zorlanmalı mı.
func (k *keyClock) Due(now time.Time) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.last.IsZero() || now.Sub(k.last) >= gopDuration {
		return true
	}
	return k.req && now.Sub(k.last) >= keyMinGap
}

// Pending bekleyen istek var mı (ekran değişmese de hemen kodlamak için).
func (k *keyClock) Pending() bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.req
}

// Mark kodlayıcı anahtar kare ürettiğinde çağrılır (kendiliğinden üretilenler dahil).
func (k *keyClock) Mark(now time.Time) {
	k.mu.Lock()
	k.req = false
	k.last = now
	k.mu.Unlock()
}
