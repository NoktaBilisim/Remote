//go:build darwin

// k0sa1bench: AudioToolbox Opus kodla + çöz süresi (çerçeve başına). wazero'ya bağlanmaz (Rosetta x86_64 koşusu için).
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"time"

	"remote-support/agent-win/test/spike-p33/at"
	"remote-support/agent-win/test/spike-p33/sig"
)

func main() {
	n := flag.Int("frames", 5000, "ölçülen çerçeve")
	warm := flag.Int("warm", 200, "ısınma çerçevesi")
	decoders := flag.Int("decoders", 1, "paket başına çözücü sayısı (konuşan)")
	flag.Parse()
	pcm := sig.SpeechLike(*n+*warm, 11)
	enc, err := at.NewEncoder(32000)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	defer enc.Close()
	var decs []*at.Decoder
	for range *decoders {
		d, err := at.NewDecoder(1, 1, nil)
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		defer d.Close()
		decs = append(decs, d)
	}
	var te, td, tt []time.Duration
	bytes := 0
	for f := range *n + *warm {
		t0 := time.Now()
		ps, err := enc.Encode(pcm[f*960 : (f+1)*960])
		t1 := time.Now()
		if err != nil || len(ps) != 1 {
			fmt.Println("kodlama", f, err, len(ps))
			os.Exit(1)
		}
		for _, d := range decs {
			o, err := d.Decode(ps[0])
			if err != nil || (f > 0 && len(o) != 960) {
				fmt.Println("çözme", f, err, len(o))
				os.Exit(1)
			}
		}
		t2 := time.Now()
		if f >= *warm {
			te = append(te, t1.Sub(t0))
			td = append(td, t2.Sub(t1))
			tt = append(tt, t2.Sub(t0))
			bytes += len(ps[0])
		}
	}
	fmt.Printf("GOARCH=%s çerçeve=%d çözücü=%d ort %.1f kbit/s\n", runtime.GOARCH, *n, *decoders, float64(bytes*8)/(float64(*n)*0.02)/1000)
	for _, x := range []struct {
		name string
		d    []time.Duration
	}{{"kodla", te}, {"çöz", td}, {"kodla+çöz", tt}} {
		p := sig.Pct(x.d, 50, 95, 99, 100)
		var sum time.Duration
		for _, v := range x.d {
			sum += v
		}
		fmt.Printf("  %-10s ort %.3f p50 %.3f p95 %.3f p99 %.3f maks %.3f ms\n", x.name, float64(sum.Microseconds())/float64(len(x.d))/1000, p[0], p[1], p[2], p[3])
	}
}
