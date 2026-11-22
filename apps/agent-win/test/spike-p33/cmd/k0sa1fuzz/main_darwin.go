//go:build darwin

// k0sa1fuzz: R1–R7 doğrulayıcısından geçen mutasyonları AudioToolbox Opus çözücüsüne verir (K0s-A1 madde 6).
// Gözetmen kip çocuk süreci başlatır; çocuk çökerse (yerel çözücü bellek hatası Go'da kurtarılamaz) son paket mmap
// dosyasından okunur, kayıt yazılır ve yeni tohumla devam edilir. Askı: > 200 ms çağrı sayılır, > 5 sn süreç çıkar.
package main

import (
	"encoding/binary"
	"encoding/hex"
	"flag"
	"fmt"
	"math/rand/v2"
	"os"
	"os/exec"
	"sort"
	"sync/atomic"
	"syscall"
	"time"

	"remote-support/agent-win/test/spike-p33/at"
	"remote-support/agent-win/test/spike-p33/opuspkt"
	"remote-support/agent-win/test/spike-p33/sig"
)

var (
	child    = flag.Bool("child", false, "çocuk süreç")
	corpusF  = flag.String("corpus", "", "derlem")
	dur      = flag.Duration("d", 5*time.Minute, "toplam süre")
	seed     = flag.Uint64("seed", 1, "tohum")
	fpp      = flag.Uint("fpp", 960, "çözücü giriş ASBD çerçeve/paket (0 = değişken)")
	lastFile = flag.String("last", "", "son paket mmap dosyası")
)

func main() {
	flag.Parse()
	if *child {
		runChild()
		return
	}
	supervise()
}

func supervise() {
	if *lastFile == "" {
		*lastFile = fmt.Sprintf("%s/k0sa1fuzz-last-%d-%d.bin", os.TempDir(), *fpp, os.Getpid())
	}
	end := time.Now().Add(*dur)
	s := *seed
	crashes := 0
	for time.Now().Before(end) {
		left := time.Until(end)
		cmd := exec.Command(os.Args[0], "-child", "-corpus", *corpusF, "-d", left.String(), "-seed", fmt.Sprint(s),
			"-fpp", fmt.Sprint(*fpp), "-last", *lastFile)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		err := cmd.Run()
		if err == nil {
			break
		}
		crashes++
		b, _ := os.ReadFile(*lastFile)
		fmt.Printf("ÇÖKME/ASKI #%d tohum %d: %v; son paket kaydı %x\n", crashes, s, err, b[:min(len(b), 64)])
		_ = os.WriteFile(fmt.Sprintf("%s.crash%d", *lastFile, crashes), b, 0o600)
		s += 1000
	}
	fmt.Printf("GÖZETMEN SONUÇ: çökme/askı süreç çıkışı %d\n", crashes)
}

type mmapRec struct{ b []byte }

func openRec(path string) mmapRec {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		panic(err)
	}
	_ = f.Truncate(4096)
	b, err := syscall.Mmap(int(f.Fd()), 0, 4096, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_SHARED)
	if err != nil {
		panic(err)
	}
	return mmapRec{b}
}

// put [iter u64][len u32][paket]
func (m mmapRec) put(iter uint64, p []byte) {
	binary.LittleEndian.PutUint64(m.b, iter)
	binary.LittleEndian.PutUint32(m.b[8:], uint32(len(p)))
	copy(m.b[12:], p)
}

func mutate(r *rand.Rand, corpus [][]byte) []byte {
	p := append([]byte(nil), corpus[r.IntN(len(corpus))]...)
	for range 1 + r.IntN(4) {
		switch r.IntN(11) {
		case 0, 1, 2: // bit çevirme
			if len(p) > 0 {
				i := r.IntN(len(p))
				p[i] ^= 1 << r.IntN(8)
			}
		case 3: // rastgele bayt
			if len(p) > 0 {
				p[r.IntN(len(p))] = byte(r.Uint32())
			}
		case 4: // TOC tamamen rastgele
			if len(p) > 0 {
				p[0] = byte(r.Uint32())
			}
		case 5: // kırp
			if len(p) > 1 {
				p = p[:1+r.IntN(len(p)-1)]
			}
		case 6: // ekle
			n := r.IntN(64)
			for range n {
				p = append(p, byte(r.Uint32()))
			}
		case 7: // bayt sil
			if len(p) > 2 {
				i := 1 + r.IntN(len(p)-1)
				p = append(p[:i], p[i+1:]...)
			}
		case 8: // başka paketle ekleme (splice)
			q := corpus[r.IntN(len(corpus))]
			if len(q) > 1 && len(p) > 1 {
				p = append(p[:1+r.IntN(len(p)-1)], q[1+r.IntN(len(q)-1):]...)
			}
		case 9: // kod 3 sarmalayıcı: M çerçeve CBR/VBR, dolgu
			if len(p) > 1 {
				m := 1 + r.IntN(6)
				body := p[1:]
				h := []byte{p[0] | 3, byte(m)}
				if r.IntN(2) == 0 {
					h[1] |= 0x40
					h = append(h, byte(r.IntN(255)))
				}
				var nb []byte
				for range m {
					nb = append(nb, body...)
				}
				p = append(h, nb...)
			}
		case 10: // sıfır/0xff blokları
			if len(p) > 4 {
				i := r.IntN(len(p) - 4)
				v := byte(0)
				if r.IntN(2) == 0 {
					v = 0xff
				}
				for k := range 4 {
					p[i+k] = v
				}
			}
		}
	}
	if len(p) > 1275+64 {
		p = p[:1275+64]
	}
	return p
}

func runChild() {
	fx, err := sig.ReadFixtures(*corpusF)
	if err != nil || len(fx) == 0 {
		fmt.Println("derlem:", err)
		os.Exit(2)
	}
	var corpus [][]byte
	var good []byte
	for _, f := range fx {
		corpus = append(corpus, f.Pkt)
		if good == nil {
			if in, err := opuspkt.Validate(f.Pkt); err == nil && in.Samples() == 960 && len(f.Pkt) > 20 {
				good = f.Pkt
			}
		}
	}
	rec := openRec(*lastFile)
	r := rand.New(rand.NewPCG(*seed, *seed*7919))
	newDec := func() *at.Decoder {
		d, err := at.NewDecoderFrames(1, 1, uint32(*fpp), nil)
		if err != nil {
			fmt.Println("çözücü:", err)
			os.Exit(2)
		}
		return d
	}
	d := newDec()
	var inCall atomic.Int64 // çağrı başlangıcı (unix ns), 0 = çağrıda değil
	go func() {
		for {
			time.Sleep(500 * time.Millisecond)
			if s := inCall.Load(); s != 0 && time.Since(time.Unix(0, s)) > 5*time.Second {
				fmt.Println("ASKI: çağrı > 5 sn")
				os.Exit(4)
			}
		}
	}()
	end := time.Now().Add(*dur)
	var iters, valid, decErr, zeroOut, slow, unusable, recreated uint64
	var maxCall time.Duration
	errCodes := map[string]int{}
	ruleRej := map[string]int{}
	durHist := map[int]int{}
	lastPrint := time.Now()
	start := time.Now()
	for time.Now().Before(end) {
		iters++
		p := mutate(r, corpus)
		in, verr := opuspkt.Validate(p)
		if verr != nil {
			ruleRej[verr.Error()[:2]]++
			continue
		}
		valid++
		durHist[in.Samples()]++
		rec.put(iters, p)
		t0 := time.Now()
		inCall.Store(t0.UnixNano())
		o, err := d.Decode(p)
		el := time.Since(t0)
		inCall.Store(0)
		if el > maxCall {
			maxCall = el
		}
		if el > 200*time.Millisecond {
			slow++
		}
		if err != nil {
			decErr++
			errCodes[err.Error()]++
		} else if len(o) == 0 {
			zeroOut++
		}
		if valid%1000 == 0 { // kullanılabilirlik: bilinen iyi paket iki kez
			_, _ = d.Decode(good)
			o2, err2 := d.Decode(good)
			if err2 != nil || len(o2) != 960 {
				unusable++
				d.Close()
				d = newDec()
				recreated++
			}
		}
		if valid%20000 == 0 {
			d.Close()
			d = newDec()
			recreated++
		}
		if time.Since(lastPrint) > 30*time.Second {
			lastPrint = time.Now()
			fmt.Printf("[%s fpp=%d tohum=%d] yineleme %d geçerli %d çözme hatası %d sıfır çıktı %d >200ms %d maks %.2f ms kullanılamaz %d\n",
				time.Since(start).Round(time.Second), *fpp, *seed, iters, valid, decErr, zeroOut, slow, float64(maxCall.Microseconds())/1000, unusable)
		}
	}
	d.Close()
	fmt.Printf("SONUÇ fpp=%d tohum=%d süre %s: yineleme %d, R1–R7 geçen %d (%.1f%%), çözme hatası %d, sıfır çıktı %d, >200 ms %d, en uzun çağrı %.3f ms, kullanılamaz durum %d, yeniden kurulum %d\n",
		*fpp, *seed, time.Since(start).Round(time.Second), iters, valid, 100*float64(valid)/float64(iters), decErr, zeroOut, slow,
		float64(maxCall.Microseconds())/1000, unusable, recreated)
	fmt.Printf("  red (kural): %v\n  hata kodları: %v\n", ruleRej, errCodes)
	keys := make([]int, 0, len(durHist))
	for k := range durHist {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	fmt.Print("  geçerli paket süre dağılımı (örnek→adet):")
	for _, k := range keys {
		fmt.Printf(" %d→%d", k, durHist[k])
	}
	fmt.Println()
	_ = hex.EncodeToString
}
