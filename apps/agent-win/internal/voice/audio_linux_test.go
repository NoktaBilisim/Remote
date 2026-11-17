//go:build linux

package voice

import (
	"errors"
	"os"
	"testing"
	"time"
)

// P28g K5 (AC-402/P28d, K0s-10): pulse hata sınıflaması her Linux'ta; gerçek aygıt yalnız pulse sunucusu varsa
// (spike imajı: pipewire-pulse/pulseaudio null sink; yoksa görünür SKIP).

func TestAC402P28gClassifyPulseErrors(t *testing.T) {
	for _, c := range []struct {
		code int32
		want error
	}{{paErrConnectionRefused, ErrDeviceNotFound}, {paErrNoEntity, ErrDeviceNotFound},
		{paErrConnectionTerminated, ErrDeviceLost}, {paErrKilled, ErrDeviceLost}, {paErrAccess, ErrDevice}, {99, ErrDevice}} {
		err := error(&PAError{Op: "x", Code: c.code})
		if !errors.Is(err, c.want) || !errors.Is(err, ErrDevice) && c.want == ErrDevice {
			t.Errorf("%d → %v", c.code, err)
		}
	}
}

func TestAC402LinuxPulseDeviceRoundTrip(t *testing.T) {
	if os.Getenv("XDG_RUNTIME_DIR") == "" {
		t.Skip("pulse sunucusu yok (XDG_RUNTIME_DIR boş)")
	}
	d, err := OpenPulse()
	if errors.Is(err, ErrDeviceNotFound) {
		t.Skipf("pulse sunucusu/aygıtı yok: %v", err)
	}
	if err != nil {
		t.Fatal(err)
	}
	mic, spk := make([]int16, FrameSamples), make([]int16, FrameSamples)
	for i := range spk {
		spk[i] = int16(i)
	}
	start := time.Now()
	const frames = 250 // 5 sn
	for i := 0; i < frames; i++ {
		if err := d.ReadFrame(mic); err != nil {
			t.Fatalf("çerçeve %d: %v", i, err)
		}
		if err := d.WriteFrame(spk); err != nil {
			t.Fatal(err)
		}
	}
	el := time.Since(start)
	if el < 4*time.Second || el > 9*time.Second {
		t.Fatalf("250 çerçeve %v (20 ms saat değil; üst sınır Rosetta 22.04 pulseaudio vekili ≈ 7 sn)", el)
	}
	t0 := time.Now()
	_ = d.Close()
	if c := time.Since(t0); c > 500*time.Millisecond {
		t.Fatalf("Close %v (AC-374 ≤ 1 sn)", c)
	}
	if err := d.ReadFrame(mic); err == nil {
		t.Fatal("Close sonrası okuma")
	}
	info := d.(*pulseDevice).Info()
	t.Logf("süre %v, çalınan örnek %d, atılan %d", el, info.Rendered, info.RenderDropped)
	// Motor üzerinden: voice.New + Close mikrofonu ≤ 1 sn bırakır.
	c, err := New(OpenPulse, func(error) {})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	t0 = time.Now()
	_ = c.Close()
	if d := time.Since(t0); d > time.Second {
		t.Fatalf("Call.Close %v", d)
	}
}
