//go:build darwin

// k0sa1: AudioToolbox Opus işlevsel ölçümleri (kurulum, SNR, çapraz çözme, TOC, PLC/FEC, fikstürler, derlem).
// Süre ölçümü ayrı ikilide (k0sa1bench; wazero'ya bağlanmaz).
package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"time"

	"remote-support/agent-win/internal/voice"
	"remote-support/agent-win/test/spike-p33/at"
	"remote-support/agent-win/test/spike-p33/opuspkt"
	"remote-support/agent-win/test/spike-p33/sig"
)

var (
	mode     = flag.String("mode", "info", "info|snr|fixtures|plc|corpus")
	frames   = flag.Int("frames", 500, "çerçeve (20 ms)")
	fixtures = flag.String("fixtures", "../../internal/voice/testdata/opus-fixtures.txt", "fikstür dosyası")
	chrome   = flag.String("chrome", "", "Chrome paket dosyası (ad örnek hex)")
	out      = flag.String("out", "", "derlem çıktısı")
	fpp      = flag.Uint("fpp", 960, "çözücü giriş ASBD çerçeve/paket")
)

func main() {
	flag.Parse()
	switch *mode {
	case "info":
		info()
	case "snr":
		snr()
	case "fixtures":
		fixtureTest()
	case "plc":
		plc()
	case "corpus":
		corpus()
	default:
		fmt.Println("bilinmeyen kip")
		os.Exit(2)
	}
}

func die(f string, a ...any) {
	fmt.Fprintf(os.Stderr, f+"\n", a...)
	os.Exit(1)
}

func info() {
	for _, dec := range []bool{false, true} {
		cs, err := at.Codecs(dec)
		fmt.Printf("Opus %s: %v err=%v\n", map[bool]string{false: "kodlayıcılar", true: "çözücüler"}[dec], cs, err)
	}
	for _, br := range []uint32{0, 32000} {
		e, err := at.NewEncoder(br)
		if err != nil {
			fmt.Printf("NewEncoder(%d): %v\n", br, err)
			continue
		}
		inf := e.Info()
		fmt.Printf("kodlayıcı brat=%d istenen=%d: prime=%d/%d maxOutPkt=%d quality=%d cookie=%d bayt %x\n  applicable=%v\n  outASBD=%+v\n",
			inf.BitRate, br, inf.PrimeLeading, inf.PrimeTrailing, inf.MaxOutPacket, inf.Quality, inf.CookieLen, inf.Cookie, inf.Applicable, inf.OutASBD)
		fmt.Printf("  settings=%s\n", strings.ReplaceAll(inf.Settings, "\n", " "))
		e.Close()
	}
	for _, ch := range [][2]uint32{{1, 1}, {2, 1}, {2, 2}} {
		d, err := at.NewDecoder(ch[0], ch[1], nil)
		fmt.Printf("NewDecoder(in=%d,out=%d): err=%v\n", ch[0], ch[1], err)
		if err == nil {
			fmt.Printf("  settings=%s\n", strings.ReplaceAll(d.Settings(), "\n", " "))
			d.Close()
		}
	}
	for _, br := range []uint32{6000, 16000, 24000, 48000, 64000, 128000, 510000} {
		e, err := at.NewEncoder(br)
		if err != nil {
			fmt.Printf("brat %d: %v\n", br, err)
			continue
		}
		got, _ := e.GetU32(0x62726174)
		fmt.Printf("brat %d → %d\n", br, got)
		e.Close()
	}
}

// appleEncode tüm sinyali kodlar; çağrı başına paket sayısı dağılımı ve TOC istatistiği.
func appleEncode(pcm []int16) ([][]byte, map[int]int) {
	e, err := at.NewEncoder(32000)
	if err != nil {
		die("kodlayıcı: %v", err)
	}
	defer e.Close()
	per := map[int]int{}
	var pkts [][]byte
	for f := 0; f+960 <= len(pcm); f += 960 {
		ps, err := e.Encode(pcm[f : f+960])
		if err != nil {
			die("kodlama %d: %v", f/960, err)
		}
		per[len(ps)]++
		pkts = append(pkts, ps...)
	}
	return pkts, per
}

func appleDecode(pkts [][]byte, inCh uint32) ([]int16, map[int]int, int) {
	d, err := at.NewDecoderFrames(inCh, 1, uint32(*fpp), nil)
	if err != nil {
		die("çözücü: %v", err)
	}
	defer d.Close()
	var y []int16
	lens := map[int]int{}
	errs := 0
	for i, p := range pkts {
		o, err := d.Decode(p)
		if err != nil {
			errs++
			if errs < 4 {
				fmt.Printf("  apple çözme %d: %v\n", i, err)
			}
			continue
		}
		lens[len(o)]++
		y = append(y, o...)
	}
	return y, lens, errs
}

func wasmEncode(pcm []int16) [][]byte {
	e, err := voice.NewEncoder()
	if err != nil {
		die("wasm kodlayıcı: %v", err)
	}
	defer e.Close()
	var pkts [][]byte
	for f := 0; f+960 <= len(pcm); f += 960 {
		p, err := e.Encode(pcm[f : f+960])
		if err != nil {
			die("wasm kodlama: %v", err)
		}
		pkts = append(pkts, append([]byte(nil), p...))
	}
	return pkts
}

// wasmDecode voice.Decoder (100 paket/sn sınırı duvar saatiyle; çağrılar 11 ms aralıklı).
func wasmDecode(pkts [][]byte) []int16 {
	d, err := voice.NewDecoder()
	if err != nil {
		die("wasm çözücü: %v", err)
	}
	defer d.Close()
	var y []int16
	last := time.Now()
	for i, p := range pkts {
		if w := 11*time.Millisecond - time.Since(last); w > 0 {
			time.Sleep(w)
		}
		last = time.Now()
		o, err := d.Decode(p)
		if err != nil {
			die("wasm çözme %d: %v", i, err)
		}
		y = append(y, o...)
	}
	return y
}

func tocStats(name string, pkts [][]byte) {
	cnt := map[string]int{}
	bytes, bad := 0, 0
	for _, p := range pkts {
		bytes += len(p)
		in, err := opuspkt.Validate(p)
		if err != nil {
			bad++
			continue
		}
		cnt[fmt.Sprintf("cfg%d %s-%s %gms kod%d st=%v", in.Config, in.Mode, in.BW, float64(in.FrameSmp)/48, in.Code, in.Stereo)]++
	}
	keys := make([]string, 0, len(cnt))
	for k := range cnt {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	fmt.Printf("%s: %d paket, ort %.1f kbit/s, R1–R7 geçersiz %d\n", name, len(pkts), float64(bytes*8)/(float64(len(pkts))*0.02)/1000, bad)
	for _, k := range keys {
		fmt.Printf("    %-40s %d\n", k, cnt[k])
	}
}

func snr() {
	ref := sig.SpeechLike(*frames, 1)
	const skip = 10 * 960
	pa, per := appleEncode(ref)
	fmt.Printf("Apple Encode: çağrı başına paket dağılımı %v (çağrı = 960 örnek)\n", per)
	tocStats("Apple paketleri", pa)
	pw := wasmEncode(ref)
	tocStats("libopus(wasm) paketleri", pw)

	yAA, lAA, eAA := appleDecode(pa, 1)
	fmt.Printf("Apple→Apple: çıktı boy dağılımı %v hata %d toplam %d örnek\n", lAA, eAA, len(yAA))
	yWA, lWA, eWA := appleDecode(pw, 1)
	fmt.Printf("libopus→Apple: çıktı boy dağılımı %v hata %d toplam %d örnek\n", lWA, eWA, len(yWA))
	yAW := wasmDecode(pa)
	yWW := wasmDecode(pw)

	rep := func(n string, ref, got []int16, lo, hi int) {
		s, d := sig.BestSNR(ref, got, skip, lo, hi)
		fmt.Printf("  %-42s SNR %6.2f dB (gecikme %d örnek)\n", n, s, d)
	}
	fmt.Println("Özgün sinyale göre (algısal kodek; dalga biçimi SNR'ı):")
	rep("Apple kodla → Apple çöz", ref, yAA, -1000, 2000)
	rep("Apple kodla → libopus çöz", ref, yAW, -1000, 2000)
	rep("libopus kodla → libopus çöz (taban)", ref, yWW, -1000, 2000)
	rep("libopus kodla → Apple çöz", ref, yWA, -1000, 2000)
	fmt.Println("Aynı paketlerin iki çözücü çıktısı (birlikte çalışma):")
	rep("Apple paketleri: libopus çözümü ↔ Apple çözümü", yAW, yAA, -1000, 1000)
	rep("libopus paketleri: libopus çözümü ↔ Apple çözümü", yWW, yWA, -1000, 1000)
}

func fixtureTest() {
	fx, err := sig.ReadFixtures(*fixtures)
	if err != nil {
		die("fikstür: %v", err)
	}
	if *chrome != "" {
		cf, err := sig.ReadFixtures(*chrome)
		if err != nil {
			die("chrome: %v", err)
		}
		fx = append(fx, cf...)
	}
	// Apple paketlerinden yeniden paketleme (kod 1/2/3) ve 1 baytlık paket.
	pa, _ := appleEncode(sig.SpeechLike(20, 7))
	a, b := pa[10], pa[11]
	if a[0]&3 == 0 && b[0]&3 == 0 && a[0] == b[0] {
		toc := a[0] &^ 3
		fx = append(fx, sig.Fixture{Name: "apple-tek", Frame: 960, Pkt: a})
		fx = append(fx, sig.Fixture{Name: "apple-1bayt-DTX", Frame: 960, Pkt: []byte{toc}})
		if len(a) == len(b) {
			fx = append(fx, sig.Fixture{Name: "apple-kod1-40ms", Frame: 1920, Pkt: append(append([]byte{toc | 1}, a[1:]...), b[1:]...)})
		}
		l1 := len(a) - 1
		hdr := []byte{toc | 2}
		if l1 < 252 {
			hdr = append(hdr, byte(l1))
		} else {
			hdr = append(hdr, byte(252+(l1-252)%4), byte((l1-252)/4))
		}
		fx = append(fx, sig.Fixture{Name: "apple-kod2-40ms", Frame: 1920, Pkt: append(append(hdr, a[1:]...), b[1:]...)})
		v := []byte{toc | 3, 0x80 | 2}
		if l1 < 252 {
			v = append(v, byte(l1))
		} else {
			v = append(v, byte(252+(l1-252)%4), byte((l1-252)/4))
		}
		fx = append(fx, sig.Fixture{Name: "apple-kod3vbr-40ms", Frame: 1920, Pkt: append(append(v, a[1:]...), b[1:]...)})
		fx = append(fx, sig.Fixture{Name: "apple-kod3cbr-1çerçeve", Frame: 960, Pkt: append([]byte{toc | 3, 1}, a[1:]...)})
		fx = append(fx, sig.Fixture{Name: "apple-kod3-dolgulu", Frame: 960, Pkt: append(append([]byte{toc | 3, 0x40 | 1, 3}, a[1:]...), 0, 0, 0)})
	} else {
		fmt.Printf("yeniden paketleme atlandı: TOC %x %x\n", a[0], b[0])
	}
	for _, inCh := range []uint32{1, 2} {
		fmt.Printf("Apple çözücü giriş ASBD %d kanal (çıkış mono):\n", inCh)
		for _, f := range fx {
			d, err := at.NewDecoderFrames(inCh, 1, uint32(*fpp), nil)
			if err != nil {
				die("çözücü: %v", err)
			}
			in, verr := opuspkt.Validate(f.Pkt)
			// ısınma: aynı paketi iki kez (çözücü gecikmesi ilk çağrıda çıktıyı kısabilir)
			o1, err1 := d.Decode(f.Pkt)
			n1, r1 := len(o1), sig.RMS(o1)
			o2, err2 := d.Decode(f.Pkt)
			fmt.Printf("  %-24s %5d bayt TOC cfg%-2d %s st=%-5v kod%d beklenen %4d | 1.: %4d örnek rms %6.0f err=%v | 2.: %4d örnek rms %6.0f err=%v (R1–R7: %v)\n",
				f.Name, len(f.Pkt), in.Config, in.Mode, in.Stereo, in.Code, f.Frame, n1, r1, err1, len(o2), sig.RMS(o2), err2, verr)
			d.Close()
		}
	}
}

func plc() {
	ref := sig.SpeechLike(80, 2)
	pa, _ := appleEncode(ref)
	pw := wasmEncode(ref)
	for _, set := range []struct {
		n    string
		pkts [][]byte
	}{{"Apple paketleri", pa}, {"libopus paketleri", pw}} {
		fmt.Println(set.n + ":")
		d, err := at.NewDecoderFrames(1, 1, uint32(*fpp), nil)
		if err != nil {
			die("%v", err)
		}
		for i := 0; i < 40; i++ {
			if _, err := d.Decode(set.pkts[i]); err != nil {
				fmt.Printf("  %d: %v\n", i, err)
			}
		}
		o, err := d.DecodeCap(nil, 960)
		fmt.Printf("  boş paket (0 bayt, 1 paket tanımı, kapasite 960): %d örnek rms %.0f err=%v\n", len(o), sig.RMS(o), err)
		o, err = d.DecodeCap(nil, 960)
		fmt.Printf("  ikinci boş paket, kapasite 960: %d örnek rms %.0f err=%v\n", len(o), sig.RMS(o), err)
		o, err = d.Decode(set.pkts[42]) // 41 atlandı (kayıp, hiç verilmedi)
		fmt.Printf("  kayıp sonrası paket (41 atlandı): %d örnek rms %.0f err=%v\n", len(o), sig.RMS(o), err)
		for _, toc := range []byte{set.pkts[43][0]} {
			o, err = d.Decode([]byte{toc})
			fmt.Printf("  yalnız TOC (1 bayt, DTX/kayıp işareti): %d örnek rms %.0f err=%v\n", len(o), sig.RMS(o), err)
		}
		o, err = d.Decode(set.pkts[44])
		fmt.Printf("  sonraki gerçek paket: %d örnek rms %.0f err=%v\n", len(o), sig.RMS(o), err)
		d.Close()
		// referans: libopus PLC
		wd, _ := voice.NewDecoder()
		for i := 0; i < 40; i++ {
			time.Sleep(11 * time.Millisecond)
			_, _ = wd.Decode(set.pkts[i])
		}
		wo, err := wd.Conceal()
		fmt.Printf("  libopus Conceal (referans): %d örnek rms %.0f err=%v\n", len(wo), sig.RMS(wo), err)
		time.Sleep(11 * time.Millisecond)
		wo, err = wd.DecodeFEC(set.pkts[41])
		fmt.Printf("  libopus DecodeFEC(sonraki): %d örnek rms %.0f err=%v\n", len(wo), sig.RMS(wo), err)
		_ = wd.Close()
		// 1 baytlık TOC'un neden olduğu dalga: gerçek kayıpla karşılaştırma
		_ = math.Abs
	}
}

func corpus() {
	if *out == "" {
		die("-out gerekli")
	}
	f, err := os.Create(*out)
	if err != nil {
		die("%v", err)
	}
	defer f.Close()
	n := 0
	w := func(name string, p []byte) {
		fmt.Fprintf(f, "%s %d %s\n", name, 0, hex.EncodeToString(p))
		n++
	}
	for seed := uint64(1); seed <= 3; seed++ {
		ref := sig.SpeechLike(100, seed)
		pa, _ := appleEncode(ref)
		for i, p := range pa {
			w(fmt.Sprintf("apple-%d-%d", seed, i), p)
		}
		if seed == 1 {
			for i, p := range wasmEncode(ref) {
				w(fmt.Sprintf("libopus-%d-%d", seed, i), p)
			}
		}
	}
	fx, _ := sig.ReadFixtures(*fixtures)
	for _, x := range fx {
		w("fx-"+x.Name, x.Pkt)
	}
	if *chrome != "" {
		cf, _ := sig.ReadFixtures(*chrome)
		for _, x := range cf {
			w("chrome-"+x.Name, x.Pkt)
		}
	}
	fmt.Printf("derlem: %d paket → %s\n", n, *out)
}
