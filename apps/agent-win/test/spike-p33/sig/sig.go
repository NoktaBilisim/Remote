// Package sig K0s-A1 ortak sinyal, SNR ve istatistik yardımcıları (saf Go).
package sig

import (
	"bufio"
	"encoding/hex"
	"math"
	"math/rand/v2"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SpeechLike internal/voice/opus_test.go ile aynı konuşmaya benzer sinyal (48 kHz mono).
func SpeechLike(frames int, seed uint64) []int16 {
	r := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	out := make([]int16, frames*960)
	phase := 0.0
	for i := range out {
		t := float64(i) / 48000
		f0 := 165 + 55*math.Sin(2*math.Pi*0.7*t)
		phase += 2 * math.Pi * f0 / 48000
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

// SNR got[i+delay] ile ref[i] arasında (skip sonrası).
func SNR(ref, got []int16, skip, delay int) float64 {
	var s, n float64
	for i := skip; i < len(ref); i++ {
		j := i + delay
		if j < 0 || j >= len(got) {
			continue
		}
		d := float64(ref[i]) - float64(got[j])
		s += float64(ref[i]) * float64(ref[i])
		n += d * d
	}
	if s == 0 {
		return math.Inf(-1)
	}
	return 10 * math.Log10(s/max(n, 1))
}

// BestSNR [lo,hi] gecikme aralığında en iyi SNR ve gecikmesi.
func BestSNR(ref, got []int16, skip, lo, hi int) (float64, int) {
	best, bd := math.Inf(-1), 0
	for d := lo; d <= hi; d++ {
		if s := SNR(ref, got, skip, d); s > best {
			best, bd = s, d
		}
	}
	return best, bd
}

// RMS kök ortalama kare.
func RMS(x []int16) float64 {
	if len(x) == 0 {
		return 0
	}
	var e float64
	for _, s := range x {
		e += float64(s) * float64(s)
	}
	return math.Sqrt(e / float64(len(x)))
}

// Pct süre yüzdelikleri (ms).
func Pct(d []time.Duration, ps ...float64) []float64 {
	s := append([]time.Duration(nil), d...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	out := make([]float64, len(ps))
	for i, p := range ps {
		k := int(math.Ceil(p/100*float64(len(s)))) - 1
		k = max(0, min(len(s)-1, k))
		out[i] = float64(s[k].Microseconds()) / 1000
	}
	return out
}

// Fixture satırı.
type Fixture struct {
	Name  string
	Frame int
	Pkt   []byte
}

// ReadFixtures "ad örnek hex" satırları.
func ReadFixtures(path string) ([]Fixture, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []Fixture
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		l := strings.TrimSpace(sc.Text())
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		fs := strings.Fields(l)
		if len(fs) != 3 {
			continue
		}
		n, _ := strconv.Atoi(fs[1])
		p, err := hex.DecodeString(fs[2])
		if err != nil {
			return nil, err
		}
		out = append(out, Fixture{fs[0], n, p})
	}
	return out, sc.Err()
}
