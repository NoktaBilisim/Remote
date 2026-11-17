package voice

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"os"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tetratelabs/wazero"
)

// speechLike konuşmaya benzer sinyal: kayan temel frekans (110–220 Hz) + 8 harmonik, 4 Hz hece zarfı, hafif gürültü.
// Saf ton/sessizlik kodlayıcıyı gerçekçi olmayan biçimde hafifletir (K0s süre ölçütü).
func speechLike(frames int, seed uint64) []int16 {
	r := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	out := make([]int16, frames*FrameSamples)
	phase := 0.0
	for i := range out {
		t := float64(i) / SampleRate
		f0 := 165 + 55*math.Sin(2*math.Pi*0.7*t)
		phase += 2 * math.Pi * f0 / SampleRate
		var s float64
		for h := 1; h <= 8; h++ {
			s += math.Sin(float64(h)*phase) / float64(h)
		}
		env := 0.55 + 0.45*math.Sin(2*math.Pi*4*t)
		v := 6000*env*s + 300*r.NormFloat64()
		out[i] = int16(max(-32768, min(32767, v)))
	}
	return out
}

// testDecoder gerçek çözücü + her çağrıda 20 ms ilerleyen saat (hız sınırı gerçek zamanlı akışı görür).
func testDecoder() (*Decoder, error) {
	d, err := NewDecoder()
	if err != nil {
		return nil, err
	}
	t0 := time.Unix(0, 0)
	d.now = func() time.Time { t0 = t0.Add(20 * time.Millisecond); return t0 }
	return d, nil
}

func encodeAll(t testing.TB, pcm []int16) [][]byte {
	t.Helper()
	enc, err := NewEncoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = enc.Close() }()
	var pkts [][]byte
	for f := 0; f+FrameSamples <= len(pcm); f += FrameSamples {
		p, err := enc.Encode(pcm[f : f+FrameSamples])
		if err != nil {
			t.Fatal(err)
		}
		pkts = append(pkts, append([]byte(nil), p...))
	}
	return pkts
}

// snrDB hizalanmış referansa göre SNR; gecikme ±lookahead çevresinde en iyi korelasyonla bulunur.
func snrDB(ref, got []int16, skip, delay int) float64 {
	var sig, noise float64
	for i := skip; i+delay < len(got) && i < len(ref); i++ {
		d := float64(ref[i]) - float64(got[i+delay])
		sig += float64(ref[i]) * float64(ref[i])
		noise += d * d
	}
	return 10 * math.Log10(sig/max(noise, 1))
}

func TestP28dK0sRoundTripSNR(t *testing.T) {
	const frames = 150 // 3 sn
	ref := speechLike(frames, 1)
	enc, err := NewEncoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = enc.Close() }()
	look, err := enc.Lookahead()
	if err != nil {
		t.Fatal(err)
	}
	dec, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	var got []int16
	var bytes int
	for f := range frames {
		p, err := enc.Encode(ref[f*FrameSamples : (f+1)*FrameSamples])
		if err != nil {
			t.Fatal(err)
		}
		if len(p) == 0 || len(p) > maxPacketSize {
			t.Fatalf("çerçeve %d: paket boyu %d", f, len(p))
		}
		bytes += len(p)
		pcm, err := dec.Decode(p)
		if err != nil {
			t.Fatal(err)
		}
		if len(pcm) != FrameSamples {
			t.Fatalf("çerçeve %d: %d örnek", f, len(pcm))
		}
		got = append(got, pcm...)
	}
	best, bestD := math.Inf(-1), 0
	for d := max(0, look-48); d <= look+48; d++ {
		if s := snrDB(ref, got, 10*FrameSamples, d); s > best {
			best, bestD = s, d
		}
	}
	kbps := float64(bytes*8) / (float64(frames) * 0.02) / 1000
	t.Logf("lookahead=%d gecikme=%d SNR=%.1f dB ortalama hız=%.1f kbit/s", look, bestD, best, kbps)
	// Opus algısal kodlayıcıdır; VOIP kipinde (SILK/hibrit) dalga biçimi SNR'ı düşük kalır (K0s ölçümü ≈ 4.6 dB; aynı
	// sinyal AUDIO/CELT 32k'da ≈ 17.5 dB). Eşik "doğru sinyal, doğru hizada çözüldü" kanıtıdır: yanlış/sessiz çıktı ≤ 0 dB.
	if best < 3 {
		t.Fatalf("SNR %.1f dB < 3 dB", best)
	}
	if kbps < 16 || kbps > 48 {
		t.Fatalf("ortalama hız %.1f kbit/s, hedef 32 VBR", kbps)
	}
}

func TestP28dK0sPacketLossConcealment(t *testing.T) {
	pkts := encodeAll(t, speechLike(60, 2))
	dec, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	for i, p := range pkts {
		var pcm []int16
		switch {
		case i == 30 || i == 31: // iki ardışık kayıp
			pcm, err = dec.Conceal()
		case i == 40:
			pcm, err = dec.Decode(nil) // boş yük = kayıp
		case i == 45: // kayıp; sonraki paketin FEC'i (kodlayıcıda FEC kapalı → PLC'ye düşer)
			pcm, err = dec.DecodeFEC(pkts[46])
		default:
			pcm, err = dec.Decode(p)
		}
		if err != nil {
			t.Fatalf("çerçeve %d: %v", i, err)
		}
		if len(pcm) != FrameSamples {
			t.Fatalf("çerçeve %d: %d örnek", i, len(pcm))
		}
		if i == 30 {
			var e float64
			for _, s := range pcm {
				e += float64(s) * float64(s)
			}
			if rms := math.Sqrt(e / float64(len(pcm))); rms < 100 {
				t.Fatalf("PLC çıktısı sessiz (rms %.0f); konuşma sürerken gizleme beklenir", rms)
			}
		}
	}
}

// Chrome `opus/48000/2` ile stereo paket ve 20 ms dışı çerçeve gönderebilir; mono çözücü hepsini çözmeli. Paketler
// testdata/opus-fixtures.txt'ten gelir (libopus.wasm'dan bağımsız bir libopus 1.6.1 yapısıyla üretildi; Chrome değil).
func TestP28dK0sDecodesStereoAndOtherFrameSizes(t *testing.T) {
	f, err := os.Open("testdata/opus-fixtures.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	dec, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	var cases int
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<16)
	for sc.Scan() {
		line := sc.Text()
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fs := strings.Fields(line)
		if len(fs) != 3 {
			t.Fatalf("fikstür satırı: %q", line)
		}
		frame, err := strconv.Atoi(fs[1])
		if err != nil {
			t.Fatal(err)
		}
		pkt, err := hex.DecodeString(fs[2])
		if err != nil {
			t.Fatal(err)
		}
		out, err := dec.Decode(pkt)
		if err != nil {
			t.Fatalf("%s: %v", fs[0], err)
		}
		if len(out) != frame {
			t.Fatalf("%s: %d örnek, beklenen %d", fs[0], len(out), frame)
		}
		cases++
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	if cases != 5 {
		t.Fatalf("%d fikstür, beklenen 5", cases)
	}
}

// libopus.wasm gömülü ikilisi libopus.wasm.sha256 ile aynı (build/libopus-wasm.sh çıktısı; CI yeniden üretip karşılaştırır).
func TestP28dK0sWasmDigestMatches(t *testing.T) {
	want, err := os.ReadFile("libopus.wasm.sha256")
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(libopusWasm)
	if got := hex.EncodeToString(sum[:]) + "  libopus.wasm\n"; got != string(want) {
		t.Fatalf("libopus.wasm SHA-256 %q, dosya %q", got, want)
	}
}

// Sandbox: modül hiçbir şey içe aktarmaz (WASI dahil) ve yalnız beklenen yüzü dışa aktarır.
func TestP28dK0sWasmSandboxSurface(t *testing.T) {
	ctx := context.Background()
	rt := wazero.NewRuntimeWithConfig(ctx, runtimeConfig().cfg)
	defer func() { _ = rt.Close(ctx) }()
	mod, err := rt.CompileModule(ctx, libopusWasm)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(mod.ImportedFunctions()) + len(mod.ImportedMemories()); n != 0 {
		t.Fatalf("%d içe aktarım; beklenen 0", n)
	}
	var got []string
	for n := range mod.ExportedFunctions() {
		got = append(got, n)
	}
	slices.Sort(got)
	want := append([]string{"_initialize"}, instanceFns...)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("dışa aktarılan işlevler %v, beklenen %v", got, want)
	}
	for _, m := range mod.ExportedMemories() {
		if max, ok := m.Max(); !ok || max > memLimitPages {
			t.Fatalf("bellek üst sınırı %d (%v); beklenen ≤ %d sayfa", max, ok, memLimitPages)
		}
	}
}

// nk_opus.c yerleşimi: durum işaretçileri paket tamponuna göre sabit adreste (bkz. _Static_assert).
const (
	encoderPtrOff = 12796
	decoderPtrOff = 12800
)

// Bir örnekteki tuzak diğer örneklere sızmaz (Y-PD-2): kodlayıcının ve çözücünün durum işaretçisi doğrusal bellek
// dışına yöneltilir; libopus sınır dışı okumayla tuzağa düşer. Kodlayıcı kapanır (kapalı örnek tuzak sayılmaz),
// çözücü yeni örnekle kurulur ve geçerli paketi çözer; komşu örnekler etkilenmez.
func TestP28dK0sTrapIsolatedPerInstance(t *testing.T) {
	pkts := encodeAll(t, speechLike(3, 13))
	neighbour, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = neighbour.Close() }()
	enc, err := NewEncoder()
	if err != nil {
		t.Fatal(err)
	}
	if !enc.in.mem.WriteUint32Le(enc.in.pktOff+encoderPtrOff, 0xffffff00) {
		t.Fatal("kodlayıcı işaretçisi yazılamadı")
	}
	if _, err := enc.Encode(make([]int16, FrameSamples)); !errors.Is(err, ErrCodecPanic) {
		t.Fatalf("bozuk kodlayıcı: %v", err)
	}
	if _, err := enc.Encode(make([]int16, FrameSamples)); !errors.Is(err, errClosed) {
		t.Fatalf("tuzaktan sonra kodlayıcı kapalı olmalı: %v", err)
	}
	if _, err := enc.Lookahead(); !errors.Is(err, errClosed) {
		t.Fatalf("kapalı kodlayıcı Lookahead: %v", err)
	}
	if fresh := encodeAll(t, speechLike(2, 14)); len(fresh) != 2 {
		t.Fatal("yeni kodlayıcı çalışmalı")
	}

	dec, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	w, ok := dec.dec.(*wasmDecoder)
	if !ok || !w.in.mem.WriteUint32Le(w.in.pktOff+decoderPtrOff, 0xffffff00) {
		t.Fatal("çözücü işaretçisi yazılamadı")
	}
	if _, err := dec.Decode(pkts[1]); !errors.Is(err, ErrCodecPanic) {
		t.Fatalf("bozuk çözücü: %v", err)
	}
	if !w.in.isClosed || dec.dec == codec(w) || dec.panics != 1 {
		t.Fatalf("tuzaktan sonra eski örnek kapanıp yenisi kurulmalı (panik=%d)", dec.panics)
	}
	for i, d := range []*Decoder{dec, neighbour} {
		if out, err := d.Decode(pkts[1]); err != nil || len(out) != FrameSamples {
			t.Fatalf("çözücü %d: %d %v", i, len(out), err)
		}
	}
}

// Karşı taraftan gelen yük güvenilmezdir (Y-PD-2): bozuk paket hata dönebilir; panik sarmalayıcıdan dışarı sızmaz,
// çözücü ardından geçerli paketi yine çözer. Yalıtılan panik sayısı bulgu olarak loglanır.
func TestP28dK0sGarbagePacketsNoPanic(t *testing.T) {
	dec, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	r := rand.New(rand.NewPCG(4, 5))
	good := encodeAll(t, speechLike(5, 6))
	var errs, panics int
	var first []byte
	for i := range 20000 {
		var p []byte
		if i%2 == 0 {
			p = make([]byte, 1+r.IntN(maxPacketSize))
			for j := range p {
				p[j] = byte(r.Uint32())
			}
		} else { // geçerli paketi boz
			p = append([]byte(nil), good[i%len(good)]...)
			p[r.IntN(len(p))] ^= byte(1 + r.IntN(255))
			p = p[:1+r.IntN(len(p))]
		}
		_, err := dec.Decode(p)
		switch {
		case errors.Is(err, ErrPeerDropped): // 3. panik: eş düştü; yeni eşle sürdür (GC zamanlamasına bağlı, K0s bulgusu)
			panics++
			_ = dec.Close()
			if dec, err = testDecoder(); err != nil {
				t.Fatal(err)
			}
		case errors.Is(err, ErrCodecPanic):
			panics++
			if first == nil {
				first = p
			}
		case err != nil:
			errs++
		}
	}
	if out, err := dec.Decode(good[1]); err != nil || len(out) != FrameSamples {
		t.Fatalf("bozuk paketlerden sonra çözme: %d %v", len(out), err)
	}
	t.Logf("20000 bozuk paket: %d hata, %d yalıtılmış panik; ilk panik yükü (%d B): %x", errs, panics, len(first), first)
}

func TestP28dK0sOversizePacketRejected(t *testing.T) {
	dec, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	if _, err := dec.Decode(make([]byte, maxPacketSize+1)); !errors.Is(err, ErrPacketSize) {
		t.Fatalf("1276 B: %v", err)
	}
	if _, err := dec.DecodeFEC(make([]byte, maxPacketSize+1)); !errors.Is(err, ErrPacketSize) {
		t.Fatalf("FEC 1276 B: %v", err)
	}
}

// recordTrap yalıtılan tuzağı NOKTA_K0S_TRAPLOG dosyasına ekler (O_APPEND; fuzz işçi süreçlerinin stderr'i kaybolduğu
// için sayım dosyadan yapılır, K0s-1 Karar 2 notu). Değişken yoksa bir şey yapmaz.
func recordTrap(t *testing.T, p []byte) {
	path := os.Getenv("NOKTA_K0S_TRAPLOG")
	if path == "" {
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	if _, err := fmt.Fprintf(f, "%x\n", p); err != nil {
		t.Fatal(err)
	}
}

// FuzzDecode (Y-PD-2): rastgele yük + FEC yolu. Özellik: sarmalayıcıdan panik sızmaz, çıktı ≤ 120 ms, ardından geçerli
// paket 960 örnek olarak çözülür. Runtime fatal (bellek hatası) süreci düşürür ve fuzz çöküş olarak raporlar.
func FuzzDecode(f *testing.F) {
	for _, p := range encodeAll(f, speechLike(5, 9)) {
		f.Add(p, false)
	}
	f.Add([]byte{0xf8, 0xff, 0xfe}, true)
	good := encodeAll(f, speechLike(2, 10))[1]
	dec, err := testDecoder()
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, p []byte, fec bool) {
		var out []int16
		var err error
		if fec {
			out, err = dec.DecodeFEC(p)
		} else {
			out, err = dec.Decode(p)
		}
		if errors.Is(err, ErrCodecPanic) || errors.Is(err, ErrPeerDropped) {
			recordTrap(t, p)
		}
		if err == nil && len(out) > maxFrame {
			t.Fatalf("%d örnek > 5760", len(out))
		}
		out, err = dec.Decode(good)
		if errors.Is(err, ErrPeerDropped) { // 3 yalıtılmış panik: politika gereği eş düştü; yeni eşle sürdür
			_ = dec.Close()
			if dec, err = testDecoder(); err != nil {
				t.Fatal(err)
			}
			out, err = dec.Decode(good)
		}
		if err != nil || len(out) != FrameSamples {
			t.Fatalf("sonraki geçerli paket: %d %v", len(out), err)
		}
	})
}

func TestP28dK0sRateLimit(t *testing.T) {
	dec, err := NewDecoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	t0 := time.Unix(0, 0)
	dec.now = func() time.Time { return t0 }
	p := encodeAll(t, speechLike(2, 12))[1]
	for i := range maxPacketRate {
		if _, err := dec.Decode(p); err != nil {
			t.Fatalf("paket %d: %v", i, err)
		}
	}
	if _, err := dec.Decode(p); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("101. paket: %v", err)
	}
	if _, err := dec.DecodeFEC(p); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("FEC 102. paket: %v", err)
	}
	if _, err := dec.Conceal(); err != nil { // yerel PLC hıza sayılmaz
		t.Fatalf("PLC: %v", err)
	}
	t0 = t0.Add(time.Second)
	if _, err := dec.Decode(p); err != nil {
		t.Fatalf("yeni pencere: %v", err)
	}
}

type panicCodec struct{ closed int }

func (c *panicCodec) Decode([]byte, []int16, int, bool) (int, error) { panic("libcshim: abort") }
func (c *panicCodec) Close() error                                   { c.closed++; return nil }

// Çevrilmiş kod paniklerse hata döner, çözücü yeniden kurulur; aynı eşte 3. panikte eşin sesi düşer (mimari-p28d r2).
func TestP28dK0sPanicIsolatedAndPeerDroppedOnThird(t *testing.T) {
	dec, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	_ = dec.dec.Close()
	var made []*panicCodec
	dec.newDec = func() (codec, error) { c := &panicCodec{}; made = append(made, c); return c, nil }
	first := &panicCodec{}
	dec.dec = first
	p := []byte{0x78, 0x01, 0x02}
	for i := 1; i <= 2; i++ {
		if _, err := dec.Decode(p); !errors.Is(err, ErrCodecPanic) {
			t.Fatalf("panik %d: %v", i, err)
		}
	}
	if len(made) != 2 || first.closed != 1 || made[0].closed != 1 {
		t.Fatalf("panikten sonra yeniden kurulum: yeni=%d ilk kapandı=%d", len(made), first.closed)
	}
	if _, err := dec.Decode(p); !errors.Is(err, ErrPeerDropped) {
		t.Fatalf("3. panik: %v", err)
	}
	if len(made) != 2 {
		t.Fatal("3. panikten sonra çözücü yeniden kurulmamalı")
	}
	for _, f := range []func() ([]int16, error){
		func() ([]int16, error) { return dec.Decode(p) },
		func() ([]int16, error) { return dec.DecodeFEC(p) },
		dec.Conceal,
	} {
		if _, err := f(); !errors.Is(err, ErrPeerDropped) {
			t.Fatalf("düşürülmüş eş: %v", err)
		}
	}
}

func TestP28dK0sFrameSizeAndClose(t *testing.T) {
	enc, err := NewEncoder()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := enc.Encode(make([]int16, FrameSamples-1)); !errors.Is(err, ErrFrameSize) {
		t.Fatalf("959 örnek: %v", err)
	}
	if err := enc.Close(); err != nil {
		t.Fatal(err)
	}
	if err := enc.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := enc.Encode(make([]int16, FrameSamples)); err == nil {
		t.Fatal("kapalı kodlayıcı hata vermeli")
	}
	dec, err := testDecoder()
	if err != nil {
		t.Fatal(err)
	}
	_ = dec.Close()
	if _, err := dec.Decode([]byte{0xf8, 0xff, 0xfe}); err == nil {
		t.Fatal("kapalı çözücü hata vermeli")
	}
}

func BenchmarkP28dK0sEncode20ms(b *testing.B) {
	pcm := speechLike(50, 7)
	enc, err := NewEncoder()
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = enc.Close() }()
	for i := 0; b.Loop(); i++ {
		f := i % 50
		if _, err := enc.Encode(pcm[f*FrameSamples : (f+1)*FrameSamples]); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkP28dK0sDecode20ms(b *testing.B) {
	pkts := encodeAll(b, speechLike(50, 8))
	dec, err := testDecoder()
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = dec.Close() }()
	for i := 0; b.Loop(); i++ {
		if _, err := dec.Decode(pkts[i%len(pkts)]); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkP28dK0sEncode20msEngine motor başına süre: auto (üretim yapılandırması), compiler, interpreter. auto ≈ compiler
// ise derleyici seçilmiştir (K0s-2 motor kanıtı).
func BenchmarkP28dK0sEncode20msEngine(b *testing.B) {
	pcm := speechLike(50, 7)
	for _, tc := range []struct {
		name string
		cfg  engineConfig
	}{
		{"auto", runtimeConfig()},
		{"compiler", compilerEngine()},
		{"interpreter", interpreterEngine()},
	} {
		b.Run(tc.name, func(b *testing.B) {
			cr, err := newCodecRuntime(tc.cfg)
			if err != nil {
				b.Fatal(err)
			}
			defer func() { _ = cr.rt.Close(context.Background()) }()
			in, err := newInstance(cr, "nk_enc_init", uint64(targetBitrate), uint64(complexity))
			if err != nil {
				b.Fatal(err)
			}
			enc := &Encoder{in: in, buf: make([]byte, maxPacketSize)}
			for i := 0; b.Loop(); i++ {
				f := i % 50
				if _, err := enc.Encode(pcm[f*FrameSamples : (f+1)*FrameSamples]); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// amd64 derleyicisi yorumlayıcıyla bayt bayt aynı sonucu üretir (K0s-2: yanlış derleme denetimi; arm64 derleyici
// bulgusu nedeniyle). Yalnız amd64'te anlamlı: kodlama paketleri + fikstür/bozuk paket çözüm çıktıları karşılaştırılır.
func TestP28dK0sCompilerMatchesInterpreter(t *testing.T) {
	if testing.Short() {
		t.Skip("uzun")
	}
	run := func(cfg engineConfig) []byte {
		cr, err := newCodecRuntime(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = cr.rt.Close(context.Background()) }()
		ein, err := newInstance(cr, "nk_enc_init", uint64(targetBitrate), uint64(complexity))
		if err != nil {
			t.Fatal(err)
		}
		enc := &Encoder{in: ein, buf: make([]byte, maxPacketSize)}
		din, err := newInstance(cr, "nk_dec_init")
		if err != nil {
			t.Fatal(err)
		}
		dec := &wasmDecoder{in: din}
		h := sha256.New()
		pcm := speechLike(200, 21)
		out := make([]int16, maxFrame)
		r := rand.New(rand.NewPCG(22, 23))
		for f := range 200 {
			p, err := enc.Encode(pcm[f*FrameSamples : (f+1)*FrameSamples])
			if err != nil {
				t.Fatal(err)
			}
			h.Write(p)
			bad := append([]byte(nil), p...)
			bad[r.IntN(len(bad))] ^= byte(1 + r.IntN(255))
			for _, q := range [][]byte{p, bad} {
				n, err := dec.Decode(q, out, maxFrame, false)
				fmt.Fprintf(h, "|%d|%v|", n, err)
				for _, s := range out[:max(n, 0)] {
					h.Write([]byte{byte(s), byte(s >> 8)})
				}
			}
		}
		return h.Sum(nil)
	}
	a := run(interpreterEngine())
	if runtime.GOARCH != "amd64" {
		t.Skipf("derleyici yalnız amd64'te kullanılır (GOARCH=%s)", runtime.GOARCH)
	}
	b := run(compilerEngine())
	if !bytes.Equal(a, b) {
		t.Fatalf("derleyici %x ≠ yorumlayıcı %x", b, a)
	}
}
