//go:build darwin

// k1golden: P33 K1 — darwin çapraz SNR testinin altın fikstürü (internal/voice/testdata/opus-golden.bin). darwin
// ikilisinde wazero olmadığından libopus çıktısı bir kez burada (P33 öncesi voice = libopus.wasm) üretilir.
// Biçim (küçük uçlu): "NKOG" | u16 küme sayısı | her küme: u16 paket sayısı | her paket: u16 uzunluk + yük | ardından
// paket × 960 s16 libopus çıktısı. Küme 0: libopus (VOIP 32k) kodlu; küme 1: Apple AudioToolbox kodlu.
package main

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"

	"remote-support/agent-win/internal/voice"
	"remote-support/agent-win/test/spike-p33/at"
	"remote-support/agent-win/test/spike-p33/sig"
)

const frames = 20

func main() {
	pcm := sig.SpeechLike(frames, 7)
	var sets [][][]byte
	le, err := voice.NewEncoder()
	must(err)
	var a [][]byte
	for f := range frames {
		p, err := le.Encode(pcm[f*960 : (f+1)*960])
		must(err)
		a = append(a, append([]byte(nil), p...))
	}
	sets = append(sets, a)
	ae, err := at.NewEncoder(32000)
	must(err)
	var b [][]byte
	for f := range frames {
		ps, err := ae.Encode(pcm[f*960 : (f+1)*960])
		must(err)
		if len(ps) != 1 {
			panic("apple paket")
		}
		b = append(b, ps[0])
	}
	sets = append(sets, b)
	out := []byte("NKOG")
	out = binary.LittleEndian.AppendUint16(out, uint16(len(sets)))
	for si, set := range sets {
		ld, err := voice.NewDecoder()
		must(err)
		ad, err := at.NewDecoder(1, 1, nil)
		must(err)
		out = binary.LittleEndian.AppendUint16(out, uint16(len(set)))
		for _, p := range set {
			out = binary.LittleEndian.AppendUint16(out, uint16(len(p)))
			out = append(out, p...)
		}
		var sigE, noise float64
		for fi, p := range set {
			lo, err := ld.Decode(p)
			must(err)
			if len(lo) != 960 {
				panic("libopus 960 değil")
			}
			for _, s := range lo {
				out = binary.LittleEndian.AppendUint16(out, uint16(s))
			}
			ao, err := ad.DecodeCap(p, 960)
			must(err)
			full := make([]int16, 960)
			copy(full[960-len(ao):], ao) // başa sıfır (B3)
			for i := range 960 {
				if fi == 0 && i < 960-len(ao) {
					continue
				}
				d := float64(lo[i]) - float64(full[i])
				sigE += float64(lo[i]) * float64(lo[i])
				noise += d * d
			}
			if fi == 0 {
				fmt.Printf("küme %d ilk çerçeve Apple %d örnek\n", si, len(ao))
			}
		}
		fmt.Printf("küme %d: Apple(başa dolgu) ↔ libopus SNR %.1f dB\n", si, 10*math.Log10(sigE/max(noise, 1)))
	}
	must(os.WriteFile(os.Args[1], out, 0o644))
	fmt.Println("yazıldı", len(out), "bayt")
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
