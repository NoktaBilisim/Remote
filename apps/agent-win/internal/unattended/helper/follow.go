package helper

import (
	"context"
	"errors"
	"slices"
	"sync"
	"time"

	"remote-support/agent-win/internal/annot"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/servis/helperio"
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
	base     string // sunucu etiketi
	rec      bool   // P28e: kayıt sürüyor → etikete helperio.RecordingSuffix (AC-448)
	names    string // P28c: bağlı teknisyen adları eki (flow.MultiTexts.IndicatorList + adlar); tek sahipte boş
	ann      annotState
}

// annotState P30 (mimari-p30 §3): çizim durumu yardımcı süreçte tutulur; gösterge (katman) yalnız boyar. Masaüstü
// değişiminde yeni göstergeye aynı liste verilir (K-P30-1).
type annotState struct {
	strokes []annot.Stroke
	laser   *[2]float64
	laserAt time.Time
	surface int
}

// confirmer etiketin çizildiğini doğrulayabilen gösterge (Windows: yeniden çizim + doğrulama sonrası). P28c Y-PC-4:
// yeni teknisyen adı ancak doğrulanınca eşi kurulur.
type confirmer interface {
	Drawn(text string, wait time.Duration) bool
}

// nameMaxRunes gösterge ekindeki bir adın en çok uzunluğu (etiket genişliği monitöre sığsın); fazlası "…".
const nameMaxRunes = 40

// drawWait yeni etiketin çizim doğrulaması için en çok bekleme.
const drawWait = 2 * time.Second

// labeler etiketi yerinde değiştirebilen gösterge (Windows: yeniden çiz + doğrula; başarısızsa Failed — fail-closed).
type labeler interface{ SetText(string) }

// newLive ind zaten helperio.IndicatorLabel(base, rec) ile çizilmiş olmalıdır.
func newLive(ind Indicator, base string, rec bool) *liveIndicator {
	l := &liveIndicator{failed: make(chan struct{}), base: base, rec: rec}
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
	l.mu.Lock()
	l.ann.laser = nil // K-P30-1: lazer geçişte düşer; çizimler yeni masaüstünde yeniden boyanır
	l.paint()
	l.mu.Unlock()
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

// Text geçerli (çizilen) etiket; masaüstü geçişinde yeni gösterge bununla çizilir.
func (l *liveIndicator) Text() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.label()
}

// label etiket: sunucu metni + (P28c) adlar + (P28e) kayıt eki. l.mu tutulurken.
func (l *liveIndicator) label() string { return helperio.IndicatorLabel(l.base+l.names, l.rec) }

// SetNames P28c (§6 gözetimsiz, Y-PC-4): göstergeye bağlı teknisyen adlarını yazar ve çizimin doğrulanmasını bekler.
// Ek zaten yazılıysa da çizim yeniden doğrulanır (D-PC-K1: önceki doğrulama zaman aşımına uğramışsa aynı roster
// doğrulamasız kabul edilmez). Gösterge doğrulayamıyorsa false (eş kurulmaz); doğrulanamayan çizim ayrıca göstergeyi
// başarısız sayar (oturum biter).
func (l *liveIndicator) SetNames(suffix string) bool {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return false
	}
	l.mu.Unlock()
	l.update(func() { l.names = suffix }) // ek aynıysa yeniden çizim yok; doğrulama yine aşağıda
	l.mu.Lock()
	text, cur := l.label(), l.cur
	l.mu.Unlock()
	c, ok := cur.(confirmer)
	return ok && c.Drawn(text, drawWait)
}

// SetRecording P28e `rec.state{on}`: eki ekler/kaldırır (AC-448). Ek çizilemezse gösterge başarısızdır (fail-closed).
func (l *liveIndicator) SetRecording(on bool) { l.update(func() { l.rec = on }) }

// update etiketi değiştirir ve yeniden çizdirir. Gösterge etiket değiştiremiyorsa başarısız sayılır.
func (l *liveIndicator) update(change func()) {
	l.mu.Lock()
	if l.closed {
		l.mu.Unlock()
		return
	}
	old := l.label()
	change()
	text := l.label()
	if text == old {
		l.mu.Unlock()
		return
	}
	cur := l.cur
	l.mu.Unlock()
	if lb, ok := cur.(labeler); ok {
		lb.SetText(text)
		return
	}
	l.fail()
}

// Annot P30 (AC-494): kontrol sahibinin işaretleme iletisini uygular ve geçerli göstergeye boyatır. Akış döngüsünü
// bloklamaz (Paint anlık görüntü + ileti).
func (l *liveIndicator) Annot(m dc.Ctl) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	var set bool
	l.ann.strokes, l.ann.laser, set = annot.Apply(l.ann.strokes, l.ann.laser, m)
	if set {
		l.ann.laserAt = time.Now()
	}
	l.paint()
}

// SetSurface P30 (K-P30-4): paylaşılan monitör değişti; katman yeni monitöre taşınır, çizimler korunur.
func (l *liveIndicator) SetSurface(id int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed || id == l.ann.surface {
		return
	}
	l.ann.surface = id
	l.paint()
}

// paint geçerli göstergeye çizim anlık görüntüsünü verir (l.mu tutulurken: sıra korunur, eski görüntü yenisini ezmez).
// Süresi dolmuş lazer atılır (sonraki çizim eski lazeri yeniden göstermez).
func (l *liveIndicator) paint() {
	p, ok := l.cur.(painter)
	if !ok {
		return
	}
	if l.ann.laser != nil && time.Since(l.ann.laserAt) > laserTTL {
		l.ann.laser = nil
	}
	p.Paint(annotSnap{Strokes: slices.Clone(l.ann.strokes), Laser: l.ann.laser, LaserAt: l.ann.laserAt,
		Surface: l.ann.surface})
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
