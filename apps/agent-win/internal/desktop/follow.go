// Package desktop gözetimsiz yardımcının giriş masaüstünü izlemesidir (P27 K6b; mimari-p27 §5.2 K-P27-1, §5.5 r2
// O-P27-4). Giriş ekranı, kilit ekranı ve UAC onayı aynı mekanizmayla karşılanır: giriş masaüstünün adı 250 ms'de bir
// okunur; değişince ÖNCE kapı kapanır (kare gönderilmez, girdi düşürülür), sonra gösterge yeni masaüstünde çizilip
// doğrulanır, ANCAK sonra kapı yeni bir dönemle açılır. Zaman aşımı (2 sn) içinde doğrulanamazsa ErrIndicator.
// Platformdan bağımsız durum makinesi burada (Linux'ta birim testli); Windows çağrıları follow_windows.go'dadır.
package desktop

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Varsayılanlar (mimari-p27 §5.2: 250 ms yoklama, §5.5: 2 sn doğrulama bütçesi).
const (
	DefaultInterval = 250 * time.Millisecond
	DefaultTimeout  = 2 * time.Second
)

// ErrIndicator masaüstü değişiminden sonra gösterge bütçe içinde doğrulanamadı (çıkış `indicator_failed`).
var ErrIndicator = errors.New("desktop: gösterge yeni masaüstünde doğrulanamadı")

// Gate yakalama ve girdinin masaüstü kapısı. Açıkken bir dönemi (epoch) vardır; her doğrulanmış masaüstü bağlanışı
// yeni dönem açar. Dönemi değişen kaynak yeniden açılır, girdi iş parçacığı yeni masaüstüne geçer.
type Gate struct {
	mu     sync.Mutex
	open   bool
	epoch  uint64
	opened chan struct{} // kapalıyken: açılınca kapanır
}

// NewGate açık kapı (dönem 1): yardımcı ilk göstergeyi doğruladıktan sonra oturuma başlar.
func NewGate() *Gate { return &Gate{open: true, epoch: 1} }

// State dönem ve kapının açık olup olmadığı.
func (g *Gate) State() (epoch uint64, open bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.epoch, g.open
}

// Wait kapı açılana dek bekler; açık dönemi döner.
func (g *Gate) Wait(ctx context.Context) (uint64, error) {
	for {
		g.mu.Lock()
		if g.open {
			ep := g.epoch
			g.mu.Unlock()
			return ep, nil
		}
		ch := g.opened
		g.mu.Unlock()
		select {
		case <-ch:
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}
}

func (g *Gate) pause() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.open {
		g.open, g.opened = false, make(chan struct{})
	}
}

func (g *Gate) resume() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.open {
		g.open, g.epoch = true, g.epoch+1
		close(g.opened)
	}
}

// Follower giriş masaüstünü izler.
type Follower struct {
	// Name giriş masaüstünün adı (Windows: InputName). Hata → masaüstü bilinmiyor; kapı kapanır.
	Name func() (string, error)
	// Bind göstergeyi o anki giriş masaüstünde yeniden çizer ve doğrular; bağlandığı masaüstünün adını döner.
	Bind func() (string, error)
	// Resumed kapı yeniden açıldıktan hemen sonra (isteğe bağlı; yardımcı: basılı kalan tuş/düğmeleri bırakır).
	Resumed  func()
	Gate     *Gate
	Interval time.Duration // 0 → DefaultInterval
	Timeout  time.Duration // 0 → DefaultTimeout
}

// Run bound masaüstünden başlayarak izler. Bağlam bitince nil, gösterge doğrulanamazsa ErrIndicator döner (kapı kapalı
// kalır: hiçbir kare/girdi geçmez).
func (f *Follower) Run(ctx context.Context, bound string) error {
	t := time.NewTicker(orDefault(f.Interval, DefaultInterval))
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
		}
		if name, err := f.Name(); err == nil && name == bound {
			continue
		}
		next, err := f.switchTo(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		bound = next
	}
}

// switchTo O-P27-4 sırası: kapıyı kapat → göstergeyi giriş masaüstünde doğrula (bağlandığı ad hâlâ giriş masaüstü
// olmalı) → kapıyı aç. Bütçe dolarsa ErrIndicator.
func (f *Follower) switchTo(ctx context.Context) (string, error) {
	f.Gate.pause()
	interval := orDefault(f.Interval, DefaultInterval)
	deadline := time.Now().Add(orDefault(f.Timeout, DefaultTimeout))
	for {
		left := time.Until(deadline)
		if left <= 0 {
			return "", ErrIndicator
		}
		if got, err := bindWithin(f.Bind, left); err == nil {
			if name, nerr := f.Name(); nerr == nil && name == got {
				f.Gate.resume()
				if f.Resumed != nil {
					f.Resumed()
				}
				return got, nil
			}
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(min(interval, max(time.Until(deadline), 0))):
		}
	}
}

// bindWithin Bind'i en çok left süre bekler (askıda kalan çizim bütçeyi aşmasın; süreç zaten indicator_failed çıkar).
func bindWithin(bind func() (string, error), left time.Duration) (string, error) {
	type result struct {
		name string
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		n, err := bind()
		ch <- result{n, err}
	}()
	t := time.NewTimer(left)
	defer t.Stop()
	select {
	case r := <-ch:
		return r.name, r.err
	case <-t.C:
		return "", ErrIndicator
	}
}

func orDefault(d, def time.Duration) time.Duration {
	if d <= 0 {
		return def
	}
	return d
}
