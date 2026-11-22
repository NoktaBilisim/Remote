//go:build darwin

package voice

import (
	"errors"
	"os"
	"testing"
	"time"
)

// K-P33-2 / AC-535: AudioQueue giriş + çıkış açılır, mikrofon örnek verir, Close ≤ 1 sn içinde döner ve sonrasında
// okuma/yazma hata verir. Mikrofonu gerçekten açtığı için yalnız NOKTA_AUDIOQUEUE_TEST=1 ile koşar (CI test-macos ve
// elle doğrulama); aygıt yoksa SKIP.
func TestP33K1AudioQueueOpenReadClose(t *testing.T) {
	if os.Getenv("NOKTA_AUDIOQUEUE_TEST") != "1" {
		t.Skip("mikrofonu açar: NOKTA_AUDIOQUEUE_TEST=1 ile koşun")
	}
	dev, err := OpenAudioQueue()
	if errors.Is(err, ErrDeviceNotFound) {
		t.Skip("ses aygıtı yok")
	}
	if err != nil {
		t.Fatal(err)
	}
	pcm := make([]int16, FrameSamples)
	for i := range 25 {
		if err := dev.ReadFrame(pcm); err != nil {
			t.Fatalf("çerçeve %d: %v", i, err)
		}
		if err := dev.WriteFrame(silentFrame[:]); err != nil {
			t.Fatal(err)
		}
	}
	start := time.Now()
	if err := dev.Close(); err != nil {
		t.Fatal(err)
	}
	if el := time.Since(start); el > time.Second {
		t.Fatalf("Close %v > 1 sn", el)
	}
	t.Logf("Close %v", time.Since(start))
	if dev.ReadFrame(pcm) == nil || dev.WriteFrame(pcm) == nil || dev.Close() != nil {
		t.Fatal("kapalı aygıt")
	}
}

// AudioQueue hata sınıfları: '!dev' → aygıt yok; diğerleri genel aygıt hatası; durma → aygıt kayboldu.
func TestP33K1AudioQueueErrorClasses(t *testing.T) {
	if !errors.Is(&AQError{Op: "x", Status: kAudioHardwareBadDeviceError}, ErrDeviceNotFound) ||
		!errors.Is(&AQError{Op: "x", Status: -50}, ErrDevice) || !errors.Is(errStalled, ErrDeviceLost) {
		t.Fatal("sınıflama")
	}
}
