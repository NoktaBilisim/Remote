// Package opuspkt RFC 6716 §3.4 Opus paket geçerlilik kuralları R1–R7 (saf Go; spike sürümü — ürün sürümü K1'de
// internal/voice/opuspkt.go olarak yazılır).
package opuspkt

import "errors"

// Hatalar kural numarasıyla.
var (
	ErrR1 = errors.New("R1: paket boş")
	ErrR2 = errors.New("R2: çerçeve 1275 bayttan uzun")
	ErrR3 = errors.New("R3: kod 1 paket uzunluğu tek değil")
	ErrR4 = errors.New("R4: kod 2 çerçeve uzunluğu geçersiz")
	ErrR5 = errors.New("R5: kod 3 çerçeve sayısı 0 ya da toplam > 120 ms")
	ErrR6 = errors.New("R6: kod 3 CBR uzunluk/dolgu tutarsız")
	ErrR7 = errors.New("R7: kod 3 VBR başlık/uzunluk yetersiz")
)

const maxFrameBytes = 1275

// Info doğrulanmış paketin özeti.
type Info struct {
	Config   int  // 0..31
	Stereo   bool // s biti
	Code     int  // 0..3
	Frames   int  // çerçeve sayısı
	FrameSmp int  // çerçeve başına örnek (48 kHz)
	Mode     string
	BW       string
	Lens     []int
	Padding  int
}

// Samples paketin toplam örnek sayısı (48 kHz).
func (i Info) Samples() int { return i.Frames * i.FrameSmp }

// frameSamples TOC yapılandırmasından çerçeve süresi (48 kHz örnek).
func frameSamples(cfg int) int {
	switch {
	case cfg < 12: // SILK 10/20/40/60
		return []int{480, 960, 1920, 2880}[cfg&3]
	case cfg < 16: // Hibrit 10/20
		return []int{480, 960}[cfg&1]
	default: // CELT 2.5/5/10/20
		return []int{120, 240, 480, 960}[cfg&3]
	}
}

func modeBW(cfg int) (string, string) {
	switch {
	case cfg < 12:
		return "SILK", []string{"NB", "MB", "WB"}[cfg/4]
	case cfg < 16:
		return "Hibrit", []string{"SWB", "FB"}[(cfg-12)/2]
	default:
		return "CELT", []string{"NB", "WB", "SWB", "FB"}[(cfg-16)/4]
	}
}

// frameLen RFC 6716 §3.2.1 çerçeve uzunluğu (1 ya da 2 bayt); (uzunluk, tüketilen bayt, tamam).
func frameLen(b []byte) (int, int, bool) {
	if len(b) < 1 {
		return 0, 0, false
	}
	if b[0] < 252 {
		return int(b[0]), 1, true
	}
	if len(b) < 2 {
		return 0, 0, false
	}
	return int(b[1])*4 + int(b[0]), 2, true
}

// Validate R1–R7; geçerliyse özet döner.
func Validate(p []byte) (Info, error) {
	var in Info
	if len(p) < 1 {
		return in, ErrR1
	}
	toc := p[0]
	in.Config, in.Stereo, in.Code = int(toc>>3), toc&4 != 0, int(toc&3)
	in.FrameSmp = frameSamples(in.Config)
	in.Mode, in.BW = modeBW(in.Config)
	rest := p[1:]
	switch in.Code {
	case 0:
		if len(rest) > maxFrameBytes {
			return in, ErrR2
		}
		in.Frames, in.Lens = 1, []int{len(rest)}
	case 1:
		if len(p)%2 != 1 {
			return in, ErrR3
		}
		l := len(rest) / 2
		if l > maxFrameBytes {
			return in, ErrR2
		}
		in.Frames, in.Lens = 2, []int{l, l}
	case 2:
		l1, n, ok := frameLen(rest)
		if !ok || l1 > len(rest)-n {
			return in, ErrR4
		}
		l2 := len(rest) - n - l1
		if l1 > maxFrameBytes || l2 > maxFrameBytes {
			return in, ErrR2
		}
		in.Frames, in.Lens = 2, []int{l1, l2}
	case 3:
		if len(rest) < 1 {
			return in, ErrR6 // N ≥ 2
		}
		fc := rest[0]
		vbr, pad, m := fc&0x80 != 0, fc&0x40 != 0, int(fc&0x3f)
		if m == 0 || m*in.FrameSmp > 5760 {
			return in, ErrR5
		}
		in.Frames = m
		rest = rest[1:]
		padTotal := 0 // dolgu uzunluk baytları + dolgu baytları
		if pad {
			for {
				if len(rest) < 1 {
					if vbr {
						return in, ErrR7
					}
					return in, ErrR6
				}
				v := int(rest[0])
				rest = rest[1:]
				padTotal++
				if v == 255 {
					padTotal += 254
					continue
				}
				padTotal += v
				break
			}
			in.Padding = padTotal
		}
		dataPad := padTotal - countPadHeader(p) // yalnız sondaki dolgu baytları
		if !vbr {
			// N-2-P ≥ 0 ve M'nin katı (P = dolgu başlık + dolgu)
			avail := len(p) - 2 - padTotal
			if avail < 0 || avail%m != 0 {
				return in, ErrR6
			}
			l := avail / m
			if l > maxFrameBytes {
				return in, ErrR2
			}
			for range m {
				in.Lens = append(in.Lens, l)
			}
		} else {
			sum := 0
			for range m - 1 {
				l, n, ok := frameLen(rest)
				if !ok {
					return in, ErrR7
				}
				rest = rest[n:]
				if l > maxFrameBytes {
					return in, ErrR2
				}
				in.Lens = append(in.Lens, l)
				sum += l
			}
			last := len(rest) - sum - dataPad
			if last < 0 {
				return in, ErrR7
			}
			if last > maxFrameBytes {
				return in, ErrR2
			}
			in.Lens = append(in.Lens, last)
		}
	}
	return in, nil
}

// countPadHeader kod 3 paketteki dolgu uzunluk baytı sayısı (geçerliliği Validate denetler).
func countPadHeader(p []byte) int {
	if len(p) < 2 || p[1]&0x40 == 0 {
		return 0
	}
	n := 0
	for i := 2; i < len(p); i++ {
		n++
		if p[i] != 255 {
			break
		}
	}
	return n
}
