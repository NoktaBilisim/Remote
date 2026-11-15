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
}

func newLive(ind Indicator) *liveIndicator {
	l := &liveIndicator{failed: make(chan struct{})}
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
func (l *liveIndicator) rebind(show func(string) (Indicator, error), text string) (string, error) {
	l.detach()
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
func follow(ctx context.Context, d Deps, live *liveIndicator, text string) {
	f := desktop.Follower{
		Name:     d.InputDesktop,
		Bind:     func() (string, error) { return live.rebind(d.ShowIndicator, text) },
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
