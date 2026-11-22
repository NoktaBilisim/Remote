package opuspkt

import (
	"errors"
	"testing"
)

func TestRules(t *testing.T) {
	big := make([]byte, 1277)
	cases := []struct {
		name string
		p    []byte
		want error
	}{
		{"R1 boş", nil, ErrR1},
		{"kod0 tamam", []byte{0x08, 1, 2, 3}, nil},
		{"kod0 DTX", []byte{0x08}, nil},
		{"R2 kod0 büyük", append([]byte{0x08}, big[:1276]...), ErrR2},
		{"R3 kod1 çift", []byte{0x09, 1, 2, 3}, ErrR3},
		{"kod1 tamam", []byte{0x09, 1, 2}, nil},
		{"R4 kod2 yok", []byte{0x0a}, ErrR4},
		{"R4 kod2 uzun", []byte{0x0a, 5, 1}, ErrR4},
		{"kod2 tamam", []byte{0x0a, 1, 9, 8, 7}, nil},
		{"R5 M=0", []byte{0x0b, 0x00}, ErrR5},
		{"R5 > 120 ms", []byte{0x0b, 3}, ErrR5}, // config 1 = SILK NB 20 ms; 3×20 tamam → aşağıda
		{"R6 N<2", []byte{0x0b}, ErrR6},
		{"R6 kat değil", []byte{0x0b, 0x02, 1, 2, 3}, ErrR6},
		{"kod3 CBR", []byte{0x0b, 0x02, 1, 2}, nil},
		{"kod3 CBR dolgu", []byte{0x0b, 0x42, 2, 1, 2, 0, 0}, nil},
		{"R6 dolgu fazla", []byte{0x0b, 0x42, 9, 1, 2}, ErrR6},
		{"kod3 VBR", []byte{0x0b, 0x82, 1, 7, 8, 9}, nil},
		{"R7 VBR kısa", []byte{0x0b, 0x82, 5, 7}, ErrR7},
		{"R7 VBR dolgu", []byte{0x0b, 0xc2, 3, 1, 7, 8}, ErrR7},
	}
	cases[10].p = []byte{0x1b, 7} // config 3 = SILK NB 60 ms × 7 = 420 ms
	for _, c := range cases {
		_, err := Validate(c.p)
		if !errors.Is(err, c.want) && !(err == nil && c.want == nil) {
			t.Errorf("%s: %v, beklenen %v", c.name, err, c.want)
		}
	}
}
