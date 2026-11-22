//go:build darwin

package voice

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"math/rand/v2"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// K0s-A1 (6) / QA K4 madde 5: ürün yardımcısı (aynı RunDecoderHelper: fd kapatma, ısıtma, sandbox_init, öz-test) içinde
// süreli fuzz. Yalnız NOKTA_FUZZ_SURE=<süre> ile koşar (ör. 30m; go test -timeout bu süreden uzun olmalı). Mutasyonlar
// üretimdeki süzgeçten (opus20ms: R1–R7 + 20 ms) geçerse yardımcıya ham IPC ile gider; roundTrip'in 15 ms tik sınırı
// kullanılmaz ki en uzun çağrı ve çökme sayısı bulanıklaşmasın. Yardımcı ölürse (boru kapandı / 5 sn yanıt yok) çökme
// sayılır, son paket kaydedilir ve yeni yardımcı başlatılır.
func TestP33FuzzProductHelper(t *testing.T) {
	dur, err := time.ParseDuration(os.Getenv("NOKTA_FUZZ_SURE"))
	if err != nil || dur <= 0 {
		t.Skip("NOKTA_FUZZ_SURE=<süre> verilmedi (uzun fuzz)")
	}
	seed, _ := strconv.ParseUint(os.Getenv("NOKTA_FUZZ_TOHUM"), 10, 64)
	corpus := fuzzCorpus(t)
	good := corpus[0]
	r := rand.New(rand.NewPCG(seed, seed^0x5bd1e995))

	var hc *helperConn
	spawn := func() {
		for range 5 {
			if hc, err = spawnHelper(); err == nil {
				return
			}
		}
		t.Fatalf("yardımcı başlatılamadı: %v", err)
	}
	spawn()
	defer func() { hc.kill() }()

	req := make([]byte, helperReqHdr+maxPacketSize)
	call := func(slot byte, p []byte) (byte, time.Duration, bool) {
		q := req[:helperReqHdr+len(p)]
		q[0] = slot
		binary.LittleEndian.PutUint16(q[1:], uint16(len(p)))
		copy(q[helperReqHdr:], p)
		t0 := time.Now()
		if _, err := hc.w.Write(q); err != nil {
			return 0, time.Since(t0), false
		}
		tm := time.NewTimer(5 * time.Second)
		defer tm.Stop()
		select {
		case b := <-hc.resp:
			return b[0], time.Since(t0), b[0] == helperRespOK || b[0] == helperRespBad
		case <-hc.dead:
		case <-tm.C:
		}
		return 0, time.Since(t0), false
	}

	end := time.Now().Add(dur)
	var iters, filtered, sent, plc, bad, crashes, unusable, over15, over200 uint64
	var maxCall time.Duration
	var lats []time.Duration
	lastLog := time.Now()
	start := time.Now()
	for time.Now().Before(end) {
		iters++
		var p []byte
		if r.IntN(50) == 0 {
			plc++ // PLC isteği (uzunluk 0)
		} else {
			p = fuzzMutate(r, corpus)
			if opus20ms(p) != nil {
				filtered++
				continue
			}
		}
		sent++
		st, el, ok := call(byte(r.IntN(helperSlots)), p)
		if !ok {
			crashes++
			t.Logf("ÇÖKME/ASKI #%d (paket %d): son paket %s", crashes, sent, hex.EncodeToString(p))
			hc.kill()
			spawn()
			continue
		}
		maxCall = max(maxCall, el)
		if el > helperTickLimit {
			over15++
		}
		if el > helperHardLimit {
			over200++
		}
		if len(lats) < 1<<20 {
			lats = append(lats, el)
		}
		if st == helperRespBad {
			bad++
		}
		if sent%1000 == 0 { // kullanılabilirlik: bilinen iyi paket her yuvada çözülmeli
			for s := range byte(helperSlots) {
				if st, _, ok := call(s, good); !ok || st != helperRespOK {
					unusable++
				}
			}
		}
		if time.Since(lastLog) > time.Minute {
			lastLog = time.Now()
			t.Logf("[%s] yineleme %d süzgeçte düşen %d yardımcıya giden %d (PLC %d) çözülemedi %d çökme %d maks %.3f ms",
				time.Since(start).Round(time.Second), iters, filtered, sent, plc, bad, crashes, float64(maxCall.Microseconds())/1000)
		}
	}
	slices.Sort(lats)
	q := func(f float64) float64 {
		if len(lats) == 0 {
			return 0
		}
		return float64(lats[int(f*float64(len(lats)-1))].Microseconds()) / 1000
	}
	t.Logf("SONUÇ tohum %d süre %s: yineleme %d, süzgeçte düşen %d, yardımcıya giden %d (PLC %d), çözülemedi yanıtı %d, "+
		"çökme/askı %d, kullanılamaz %d, >15 ms %d, >200 ms %d, en uzun çağrı %.3f ms, p50 %.3f ms, p99 %.3f ms",
		seed, time.Since(start).Round(time.Second), iters, filtered, sent, plc, bad, crashes, unusable, over15, over200,
		float64(maxCall.Microseconds())/1000, q(0.5), q(0.99))
	if crashes != 0 || unusable != 0 || over200 != 0 {
		t.Fatalf("çökme %d, kullanılamaz %d, >200 ms %d", crashes, unusable, over200)
	}
}

// fuzzCorpus: gömülü ısıtma paketi (ilk; "iyi paket"), libopus altın paketleri ve 20 ms fikstürler.
func fuzzCorpus(t *testing.T) [][]byte {
	t.Helper()
	w, _ := hex.DecodeString(warmPacket)
	corpus := [][]byte{w}
	sets, _ := goldenSets(t)
	for _, s := range sets {
		corpus = append(corpus, s...)
	}
	f, err := os.Open("testdata/opus-fixtures.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<16)
	for sc.Scan() {
		fs := strings.Fields(sc.Text())
		if len(fs) == 3 && !strings.HasPrefix(fs[0], "#") {
			if p, err := hex.DecodeString(fs[2]); err == nil {
				corpus = append(corpus, p)
			}
		}
	}
	return corpus
}

// fuzzMutate test/spike-p33/cmd/k0sa1fuzz mutasyonlarının aynısı (bit/bayt, TOC, kırp/ekle/sil, ekleme, kod 3, 0/0xff blok).
func fuzzMutate(r *rand.Rand, corpus [][]byte) []byte {
	p := append([]byte(nil), corpus[r.IntN(len(corpus))]...)
	for range 1 + r.IntN(4) {
		switch r.IntN(11) {
		case 0, 1, 2:
			if len(p) > 0 {
				p[r.IntN(len(p))] ^= 1 << r.IntN(8)
			}
		case 3:
			if len(p) > 0 {
				p[r.IntN(len(p))] = byte(r.Uint32())
			}
		case 4:
			if len(p) > 0 {
				p[0] = byte(r.Uint32())
			}
		case 5:
			if len(p) > 1 {
				p = p[:1+r.IntN(len(p)-1)]
			}
		case 6:
			for range r.IntN(64) {
				p = append(p, byte(r.Uint32()))
			}
		case 7:
			if len(p) > 2 {
				i := 1 + r.IntN(len(p)-1)
				p = append(p[:i], p[i+1:]...)
			}
		case 8:
			q := corpus[r.IntN(len(corpus))]
			if len(q) > 1 && len(p) > 1 {
				p = append(p[:1+r.IntN(len(p)-1)], q[1+r.IntN(len(q)-1):]...)
			}
		case 9:
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
		case 10:
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
	if len(p) > maxPacketSize {
		p = p[:maxPacketSize]
	}
	return p
}
