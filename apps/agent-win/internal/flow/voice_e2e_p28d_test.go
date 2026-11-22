//go:build !darwin

// P33 K1: darwin'de voice.New çözücüyü .app içi sandbox'lı yardımcıda çalıştırır; flow test ikilisi paket değildir ve
// yardımcı kipini taşımaz. darwin eşdeğeri internal/voice opus_darwin_test.go (gerçek yardımcıyla gidiş-dönüş).

package flow

import (
	"math"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/voice"
)

// Saha düzeltmesi 1 (teknisyen → müşteri sesi duyulmuyordu): flow + gerçek ses motoru (internal/voice, libopus.wasm)
// uçtan uca. Teknisyen eşinin rtc.Handlers.Audio'suna gelen Opus paketleri (voiceAudio(tid) → Call.Push) talker
// kapısından geçip çözülür ve sahte aygıtın çalma çıkışına sessiz olmayan örnek olarak düşer. Push'taki tid ile
// voice.state talkers'taki tid aynı yoldan (s.peers anahtarı + named()) gelir; uyuşmazlık bu testte sessizlik olurdu.
// flow motoru içe aktarmaz (sınır); bu bağlama yalnız testte, cmd/noktadestek'teki gibi Deps.OpenVoice üzerinden yapılır.

// e2eDev mikrofon saatini 20 ms ticker'la taklit eder (sessiz mikrofon); çalma çıkışındaki sesli çerçeveleri sayar.
type e2eDev struct {
	tick    *time.Ticker
	closed  chan struct{}
	once    sync.Once
	audible atomic.Int64
}

func (d *e2eDev) ReadFrame(pcm []int16) error {
	select {
	case <-d.tick.C:
		clear(pcm)
		return nil
	case <-d.closed:
		return voice.ErrDevice
	}
}

func (d *e2eDev) WriteFrame(pcm []int16) error {
	for _, s := range pcm {
		if s != 0 {
			d.audible.Add(1)
			break
		}
	}
	return nil
}

func (d *e2eDev) Close() error {
	d.once.Do(func() { close(d.closed); d.tick.Stop() })
	return nil
}

func TestP28dVoiceTechToCustomerPlaysEndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("gerçek kodlayıcı (-short)")
	}
	dev := &e2eDev{tick: time.NewTicker(20 * time.Millisecond), closed: make(chan struct{})}
	op := &fakeOpener{real: func(onFail func(error)) (VoiceCall, error) {
		c, err := voice.New(func() (voice.Device, error) { return dev, nil }, onFail)
		if err != nil {
			return nil, err
		}
		return c, nil
	}}
	v := startVoice(t, op)
	v.ask(t, call1)
	v.c.toClient <- vstate("pending", call1, nil, []string{tidA, tidB})
	eventually(t, "pending diyaloğu", func() bool { return len(v.asksNow()) >= 2 })
	v.h.events <- Event{Kind: EvVoiceAccept, CallID: call1}
	if a, ok := v.nextVoice(t).(signal.VoiceAnswer); !ok || !a.Accept {
		t.Fatalf("voice.answer{true} beklenirdi: %+v", a)
	}
	recv(t, v.op.started)
	v.c.toClient <- vstate("active", call1, []string{tidA}, []string{tidA, tidB})

	enc, err := voice.NewEncoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = enc.Close() }()
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() { // Chrome gibi: 20 ms'de bir Opus çerçevesi (440 Hz), RTP sırasıyla
		defer close(done)
		pcm := make([]int16, voice.FrameSamples)
		tk := time.NewTicker(20 * time.Millisecond)
		defer tk.Stop()
		for seq, n := uint16(1000), 0; ; seq++ {
			for i := range pcm {
				pcm[i] = int16(8000 * math.Sin(2*math.Pi*440*float64(n)/voice.SampleRate))
				n++
			}
			pkt, err := enc.Encode(pcm)
			if err != nil {
				return
			}
			v.pa.h.Audio(seq, pkt)
			select {
			case <-stop:
				return
			case <-tk.C:
			}
		}
	}()
	// Yorumlayıcı (arm64) ve -race altında çerçeve başına onlarca ms: eventually'nin 5 sn'si yerine 60 sn.
	for deadline := time.Now().Add(60 * time.Second); dev.audible.Load() == 0; time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("zaman aşımı: müşteri hoparlöründe teknisyen sesi yok")
		}
	}
	close(stop)
	<-done
	v.h.events <- Event{Kind: EvVoiceEnd}
	eventually(t, "aygıt bırakıldı", func() bool {
		select {
		case <-dev.closed:
			return true
		default:
			return false
		}
	})
}
