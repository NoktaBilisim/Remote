package voice

import (
	"math"
	"math/rand/v2"
	"testing"
)

// Ortak test yardımcıları (her arka uç: wasm ve darwin AudioToolbox).

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
