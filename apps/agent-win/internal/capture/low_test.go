package capture

import (
	"errors"
	"testing"
	"time"

	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

func newLowRig() (*lowStage, *fakeEncoder, *[]rtc.Frame) {
	enc := &fakeEncoder{}
	out := &[]rtc.Frame{}
	l := &lowStage{open: func(int, int) (Encoder, error) { return enc, nil }}
	l.SetLowSink(func(f rtc.Frame) { *out = append(*out, f) })
	return l, enc, out
}

// AC-371: ana hat 30 FPS kare verse de düşük kodlayıcı ≤ 8 FPS ve 1 Mbps tavanla çalışır; ilk kare anahtar karedir.
func TestAC371LowEncoderAtMost8FPS(t *testing.T) {
	l, enc, out := newLowRig()
	l.EnableLow(true)
	f := NewNV12(64, 64)
	t0 := time.Unix(1000, 0)
	for i := range 30 {
		l.step(f, t0.Add(time.Duration(i)*time.Second/30))
	}
	if n := len(*out); n < signal.LowFPSMin || n > signal.LowFPS {
		t.Fatalf("1 sn'de düşük kare: %d (beklenen %d..%d)", n, signal.LowFPSMin, signal.LowFPS)
	}
	if enc.bitrate != signal.LowBPS || len(enc.keys) == 0 || !enc.keys[0] {
		t.Fatalf("bitrate %d, anahtarlar %v", enc.bitrate, enc.keys)
	}
}

// AC-371: ikincil eş yokken düşük kodlayıcı çalışmaz ve kapanır; açılınca ilk kare yine anahtar karedir.
func TestAC371LowEncoderOnlyWhileEnabled(t *testing.T) {
	l, enc, out := newLowRig()
	f := NewNV12(64, 64)
	now := time.Unix(1000, 0)
	l.step(f, now)
	if enc.calls != 0 || len(*out) != 0 {
		t.Fatal("kapalıyken kodlandı")
	}
	l.EnableLow(true)
	l.step(f, now.Add(time.Second))
	l.EnableLow(false)
	l.step(f, now.Add(2*time.Second))
	if enc.calls != 1 || enc.closed != 1 {
		t.Fatalf("çağrı %d, kapanış %d", enc.calls, enc.closed)
	}
	l.EnableLow(true)
	l.step(f, now.Add(3*time.Second))
	if !enc.keys[len(enc.keys)-1] {
		t.Fatal("yeniden açılışta anahtar kare yok")
	}
}

// Düşük kodlayıcı açılamazsa/hata verirse yalnız düşük akış kapanır (ana hat etkilenmez); PLI ayrı saatte.
func TestAC371LowEncoderFailureIsolated(t *testing.T) {
	l := &lowStage{open: func(int, int) (Encoder, error) { return nil, errors.New("mft") }}
	l.SetLowSink(func(rtc.Frame) { t.Fatal("kare beklenmiyordu") })
	l.EnableLow(true)
	l.step(NewNV12(64, 64), time.Unix(1, 0))
	if l.active() || l.pending() {
		t.Fatal("hata sonrası düşük akış açık kaldı")
	}
	var main keyClock
	l2, _, _ := newLowRig()
	l2.EnableLow(true)
	l2.RequestLowKeyframe()
	if main.Pending() || !l2.pending() {
		t.Fatal("düşük anahtar kare isteği ayrı saatte olmalı")
	}
}
