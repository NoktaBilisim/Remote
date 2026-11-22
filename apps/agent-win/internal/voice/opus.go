// Package voice: P28d sesli görüşme (ADR-0036). Bu dosya Opus kodek politikasının ortak kısmıdır: sabit biçim, hatalar,
// uzaktan gelen yük için sıra (talker kapısı çağıranda → boyut ≤ 1275 → hız ≤ 100 paket/sn → düşürülmüş eş değil) ve
// tuzak/panik sayacı (3'te eş düşer). Kütüphane arka ucu platforma göre seçilir (mimari-p33 §2, ADR-0043):
// opus_libopus.go (Windows/Linux: libopus.wasm, wazero) ve opus_darwin.go (macOS: AudioToolbox; çözme sandbox'lı yardımcı
// süreçte, opushelper_darwin.go). Arka uç Call'a backend arayüzüyle bağlanır.
package voice

import (
	"errors"
	"fmt"
	"time"
)

// Sabit biçim (ADR-0036 m.1): 48 kHz, mono, 20 ms çerçeve.
const (
	SampleRate    = 48000
	Channels      = 1
	FrameSamples  = SampleRate / 50 // 20 ms = 960 örnek
	maxFrame      = 5760            // Opus'un en uzun paketi (120 ms @ 48 kHz); karşı taraf 20 ms dışı gönderebilir
	maxPacketSize = 1275            // RFC 6716 §3.2.1 tek çerçeve üst sınırı
	targetBitrate = 32000
	maxPacketRate = 100 // eş başına paket/sn (20 ms → 50; 10 ms çerçeve gönderen eşe pay)
	maxPanics     = 3   // aynı eşte bu sayıda tuzak/panikte eşin sesi düşer (mimari-p28d r2)
)

// ErrFrameSize kodlayıcıya 20 ms dışında örnek verildi.
var ErrFrameSize = errors.New("voice: çerçeve 960 örnek (20 ms) olmalı")

// ErrPacketSize çözücüye boş olmayan ve 1275 bayttan uzun yük verildi (Y-PD-2; uzaktan gelen veri).
var ErrPacketSize = errors.New("voice: Opus yükü 1275 bayttan uzun")

// ErrCodecPanic libopus WASM örneği tuzağa düştü (sınır dışı bellek, unreachable, yığın taşması), çalışma zamanı
// panikledi (Y-PD-2) ya da kodlama/çözme çağrısı süre sınırını aştı (D-PD-K1-1). Hata yalıtılır; örneğin durumu bozulmuş sayılır: çözücü yeni örnekle yeniden kurulur, kodlayıcı
// kapatılır (çağıran yenisini kurar). Ayrıntı loga yazılmaz (yük içeriği taşıyabilir).
var ErrCodecPanic = errors.New("voice: Opus kodu tuzağa düştü")

// ErrRateLimited eşten saniyede 100'den çok paket geldi; paket çözülmeden atılır.
var ErrRateLimited = errors.New("voice: Opus paket hızı sınırı aşıldı")

// ErrPeerDropped çözücü bu eşte 3 kez tuzağa düştü; eşin sesi görüşme sonuna kadar düşer (çağıran izi bırakır).
var ErrPeerDropped = errors.New("voice: eşin sesi düşürüldü (yinelenen çözücü tuzağı)")

// errClosed kapatılmış kodlayıcı/çözücü kullanıldı (tuzak değildir; yeniden kurulum tetiklemez).
var errClosed = errors.New("voice: Opus örneği kapalı")

// opusError libopus'un negatif dönüş kodu (OPUS_BAD_ARG … OPUS_ALLOC_FAIL); bozuk paket için olağan hatadır.
type opusError int32

func (e opusError) Error() string {
	switch e {
	case -1:
		return "opus: geçersiz argüman"
	case -2:
		return "opus: tampon küçük"
	case -3:
		return "opus: iç hata"
	case -4:
		return "opus: bozuk paket"
	case -5:
		return "opus: desteklenmeyen istek"
	case -6:
		return "opus: geçersiz durum"
	case -7:
		return "opus: bellek ayrılamadı"
	}
	return fmt.Sprintf("opus: hata %d", int32(e))
}

// guard f'yi çalıştırır; çalışma zamanı paniği olursa ErrCodecPanic döner (WASM tuzakları zaten hata olarak gelir).
func guard(f func() error) (err error) {
	defer func() {
		if recover() != nil {
			err = ErrCodecPanic
		}
	}()
	return f()
}

// backend bir görüşmenin kodek arka ucu (mimari-p33 §2 codecBackend): Call kodlayıcı/çözücüleri buradan kurar ve görüşme
// bitince close çağrılır (darwin: çözücü yardımcısı öldürülür). close idempotent ve her goroutine'den güvenlidir.
type backend interface {
	newDecoder() (frameDecoder, error)
	newEncoder() (frameEncoder, error)
	close()
}

// Decoder 48 kHz mono Opus çözücü. Karşı tarafın stereo paketleri (Chrome `opus/48000/2`) mono'ya indirgenir.
// Eşzamanlı kullanım güvenli değildir; konuşan (tid) başına bir çözücü.
type Decoder struct {
	dec    codec
	newDec func() (codec, error)
	pcm    []int16

	now      func() time.Time
	winStart time.Time
	winCount int
	panics   int
}

// codec kütüphane çözücüsünün kullanılan yüzü (tuzak/düşürme politikası testte sahte çözücüyle sınanır).
type codec interface {
	Decode(packet []byte, pcm []int16, frameSize int, decodeFEC bool) (int, error)
	Close() error
}

// newDecoderWith politika katmanını verilen kütüphane çözücüsüyle kurar (tuzaktan sonra newDec ile yenisi kurulur).
func newDecoderWith(newDec func() (codec, error)) (*Decoder, error) {
	d, err := newDec()
	if err != nil {
		return nil, fmt.Errorf("voice: çözücü: %w", err)
	}
	return &Decoder{dec: d, newDec: newDec, pcm: make([]int16, maxFrame*Channels), now: time.Now}, nil
}

// admit uzaktan gelen yük için sıra (mimari-p28d r2): boyut ≤ 1275 → hız ≤ 100 paket/sn → düşürülmüş eş değil.
// Konuşma hakkı (talker kapısı) çağıranda denetlenir. count=false (DecodeFEC) hız sayacını artırmaz: kayıpta
// DecodeFEC(next) + Decode(next) aynı paketi iki kez okur ve tek paket sayılır (mimari-p28d r3 §4.3 K3 düzeltmesi);
// sınır o pencerede zaten dolmuşsa FEC de reddedilir (ardından gelecek Decode(next) reddedileceği için).
func (d *Decoder) admit(packet []byte, count bool) error {
	if len(packet) > maxPacketSize {
		return ErrPacketSize
	}
	if t := d.now(); t.Sub(d.winStart) >= time.Second {
		d.winStart, d.winCount = t, 0
	}
	if count {
		d.winCount++
	}
	if d.winCount > maxPacketRate || (!count && d.winCount >= maxPacketRate) {
		return ErrRateLimited
	}
	if d.panics >= maxPanics {
		return ErrPeerDropped
	}
	return nil
}

// Decode bir Opus paketini (ham RTP yükü) çözer. Dönen dilim bir sonraki çağrıya kadar geçerlidir.
func (d *Decoder) Decode(packet []byte) ([]int16, error) {
	if len(packet) == 0 {
		return d.Conceal()
	}
	if err := d.admit(packet, true); err != nil {
		return nil, err
	}
	return d.decode(packet, maxFrame, false, "çözme")
}

// decode kütüphane çağrısını tuzak yalıtımıyla yapar; tuzaktan sonra örneği kapatıp yenisini kurar (bozuk durum taşınmaz).
func (d *Decoder) decode(packet []byte, frame int, fec bool, op string) ([]int16, error) {
	var n int
	err := guard(func() (err error) { n, err = d.dec.Decode(packet, d.pcm, frame, fec); return err })
	if errors.Is(err, ErrCodecPanic) {
		d.panics++
		_ = guard(d.dec.Close)
		if d.panics >= maxPanics {
			return nil, ErrPeerDropped
		}
		if nd, nerr := d.newDec(); nerr == nil {
			d.dec = nd
		}
		return nil, err
	}
	if err != nil {
		return nil, fmt.Errorf("voice: %s: %w", op, err)
	}
	return d.pcm[:n*Channels], nil
}

// Conceal kayıp bir 20 ms çerçeve yerine PLC çıktısı üretir (libopus: paket yok → kayıp gizleme).
func (d *Decoder) Conceal() ([]int16, error) {
	if d.panics >= maxPanics {
		return nil, ErrPeerDropped
	}
	return d.decode(nil, FrameSamples, false, "PLC")
}

// DecodeFEC kayıp çerçeveyi, ARDINDAN gelen paketin bant içi FEC verisinden kurar (Chrome useinbandfec=1). Pakette
// FEC yoksa libopus PLC'ye düşer. Ardından gelen paketin kendisi ayrıca Decode ile çözülmelidir; hız sınırına
// yalnız o Decode sayılır.
func (d *Decoder) DecodeFEC(next []byte) ([]int16, error) {
	if err := d.admit(next, false); err != nil {
		return nil, err
	}
	return d.decode(next, FrameSamples, true, "FEC")
}

// Close çözücüyü bırakır; ikinci çağrı zararsızdır.
func (d *Decoder) Close() error { return guard(d.dec.Close) }
