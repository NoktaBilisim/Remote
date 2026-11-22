//go:build !darwin

package voice

import (
	"context"
	"errors"
	"runtime"
	"testing"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

// D-PD-K1-1: wazero çağrılarında süre sınırı. Bitmeyen bir libopus çağrısını kendiliğinden üretmek zor olduğundan
// elle yazılmış en küçük modül kullanılır: `spin` (i32 i32 i32) → i32 imzasıyla (nk_dec ile aynı) sonsuz döngü
// `(loop (br 0)) unreachable`; ayrıca 1 sayfalık `memory` dışa aktarır. Çalışma zamanı üretim yapılandırmasıyla kurulur.
var spinWasm = []byte{
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // başlık
	0x01, 0x08, 0x01, 0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x01, 0x7f, // tür: (i32 i32 i32) → i32
	0x03, 0x02, 0x01, 0x00, // işlev 0 → tür 0
	0x05, 0x03, 0x01, 0x00, 0x01, // bellek: en az 1 sayfa
	0x07, 0x11, 0x02, // dışa aktarım: 2 kayıt
	0x04, 's', 'p', 'i', 'n', 0x00, 0x00,
	0x06, 'm', 'e', 'm', 'o', 'r', 'y', 0x02, 0x00,
	0x0a, 0x0a, 0x01, 0x08, 0x00, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x00, 0x0b, // kod: loop br 0 end unreachable end
}

// spinEngines üretimde seçilen motor (runtimeConfig) ve amd64'te ayrıca açık derleyici + yorumlayıcı.
func spinEngines() map[string]engineConfig {
	m := map[string]engineConfig{"auto": runtimeConfig(), "interpreter": interpreterEngine()}
	if runtime.GOARCH == "amd64" {
		m["compiler"] = compilerEngine()
	}
	return m
}

// newSpinDecoder sonsuz döngülü modülü nk_dec yerine koyan çözücü örneği (limit: çağrı süre sınırı).
func newSpinDecoder(t *testing.T, rt wazero.Runtime, mod wazero.CompiledModule, limit time.Duration) *wasmDecoder {
	t.Helper()
	m, err := rt.InstantiateModule(context.Background(), mod, wazero.NewModuleConfig().WithName(""))
	if err != nil {
		t.Fatal(err)
	}
	f := m.ExportedFunction("spin")
	if f == nil || m.Memory() == nil {
		t.Fatal("spin modülü eksik")
	}
	return &wasmDecoder{in: &instance{mod: m, mem: m.Memory(), fns: map[string]api.Function{"nk_dec": f}, limit: limit}}
}

func compileSpin(t *testing.T, ec engineConfig) (wazero.Runtime, wazero.CompiledModule) {
	t.Helper()
	ctx := context.Background()
	rt := wazero.NewRuntimeWithConfig(ctx, ec.cfg)
	t.Cleanup(func() { _ = rt.Close(ctx) })
	mod, err := rt.CompileModule(ctx, spinWasm)
	if err != nil {
		t.Fatal(err)
	}
	return rt, mod
}

// Bağlam iptali çalışan (bitmeyen) çağrıyı sonlandırır ve hata tuzak gibi ErrCodecPanic olur: çalışma zamanı
// WithCloseOnContextDone(true) ile kurulmasaydı bu çağrı hiç dönmezdi.
func TestP28dOpusContextCancelStopsCall(t *testing.T) {
	for name, ec := range spinEngines() {
		t.Run(name, func(t *testing.T) {
			rt, mod := compileSpin(t, ec)
			w := newSpinDecoder(t, rt, mod, time.Hour)
			ctx, cancel := context.WithCancel(context.Background())
			time.AfterFunc(30*time.Millisecond, cancel)
			done := make(chan error, 1)
			st := make([]uint64, 3)
			go func() { done <- callWithStack(ctx, w.in.fns["nk_dec"], st) }()
			select {
			case err := <-done:
				if !errors.Is(err, ErrCodecPanic) {
					t.Fatalf("iptal edilen çağrı: %v", err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("bağlam iptali çağrıyı sonlandırmadı")
			}
		})
	}
}

// Çözme çağrısı süre sınırını aşarsa tuzak yolu çalışır: örnek kapanır, yenisi kurulur; 3. olayda eş düşer.
func TestP28dOpusCallLimitTreatedAsTrap(t *testing.T) {
	for name, ec := range spinEngines() {
		t.Run(name, func(t *testing.T) {
			rt, mod := compileSpin(t, ec)
			const limit = 40 * time.Millisecond
			var made []*wasmDecoder
			first := newSpinDecoder(t, rt, mod, limit)
			d := &Decoder{dec: first, pcm: make([]int16, maxFrame*Channels), now: time.Now,
				newDec: func() (codec, error) { w := newSpinDecoder(t, rt, mod, limit); made = append(made, w); return w, nil }}
			pkt := []byte{0x78, 0x01, 0x02}
			for i := 1; i <= 2; i++ {
				start := time.Now()
				if _, err := d.Decode(pkt); !errors.Is(err, ErrCodecPanic) {
					t.Fatalf("zaman aşımı %d: %v", i, err)
				}
				if el := time.Since(start); el < limit || el > 5*time.Second {
					t.Fatalf("zaman aşımı %d süresi %v (sınır %v)", i, el, limit)
				}
			}
			if !first.in.isClosed || len(made) != 2 || !made[0].in.isClosed || d.panics != 2 {
				t.Fatalf("zaman aşımından sonra örnek kapanıp yenisi kurulmalı (yeni=%d panik=%d)", len(made), d.panics)
			}
			if _, err := d.Decode(pkt); !errors.Is(err, ErrPeerDropped) {
				t.Fatalf("3. zaman aşımı: %v", err)
			}
			if len(made) != 2 {
				t.Fatal("3. olaydan sonra çözücü yeniden kurulmamalı")
			}
		})
	}
}

// Üretim sınırları: derleyici 200 ms, yorumlayıcı 2 sn; libopus örnekleri motorun sınırını taşır.
func TestP28dOpusCallLimitValues(t *testing.T) {
	if compilerCallLimit != 200*time.Millisecond || interpreterCallLimit != 2*time.Second {
		t.Fatalf("sınırlar %v / %v", compilerCallLimit, interpreterCallLimit)
	}
	want := compilerCallLimit
	if runtime.GOARCH != "amd64" {
		want = interpreterCallLimit
	}
	if got := runtimeConfig().limit; got != want {
		t.Fatalf("runtimeConfig sınırı %v, beklenen %v", got, want)
	}
	enc, err := NewEncoder()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = enc.Close() }()
	if enc.in.limit != want {
		t.Fatalf("kodlayıcı örneği sınırı %v, beklenen %v", enc.in.limit, want)
	}
}
