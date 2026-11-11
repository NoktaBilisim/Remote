// Package input `input` DataChannel mesajlarını (mimari-protokol §4.3) doğrular, izin kapısından geçirir ve
// Windows SendInput olaylarına çevirir. Kapı denetimi enjeksiyondan HEMEN önce, aynı kilit altında yapılır (AC-101).
// Platformdan bağımsız kısım burada; SendInput, düşük seviye kancalar ve global kısayol *_windows.go dosyalarında.
package input

import (
	"bytes"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"unicode/utf8"
)

const (
	// MaxBytes tek input mesajı üst sınırı.
	MaxBytes  = 512
	wheelMax  = 1200
	codeMax   = 32
	keyMaxU16 = 4
)

var codeRe = regexp.MustCompile(`^[A-Za-z0-9]{1,32}$`)

// Msg doğrulanmış input mesajı; T tipi belirler.
type Msg struct {
	T    string   `json:"t"`
	X    *float64 `json:"x,omitempty"`
	Y    *float64 `json:"y,omitempty"`
	B    string   `json:"b,omitempty"`
	Down *bool    `json:"down,omitempty"`
	DX   *int     `json:"dx,omitempty"`
	DY   *int     `json:"dy,omitempty"`
	Code string   `json:"code,omitempty"`
	Key  *string  `json:"key,omitempty"`
}

var fields = map[string]struct{ req, opt []string }{
	"m.move":        {[]string{"x", "y"}, nil},
	"m.btn":         {[]string{"b", "down", "x", "y"}, nil},
	"m.wheel":       {[]string{"dx", "dy"}, nil},
	"k":             {[]string{"code", "down"}, []string{"key"}},
	"k.release_all": {nil, nil},
}

var errInvalid = errors.New("input: geçersiz mesaj")

// Parse ham input çerçevesini katı doğrular (zod strictObject eşi); hata → mesaj düşer.
func Parse(raw []byte) (Msg, error) {
	if len(raw) > MaxBytes || !utf8.Valid(raw) {
		return Msg{}, errInvalid
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return Msg{}, errInvalid
	}
	var t string
	if json.Unmarshal(obj["t"], &t) != nil {
		return Msg{}, errInvalid
	}
	f, ok := fields[t]
	if !ok {
		return Msg{}, errInvalid
	}
	for k, v := range obj {
		if bytes.Equal(v, []byte("null")) || (k != "t" && !slices.Contains(f.req, k) && !slices.Contains(f.opt, k)) {
			return Msg{}, errInvalid
		}
	}
	for _, k := range f.req {
		if _, ok := obj[k]; !ok {
			return Msg{}, errInvalid
		}
	}
	var m Msg
	if json.Unmarshal(raw, &m) != nil || !m.valid() {
		return Msg{}, errInvalid
	}
	return m, nil
}

func unit(v *float64) bool { return *v >= 0 && *v <= 1 }

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func (m Msg) valid() bool {
	switch m.T {
	case "m.move":
		return unit(m.X) && unit(m.Y)
	case "m.btn":
		return (m.B == "l" || m.B == "r" || m.B == "m") && unit(m.X) && unit(m.Y)
	case "m.wheel":
		return *m.DX >= -wheelMax && *m.DX <= wheelMax && *m.DY >= -wheelMax && *m.DY <= wheelMax
	case "k":
		return codeRe.MatchString(m.Code) && (m.Key == nil || (*m.Key != "" && utf16Len(*m.Key) <= keyMaxU16))
	}
	return true // k.release_all
}
