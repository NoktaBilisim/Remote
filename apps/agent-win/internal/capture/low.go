package capture

import (
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// P28c (mimari-p28c §6.1, ADR-0035, AC-371): düşük akış. Ana hattın yakaladığı aynı NV12 kare ikinci bir kodlayıcıyla
// en çok signal.LowFPS kare/sn ve signal.LowBPS sabit tavanla kodlanır; yalnız ≥ 1 ikincil eş varken açıktır (EnableLow).
// Ayrı keyClock: düşük izin PLI/FIR'i ana kodlayıcıya IDR zorlatmaz. Düşük kodlayıcı hatası ana akışı durdurmaz;
// düşük akış o kaynak için kapanır (ikincil eşler görüntü almaz, kontrol sahibi etkilenmez).

// lowInterval iki düşük kare arası en kısa süre (8 FPS → 125 ms).
const lowInterval = time.Second / signal.LowFPS

// lowStage düşük kodlayıcı aşaması; step yalnız yakalama iş parçacığından, diğer yöntemler her goroutine'den çağrılır.
type lowStage struct {
	on   atomic.Bool
	sink atomic.Pointer[func(rtc.Frame)]
	kc   keyClock

	open   func(w, h int) (Encoder, error) // yakalama iş parçacığında kodlayıcı açar
	enc    Encoder
	w, h   int
	last   time.Time // son Encode çağrısı (kare hızı sınırı)
	failed bool
}

// SetLowSink rtc.LowSource.
func (l *lowStage) SetLowSink(sink func(rtc.Frame)) {
	if sink == nil {
		l.sink.Store(nil)
		return
	}
	l.sink.Store(&sink)
}

// EnableLow rtc.LowSource.
func (l *lowStage) EnableLow(on bool) {
	if on && !l.on.Load() {
		l.kc.Request()
	}
	l.on.Store(on)
}

// RequestLowKeyframe rtc.LowSource.
func (l *lowStage) RequestLowKeyframe() { l.kc.Request() }

// active düşük akış açık ve alıcısı var.
func (l *lowStage) active() bool { return l.on.Load() && l.sink.Load() != nil && !l.failed }

// pending düşük iz anahtar kare bekliyor (ekran değişmese de kare üretilmeli).
func (l *lowStage) pending() bool { return l.active() && l.kc.Pending() }

// step ana hattın karesi f ile (zamanı geldiyse) düşük kareyi kodlayıp alıcıya verir.
func (l *lowStage) step(f *NV12, now time.Time) {
	if !l.active() || f == nil {
		l.close()
		return
	}
	if !l.last.IsZero() && now.Sub(l.last) < lowInterval {
		return
	}
	if l.enc == nil || l.w != f.W || l.h != f.H {
		l.close()
		enc, err := l.open(f.W, f.H)
		if err != nil {
			l.failed = true
			return
		}
		enc.SetBitrate(signal.LowBPS)
		l.enc, l.w, l.h = enc, f.W, f.H
		l.kc.Request()
	}
	dur := lowInterval
	if !l.last.IsZero() {
		dur = now.Sub(l.last)
	}
	l.last = now
	au, key, err := l.enc.Encode(f, dur, l.kc.Due(now))
	if err != nil {
		l.failed = true
		l.close()
		return
	}
	if len(au) == 0 {
		return
	}
	if key {
		l.kc.Mark(now)
	}
	if p := l.sink.Load(); p != nil {
		(*p)(rtc.Frame{Data: au, Duration: dur})
	}
}

// close düşük kodlayıcıyı kapatır (yeniden açılınca ilk kare anahtar kare olur).
func (l *lowStage) close() {
	if l.enc != nil {
		l.enc.Close()
		l.enc = nil
		l.last = time.Time{}
	}
}
