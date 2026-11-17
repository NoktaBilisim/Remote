// Package voice: P28d sesli görüşme (ADR-0036). Bu dosya Opus kodlayıcı/çözücüsünü çağıran TEK yerdir. Arka uç
// (ADR-0036 yedek 1, A-PD-1): libopus 1.6.1'in WebAssembly derlemesi (libopus.wasm, build/libopus-wasm.sh ile
// tekrarlanabilir üretilir) wazero (saf Go, CGO yok) içinde koşar. C kodu yalnız kendi doğrusal belleğine erişir; bozuk
// paket en kötü durumda WASM tuzağı (trap) üretir, Go yığınına/heap'ine dokunamaz (Y-PD-2). Modüle hiçbir ana makine
// işlevi (WASI dahil: dosya, ağ, saat) verilmez. Kodlayıcı ve çözücü başına ayrı örnek (instance) kurulur; bir örnekteki
// bozulma diğerine sızmaz. Kütüphane değişirse yalnız bu dosya değişir.
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

// Sabit biçim (ADR-0036 m.1): 48 kHz, mono, 20 ms çerçeve.
const (
	SampleRate    = 48000
	Channels      = 1
	FrameSamples  = SampleRate / 50 // 20 ms = 960 örnek
	maxFrame      = 5760            // Opus'un en uzun paketi (120 ms @ 48 kHz); karşı taraf 20 ms dışı gönderebilir
	maxPacketSize = 1275            // RFC 6716 §3.2.1 tek çerçeve üst sınırı
	targetBitrate = 32000
	complexity    = 5
	maxPacketRate = 100 // eş başına paket/sn (20 ms → 50; 10 ms çerçeve gönderen eşe pay)
	maxPanics     = 3   // aynı eşte bu sayıda tuzak/panikte eşin sesi düşer (mimari-p28d r2)
	memLimitPages = 256 // örnek başına doğrusal bellek üst sınırı: 256 × 64 KiB = 16 MiB (libopus.wasm --max-memory ile aynı)
)

// libopusWasm libopus 1.6.1 + nk_opus.c kabuğu (build/libopus-wasm.sh; SHA-256 libopus.wasm.sha256'da, test denetler).
//
//go:embed libopus.wasm
var libopusWasm []byte

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
func NewDecoder() (*Decoder, error) {
	d, err := newOpusDecoder()
	if err != nil {
		return nil, fmt.Errorf("voice: çözücü: %w", err)
	}
	return &Decoder{dec: d, newDec: newOpusDecoder, pcm: make([]int16, maxFrame*Channels), now: time.Now}, nil
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
