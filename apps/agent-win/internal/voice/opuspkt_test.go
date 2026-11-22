package voice

import (
	"errors"
	"testing"
)

// P33 K1 (mimari-p33 §2, §9): RFC 6716 §3.4 R1–R7 tablo testi (her platformda; Linux CI dahil).
func TestP33K1OpusPacketRules(t *testing.T) {
	big := make([]byte, 2*1276)
	cases := []struct {
		name    string
		p       []byte
		want    error
		samples int
	}{
		{"R1 boş", nil, errOpusR1, 0},
		{"kod0 SILK NB 20 ms", []byte{0x08, 1, 2, 3}, nil, 960},
		{"kod0 yalnız TOC (DTX)", []byte{0x08}, nil, 960},
		{"kod0 1275 bayt", append([]byte{0xf8}, big[:1275]...), nil, 960},
		{"R2 kod0 1276 bayt", append([]byte{0x08}, big[:1276]...), errOpusR2, 0},
		{"R3 kod1 tek gövde", []byte{0x09, 1, 2, 3}, errOpusR3, 0},
		{"kod1 iki 20 ms", []byte{0x09, 1, 2}, nil, 1920},
		{"R2 kod1 çerçeve büyük", append([]byte{0x09}, big[:1276*2]...), errOpusR2, 0},
		{"R4 kod2 uzunluk yok", []byte{0x0a}, errOpusR4, 0},
		{"R4 kod2 uzunluk taşıyor", []byte{0x0a, 5, 1}, errOpusR4, 0},
		{"R4 kod2 iki baytlık uzunluk eksik", []byte{0x0a, 252}, errOpusR4, 0},
		{"kod2 tamam", []byte{0x0a, 1, 9, 8, 7}, nil, 1920},
		{"R5 M=0", []byte{0x0b, 0x00}, errOpusR5, 0},
		{"R5 7×60 ms", []byte{0x1b, 7}, errOpusR5, 0},
		{"kod3 6×20 ms = 120 ms sınırı", []byte{0x0b, 0x06}, nil, 5760},
		{"R6 sayı baytı yok", []byte{0x0b}, errOpusR6, 0},
		{"R6 kat değil", []byte{0x0b, 0x02, 1, 2, 3}, errOpusR6, 0},
		{"kod3 CBR", []byte{0x0b, 0x02, 1, 2}, nil, 1920},
		{"kod3 CBR dolgu", []byte{0x0b, 0x42, 2, 1, 2, 0, 0}, nil, 1920},
		{"R6 dolgu fazla", []byte{0x0b, 0x42, 9, 1, 2}, errOpusR6, 0},
		{"R6 dolgu uzunluğu yok", []byte{0x0b, 0x42}, errOpusR6, 0},
		{"kod3 dolgu 255 zinciri", append([]byte{0x0b, 0x41, 255, 0}, big[:254]...), nil, 960},
		{"kod3 VBR", []byte{0x0b, 0x82, 1, 7, 8, 9}, nil, 1920},
		{"R7 VBR kısa", []byte{0x0b, 0x82, 5, 7}, errOpusR7, 0},
		{"R7 VBR dolgu", []byte{0x0b, 0xc2, 3, 1, 7, 8}, errOpusR7, 0},
		{"R7 VBR uzunluk yok", []byte{0x0b, 0x82}, errOpusR7, 0},
		{"CELT 2,5 ms", []byte{0x80, 1}, nil, 120},
		{"Hibrit FB 20 ms stereo", []byte{0x7c, 1, 2}, nil, 960},
	}
	for _, c := range cases {
		n, err := opusPacketSamples(c.p)
		if !errors.Is(err, c.want) {
			t.Errorf("%s: hata %v, beklenen %v", c.name, err, c.want)
			continue
		}
		if err == nil && n != c.samples {
			t.Errorf("%s: %d örnek, beklenen %d", c.name, n, c.samples)
		}
	}
}

// B1 (spike §2.1): darwin arka ucu yalnız 20 ms (960 örnek) paketleri çözücüye verir; süzgeç R1–R7'den sonradır.
func TestP33K1Only20msPacketsPassFilter(t *testing.T) {
	cases := []struct {
		p    []byte
		pass bool
	}{
		{[]byte{0x08, 1}, true},                 // SILK NB 20 ms
		{[]byte{0xfc, 1}, true},                 // CELT FB 20 ms stereo bayraklı
		{[]byte{0x00, 1}, false},                // SILK NB 10 ms
		{[]byte{0x10, 1}, false},                // SILK NB 40 ms
		{[]byte{0x09, 1, 2}, false},             // kod 1, 2 × 20 ms = 40 ms
		{[]byte{0x0b, 0x01, 1}, true},           // kod 3, 1 × 20 ms
		{[]byte{0xf3, 0x02, 1, 2}, true},        // kod 3, 2 × 10 ms CELT = 20 ms
		{[]byte{0xf3, 0x04, 1, 2, 3, 4}, false}, // kod 3, 4 × 10 ms CELT = 40 ms
		{[]byte{0x0b, 0x00}, false},             // R5
	}
	for _, c := range cases {
		if got := opus20ms(c.p) == nil; got != c.pass {
			t.Errorf("% x: geçti=%v, beklenen %v", c.p, got, c.pass)
		}
	}
}

// FuzzOpusPacketValid R1–R7 hiçbir girdide paniklemez; geçerli paketin süresi 2,5 ms'nin katı ve ≤ 120 ms'dir.
func FuzzOpusPacketValid(f *testing.F) {
	for _, s := range [][]byte{{0x08}, {0x09, 1, 2}, {0x0a, 1, 9, 8}, {0x0b, 0x82, 1, 7, 8}, {0x0b, 0x42, 2, 1, 2, 0, 0}} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, p []byte) {
		n, err := opusPacketSamples(p)
		if err != nil {
			return
		}
		if n <= 0 || n > maxFrame || n%120 != 0 {
			t.Fatalf("% x: süre %d örnek", p, n)
		}
		if len(p) > 1+6*1275+64 && p[0]&3 != 3 {
			t.Fatalf("% x: kod 0–2 paket bu kadar uzun olamaz (%d)", p[:8], len(p))
		}
	})
}
