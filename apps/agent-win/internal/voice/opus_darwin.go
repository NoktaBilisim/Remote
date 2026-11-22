//go:build darwin

package voice

import "sync"

// Opus arka ucu macOS (mimari-p33 K-P33-1, ADR-0043): kodlama ana süreçte AudioToolbox AudioConverter ile (girdi kendi
// mikrofonumuz), çözme sandbox'lı yardımcı süreçte (opushelper_darwin.go). darwin ikilisine wazero/libopus.wasm
// bağlanmaz. FEC çözme yok (PLC Apple'da); kodlayıcıda karmaşıklık/uygulama seçimi yok (V-P33-A2).

// Encoder 48 kHz mono 20 ms Opus kodlayıcı (AudioToolbox, 32 kbit/s). Eşzamanlı kullanım güvenli değildir.
type Encoder struct {
	mu sync.Mutex
	e  *atEncoder
}

// NewEncoder kodlayıcı kurar.
func NewEncoder() (*Encoder, error) {
	e, err := newATEncoder()
	if err != nil {
		return nil, err
	}
	return &Encoder{e: e}, nil
}

// Encode 960 örneklik (20 ms) çerçeveyi bir Opus paketine kodlar. Dönen dilim bir sonraki çağrıya kadar geçerlidir.
func (e *Encoder) Encode(pcm []int16) ([]byte, error) {
	if len(pcm) != FrameSamples*Channels {
		return nil, ErrFrameSize
	}
	if e.e == nil {
		return nil, errClosed
	}
	return e.e.encode(pcm)
}

// Lookahead kodlayıcı gecikmesi (örnek; kAudioConverterPrimeInfo leading).
func (e *Encoder) Lookahead() (int, error) {
	if e.e == nil {
		return 0, errClosed
	}
	return e.e.lookahead()
}

// Close kodlayıcıyı bırakır; ikinci çağrı zararsızdır.
func (e *Encoder) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.e != nil {
		e.e.c.close()
		e.e = nil
	}
	return nil
}

// darwinBackend görüşme başına bir çözücü yardımcısı.
type darwinBackend struct{ h *helperProc }

// openBackend yoklama geçtiyse görüşmenin yardımcısını arka planda başlatır (ilk paketler gelene dek jitter tamponlar).
func openBackend() (backend, error) {
	if !Supported() {
		return nil, errATUnavailable
	}
	h := newHelperProc()
	h.mu.Lock()
	h.ensureStart()
	h.mu.Unlock()
	return darwinBackend{h: h}, nil
}

func (b darwinBackend) newDecoder() (frameDecoder, error) { return newDecoderWith(b.h.newCodec) }
func (b darwinBackend) newEncoder() (frameEncoder, error) { return NewEncoder() }
func (b darwinBackend) close()                            { b.h.close() }
