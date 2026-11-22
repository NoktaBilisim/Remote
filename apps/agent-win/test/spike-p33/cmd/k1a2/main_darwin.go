//go:build darwin

// k1a2: P33 K1 ilk adımı K0s-A2 (Mikrofon TCC, ad-hoc + hardened runtime) için ürün kodunu (internal/macperm,
// internal/voice AudioQueue) .app kimliğiyle koşturan düzenek. İstem yalnız -request-mic ile açılır (ELLE).
// Çıktı -o dosyasına yazılır (open -W ile başlatılan .app'in stdout'u terminale gelmez).
package main

import (
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"time"

	"remote-support/agent-win/internal/macperm"
	"remote-support/agent-win/internal/voice"
)

func main() {
	out := flag.String("o", "", "çıktı dosyası")
	req := flag.Bool("request-mic", false, "ELLE: mikrofon istemini aç (≤ 60 sn)")
	aq := flag.Duration("aq", 0, "AudioQueue girişini bu süre aç (örnek RMS + Close süresi)")
	flag.Parse()
	var w io.Writer = os.Stdout
	if *out != "" {
		f, err := os.Create(*out)
		if err != nil {
			os.Exit(1)
		}
		defer f.Close()
		w = f
	}
	names := map[macperm.MicStatus]string{0: "notDetermined", 1: "restricted", 2: "denied", 3: "authorized"}
	st := macperm.Microphone()
	fmt.Fprintf(w, "%s durum: %d (%s)\n", time.Now().Format(time.RFC3339), st, names[st])
	if *req {
		fmt.Fprintln(w, "requestAccessForMediaType çağrılıyor (istem)…")
		g := macperm.RequestMicrophone(macperm.MicRequestWait)
		st = macperm.Microphone()
		fmt.Fprintf(w, "istem sonucu granted=%v, durum: %d (%s)\n", g, st, names[st])
	}
	if *aq > 0 {
		dev, err := voice.OpenAudioQueue()
		if err != nil {
			fmt.Fprintln(w, "AudioQueue açılamadı:", err)
			return
		}
		pcm := make([]int16, voice.FrameSamples)
		var e float64
		n := 0
		end := time.Now().Add(*aq)
		for time.Now().Before(end) {
			if err := dev.ReadFrame(pcm); err != nil {
				fmt.Fprintln(w, "okuma:", err)
				break
			}
			for _, s := range pcm {
				e += float64(s) * float64(s)
			}
			n += len(pcm)
		}
		t0 := time.Now()
		_ = dev.Close()
		fmt.Fprintf(w, "AudioQueue: %d örnek, RMS %.1f (0 = sessiz: izin yok ya da sessiz ortam); Close %v — turuncu "+
			"gösterge şimdi sönmeli (kronometre)\n", n, math.Sqrt(e/math.Max(1, float64(n))), time.Since(t0))
	}
}
