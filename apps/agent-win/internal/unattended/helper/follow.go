package helper

import (
	"context"
	"errors"
	"sync"

	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/rtc"
)

// K6b (mimari-p27 §5.2 K-P27-1, §5.5 r2 O-P27-4): giriş masaüstü değişince önce yakalama/girdi kapısı kapanır, gösterge
// yeni masaüstünde çizilip doğrulanır, sonra kapı açılır; 2 sn içinde doğrulanamazsa oturum indicator_failed biter.

var errNoIndicator = errors.New("helper: gösterge oluşturulamadı")

// liveIndicator masaüstü değişimlerinde yenilenen göstergeyi tek Indicator olarak sunar: geçerli göstergenin Failed'i
// ya da masaüstü izleyicisinin hatası tek Failed kanalını kapatır.
type liveIndicator struct {
	mu       sync.Mutex
	cur      Indicator
	stop     chan struct{} // geçerli göstergenin Failed iletimini durdurur
	failed   chan struct{}
	failOnce sync.Once
	closed   bool
	text     string // geçerli etiket (P28u silent: izleme ↔ kontrol); masaüstü geçişinde yeni gösterge bununla çizilir
}

// labeler etiketi yerinde değiştirebilen gösterge (Windows: yeniden çiz + doğrula; başarısızsa Failed — fail-closed).
type labeler interface{ SetText(string) }

func newLive(ind Indicator, text string) *liveIndicator {
	l := &liveIndicator{failed: make(chan struct{}), text: text}
	l.watch(ind)
	return l
}

func (l *liveIndicator) watch(ind Indicator) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.stop != nil {
		close(l.stop)
	}
	l.cur, l.stop = ind, make(chan struct{})
	go func(failed <-chan struct{}, stop <-chan struct{}) {
		select {
		case <-failed:
			l.fail()
		case <-stop:
		}
	}(ind.Failed(), l.stop)
}

// rebind göstergeyi o anki giriş masaüstünde yeniden kurar (show orada çizip doğrular), eskisini kapatır; bağlanılan
// masaüstünün adını döner. Geçiş boyunca eski (artık görünmeyen) göstergenin hatası dinlenmez: kapı zaten kapalıdır,
// sonucu izleyicinin bütçesi belirler.
func (l *liveIndicator) rebind(show func(string) (Indicator, error)) (string, error) {
	l.detach()
	text := l.Text()
	n, err := show(text)
	if err != nil {
		return "", err
	}
	if n == nil {
		return "", errNoIndicator
	}
	l.mu.Lock()
	old, closed := l.cur, l.closed
	l.mu.Unlock()
	if closed { // oturum geçiş sırasında bitti
		n.Close()
		return "", errNoIndicator
	}
	l.watch(n)
	if now := l.Text(); now != text { // etiket çizim sırasında değişti
		if lb, ok := n.(labeler); ok {
			lb.SetText(now)
		} else {
			l.fail()
		}
	}
	go old.Close() // eski masaüstü artık görünmüyor; kapanışı yeni göstergeyi bekletmez
	return n.Desktop(), nil
}

func (l *liveIndicator) detach() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.stop != nil {
		close(l.stop)
		l.stop = nil
	}
}

// Text geçerli etiket.
func (l *liveIndicator) Text() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.text
}

// SetText P28u §7.6: etiketi değiştirir (aynı pencereler, ≤ 1 sn). Gösterge etiket değiştiremiyorsa başarısız sayılır.
func (l *liveIndicator) SetText(text string) {
	l.mu.Lock()
	if l.text == text || l.closed {
		l.mu.Unlock()
		return
	}
	l.text = text
	cur := l.cur
	l.mu.Unlock()
	if lb, ok := cur.(labeler); ok {
		lb.SetText(text)
		return
	}
	l.fail()
}

func (l *liveIndicator) fail() { l.failOnce.Do(func() { close(l.failed) }) }

// Failed Indicator.
func (l *liveIndicator) Failed() <-chan struct{} { return l.failed }

// Desktop Indicator.
func (l *liveIndicator) Desktop() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.cur.Desktop()
}

// Close Indicator.
func (l *liveIndicator) Close() {
	l.detach()
	l.mu.Lock()
	cur := l.cur
	l.closed = true
	l.mu.Unlock()
	cur.Close()
}

// follow masaüstü izleyicisini başlatır; doğrulanamazsa göstergeyi başarısız sayar (oturum indicator_failed biter).
func follow(ctx context.Context, d Deps, live *liveIndicator) {
	f := desktop.Follower{
		Name:     d.InputDesktop,
		Bind:     func() (string, error) { return live.rebind(d.ShowIndicator) },
		Resumed:  d.Resumed,
		Gate:     d.Gate,
		Interval: d.FollowInterval,
		Timeout:  d.FollowTimeout,
	}
	bound := live.Desktop()
	go func() {
		if err := f.Run(ctx, bound); err != nil {
			live.fail()
		}
	}()
}

// gatedFlow yakalama ve girdiyi masaüstü kapısına bağlar (doğrulama öncesi kare/girdi yok).
func gatedFlow(d flow.Deps, g *desktop.Gate) flow.Deps {
	open := d.Capture
	if open != nil {
		d.Capture = func(id int) (rtc.Source, error) {
			return desktop.Source(g, func() (rtc.Source, error) { return open(id) })
		}
	}
	d.Input = desktop.Input(g, d.Input)
	return d
}
