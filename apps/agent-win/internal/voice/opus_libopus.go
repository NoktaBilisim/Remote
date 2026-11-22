//go:build !darwin

// Opus arka ucu Windows/Linux (ADR-0036 yedek 1, A-PD-1): libopus 1.6.1'in WebAssembly derlemesi (libopus.wasm,
// build/libopus-wasm.sh ile tekrarlanabilir üretilir) wazero (saf Go, CGO yok) içinde koşar. C kodu yalnız kendi doğrusal
// belleğine erişir; bozuk paket en kötü durumda WASM tuzağı (trap) üretir, Go yığınına/heap'ine dokunamaz (Y-PD-2).
// Modüle hiçbir ana makine işlevi (WASI dahil: dosya, ağ, saat) verilmez. Kodlayıcı ve çözücü başına ayrı örnek
// (instance) kurulur; bir örnekteki bozulma diğerine sızmaz. darwin ikilisine bağlanmaz (mimari-p33 K-P33-1).
package voice

import (
	"context"
	_ "embed"
	"encoding/binary"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

const (
	complexity    = 5
	memLimitPages = 256 // örnek başına doğrusal bellek üst sınırı: 256 × 64 KiB = 16 MiB (libopus.wasm --max-memory ile aynı)
)

// libopusWasm libopus 1.6.1 + nk_opus.c kabuğu (build/libopus-wasm.sh; SHA-256 libopus.wasm.sha256'da, test denetler).
//
//go:embed libopus.wasm
var libopusWasm []byte

// codecRuntime wazero çalışma zamanı + bir kez derlenmiş libopus modülü; süreç boyunca paylaşılır (eşzamanlı güvenli).
type codecRuntime struct {
	rt    wazero.Runtime
	mod   wazero.CompiledModule
	limit time.Duration // kodlama/çözme çağrısı süre sınırı (D-PD-K1-1)
}

var (
	sharedOnce sync.Once
	shared     *codecRuntime
	sharedErr  error
)

// Çerçeve başına çağrı süre sınırı (D-PD-K1-1). Sandbox bellek/yetki yalıtır ama süre sınırlamaz: bitmeyen bir
// nk_enc/nk_dec (libopus döngü hatası ya da JIT yanlış derlemesi, A-PD-3) ses döngüsünü süresiz takardı. Çalışma zamanı
// WithCloseOnContextDone(true) ile kurulur; süre dolunca wazero örneği kapatır ve çağrı hata döner → tuzak gibi
// ErrCodecPanic (çözücü yeniden kurulur, 3. olayda eş düşer; kodlayıcı kapatılır, çağıran yenisini kurar).
// Sınır asılı kalmayı sınırlamak içindir, gerçek zaman bütçesini değil: amd64 derleyicide çerçeve ~0,1–0,5 ms sürer;
// 200 ms (10 çerçeve) bunun yüzlerce katıdır, böylece yük altındaki makinede zamanlayıcı/GC duraklaması kalıcı eş
// düşürmesine (sayaç sıfırlanmaz) dönüşmez; gerçek bir sonsuz döngü ise en geç 200 ms'de kesilir. Yorumlayıcı
// (~22 ms/çerçeve; yalnız arm64 geliştirme/test, -race ve öykünmede kat kat yavaşlar) için 2 sn. Örnek kurulumu ve
// init çağrıları (newInstance) sınırsızdır: uzaktan veri işlemezler.
const (
	compilerCallLimit    = 200 * time.Millisecond
	interpreterCallLimit = 2 * time.Second
)

// engineConfig çalışma zamanı yapılandırması + o motora uygun çağrı süre sınırı.
type engineConfig struct {
	cfg   wazero.RuntimeConfig
	limit time.Duration
}

// withLimits her motora aynı sandbox sınırlarını uygular: bellek tavanı, çekirdek özellikler, bağlam bitince kapatma.
func withLimits(cfg wazero.RuntimeConfig, limit time.Duration) engineConfig {
	return engineConfig{
		cfg:   cfg.WithMemoryLimitPages(memLimitPages).WithCoreFeatures(api.CoreFeaturesV2).WithCloseOnContextDone(true),
		limit: limit,
	}
}

func compilerEngine() engineConfig {
	return withLimits(wazero.NewRuntimeConfigCompiler(), compilerCallLimit)
}

func interpreterEngine() engineConfig {
	return withLimits(wazero.NewRuntimeConfigInterpreter(), interpreterCallLimit)
}

// runtimeConfig amd64'te derleyiciyi (SSE4.1 varsa; yoksa wazero yorumlayıcıya düşer), diğer mimarilerde yorumlayıcıyı
// seçer. wazero v1.12.0'ın otomatik seçim ölçütü (internal/platform.compilerPlatformSupports) amd64'te
// golang.org/x/sys/cpu.X86.HasSSE41'dir; Supported() (supported_amd64.go) aynı bayrağı okur, böylece sesi yalnız
// derleyicinin seçildiği makinede bildiririz (A-PD-6). wazero yükseltilirse bu eşitlik yeniden doğrulanır; bellek sınırı her örneğe uygulanır. K0s-2 bulgusu: wazero v1.9.0–v1.12.0 arm64 derleyicisi libopus kodlayıcısında
// (silk_noise_shape_quantizer_del_dec) yanlış derleme belirtisi gösterir (sınır dışı tuzak; yorumlayıcı ve amd64 doğru).
// Yayın hedefi yalnız windows/amd64'tür; yorumlayıcı (~22 ms/çerçeve) yalnız arm64 geliştirme/test içindir.
func runtimeConfig() engineConfig {
	if runtime.GOARCH != "amd64" {
		return interpreterEngine()
	}
	return withLimits(wazero.NewRuntimeConfig(), compilerCallLimit)
}

func newCodecRuntime(ec engineConfig) (*codecRuntime, error) {
	ctx := context.Background()
	rt := wazero.NewRuntimeWithConfig(ctx, ec.cfg)
	mod, err := rt.CompileModule(ctx, libopusWasm)
	if err != nil {
		_ = rt.Close(ctx)
		return nil, fmt.Errorf("voice: libopus.wasm derlenemedi: %w", err)
	}
	// Sandbox: modül hiçbir ana makine işlevi/belleği içe aktarmamalı (WASI yok). Derleme hattı bunu sağlar; burada da
	// denetlenir ki yeniden üretilmiş bir ikili sessizce yetki istemesin.
	if len(mod.ImportedFunctions()) != 0 || len(mod.ImportedMemories()) != 0 {
		_ = rt.Close(ctx)
		return nil, errors.New("voice: libopus.wasm içe aktarım istiyor; sandbox ihlali")
	}
	return &codecRuntime{rt: rt, mod: mod, limit: ec.limit}, nil
}

func sharedRuntime() (*codecRuntime, error) {
	sharedOnce.Do(func() { shared, sharedErr = newCodecRuntime(runtimeConfig()) })
	return shared, sharedErr
}

// instance tek bir libopus WASM örneği (bir kodlayıcı ya da bir çözücü). Eşzamanlı kullanım güvenli değildir.
type instance struct {
	mod      api.Module
	mem      api.Memory
	fns      map[string]api.Function
	stack    [3]uint64
	limit    time.Duration // nk_enc / nk_dec süre sınırı
	pktOff   uint32
	pcmOff   uint32
	isClosed bool
}

var instanceFns = []string{"nk_packet_buf", "nk_pcm_buf", "nk_enc_init", "nk_enc", "nk_enc_lookahead", "nk_dec_init", "nk_dec"}

// newInstance yeni örnek kurar (_initialize), tampon adreslerini alır ve init işlevini (nk_enc_init | nk_dec_init) çağırır.
func newInstance(cr *codecRuntime, initFn string, args ...uint64) (*instance, error) {
	ctx := context.Background()
	m, err := cr.rt.InstantiateModule(ctx, cr.mod, wazero.NewModuleConfig().WithName("").WithStartFunctions("_initialize"))
	if err != nil {
		return nil, fmt.Errorf("voice: libopus örneği: %w", err)
	}
	in := &instance{mod: m, mem: m.Memory(), fns: make(map[string]api.Function, len(instanceFns)), limit: cr.limit}
	for _, n := range instanceFns {
		f := m.ExportedFunction(n)
		if f == nil {
			_ = m.Close(ctx)
			return nil, fmt.Errorf("voice: libopus.wasm %s dışa aktarmıyor", n)
		}
		in.fns[n] = f
	}
	if in.mem == nil {
		_ = m.Close(ctx)
		return nil, errors.New("voice: libopus.wasm belleği yok")
	}
	pkt, err := in.call("nk_packet_buf")
	if err == nil {
		in.pktOff = uint32(pkt)
		var pcm int32
		if pcm, err = in.call("nk_pcm_buf"); err == nil {
			in.pcmOff = uint32(pcm)
			var rc int32
			if rc, err = in.call(initFn, args...); err == nil && rc != 0 {
				err = opusError(rc)
			}
		}
	}
	if err != nil {
		_ = in.close()
		return nil, err
	}
	return in, nil
}

// call init/tampon işlevlerini süre sınırsız çağırır (uzaktan veri işlemezler); tuzak/panik ErrCodecPanic olur.
func (in *instance) call(name string, args ...uint64) (int32, error) {
	return in.invoke(context.Background(), name, args...)
}

// callLimited kodlama/çözme çağrısı: süre sınırlı bağlamla (D-PD-K1-1). Süre dolarsa wazero örneği kapatır ve çağrı
// hata döner; tuzak gibi ErrCodecPanic olur. Çağrı başına bağlam + zamanlayıcı + wazero izleme goroutine'i ayrılır.
func (in *instance) callLimited(name string, args ...uint64) (int32, error) {
	ctx, cancel := context.WithTimeout(context.Background(), in.limit)
	defer cancel()
	return in.invoke(ctx, name, args...)
}

func (in *instance) invoke(ctx context.Context, name string, args ...uint64) (int32, error) {
	if in.isClosed {
		return 0, errClosed
	}
	st := in.stack[:max(len(args), 1)]
	copy(st, args)
	if err := callWithStack(ctx, in.fns[name], st); err != nil {
		return 0, err
	}
	return api.DecodeI32(st[0]), nil
}

// callWithStack işlevi çağırır; tuzak, çalışma zamanı paniği ve bağlam süresi/iptali (WithCloseOnContextDone) aynı
// biçimde ErrCodecPanic olur.
func callWithStack(ctx context.Context, f api.Function, st []uint64) error {
	if err := guard(func() error { return f.CallWithStack(ctx, st) }); err != nil {
		return ErrCodecPanic
	}
	return nil
}

func (in *instance) close() error {
	if in.isClosed {
		return nil
	}
	in.isClosed = true
	return in.mod.Close(context.Background())
}

// Encoder 48 kHz mono 20 ms Opus kodlayıcı (VOIP, 32 kbit/s VBR, karmaşıklık 5). Eşzamanlı kullanım güvenli değildir;
// eş başına bir kodlayıcı (mix-minus, ADR-0036 m.4).
type Encoder struct {
	in  *instance
	buf []byte
}

// NewEncoder ADR-0036 hedef ayarlarıyla kodlayıcı kurar.
func NewEncoder() (*Encoder, error) {
	cr, err := sharedRuntime()
	if err != nil {
		return nil, err
	}
	in, err := newInstance(cr, "nk_enc_init", api.EncodeI32(targetBitrate), api.EncodeI32(complexity))
	if err != nil {
		return nil, fmt.Errorf("voice: kodlayıcı: %w", err)
	}
	return &Encoder{in: in, buf: make([]byte, maxPacketSize)}, nil
}

// Encode 960 örneklik (20 ms) çerçeveyi bir Opus paketine kodlar. Dönen dilim bir sonraki çağrıya kadar geçerlidir.
func (e *Encoder) Encode(pcm []int16) ([]byte, error) {
	if len(pcm) != FrameSamples*Channels {
		return nil, ErrFrameSize
	}
	if e.in.isClosed {
		return nil, errClosed
	}
	view, ok := e.in.mem.Read(e.in.pcmOff, uint32(len(pcm))*2)
	if !ok {
		return nil, errors.New("voice: kodlayıcı tamponu bellek dışında")
	}
	for i, s := range pcm {
		binary.LittleEndian.PutUint16(view[2*i:], uint16(s))
	}
	n, err := e.in.callLimited("nk_enc")
	if errors.Is(err, ErrCodecPanic) {
		_ = e.in.close()
		return nil, err
	}
	if err != nil {
		return nil, fmt.Errorf("voice: kodlama: %w", err)
	}
	if n < 0 {
		return nil, fmt.Errorf("voice: kodlama: %w", opusError(n))
	}
	pkt, ok := e.in.mem.Read(e.in.pktOff, uint32(n))
	if !ok || n > maxPacketSize {
		return nil, errors.New("voice: kodlayıcı paket boyu geçersiz")
	}
	return e.buf[:copy(e.buf, pkt)], nil
}

// Lookahead kodlayıcının gecikmesi (örnek); gidiş-dönüş hizalaması içindir.
func (e *Encoder) Lookahead() (int, error) {
	n, err := e.in.call("nk_enc_lookahead")
	if err != nil {
		return 0, err
	}
	if n < 0 {
		return 0, opusError(n)
	}
	return int(n), nil
}

// Close kodlayıcıyı bırakır; ikinci çağrı zararsızdır.
func (e *Encoder) Close() error { return e.in.close() }

// wasmDecoder bir WASM örneğindeki libopus çözücüsü.
type wasmDecoder struct{ in *instance }

func newOpusDecoder() (codec, error) {
	cr, err := sharedRuntime()
	if err != nil {
		return nil, err
	}
	in, err := newInstance(cr, "nk_dec_init")
	if err != nil {
		return nil, err
	}
	return &wasmDecoder{in: in}, nil
}

func (w *wasmDecoder) Decode(packet []byte, pcm []int16, frameSize int, decodeFEC bool) (int, error) {
	if len(packet) > maxPacketSize || frameSize <= 0 || frameSize > min(maxFrame, len(pcm)) {
		return 0, opusError(-1)
	}
	if w.in.isClosed {
		return 0, errClosed
	}
	if len(packet) > 0 && !w.in.mem.Write(w.in.pktOff, packet) {
		return 0, errors.New("voice: çözücü tamponu bellek dışında")
	}
	fec := uint64(0)
	if decodeFEC {
		fec = 1
	}
	n, err := w.in.callLimited("nk_dec", api.EncodeI32(int32(len(packet))), api.EncodeI32(int32(frameSize)), fec)
	if err != nil {
		return 0, err
	}
	if n < 0 {
		return 0, opusError(n)
	}
	if int(n) > frameSize {
		return 0, opusError(-3)
	}
	view, ok := w.in.mem.Read(w.in.pcmOff, uint32(n)*2)
	if !ok {
		return 0, errors.New("voice: çözücü çıktısı bellek dışında")
	}
	for i := range int(n) {
		pcm[i] = int16(binary.LittleEndian.Uint16(view[2*i:]))
	}
	return int(n), nil
}

func (w *wasmDecoder) Close() error { return w.in.close() }

// NewDecoder 48 kHz mono çözücü kurar.
func NewDecoder() (*Decoder, error) { return newDecoderWith(newOpusDecoder) }

// wasmBackend süreç geneli paylaşılan wazero çalışma zamanı; görüşmeye özgü kaynak yok.
type wasmBackend struct{}

// openBackend Opus çalışma zamanını hazırlar (bir kez derlenir).
func openBackend() (backend, error) {
	if _, err := sharedRuntime(); err != nil {
		return nil, err
	}
	return wasmBackend{}, nil
}

func (wasmBackend) newDecoder() (frameDecoder, error) { return NewDecoder() }
func (wasmBackend) newEncoder() (frameEncoder, error) { return NewEncoder() }
func (wasmBackend) close()                            {}
