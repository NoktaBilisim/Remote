package voice

import "errors"

// RFC 6716 §3.4 Opus paket geçerlilik kuralları R1–R7 (mimari-p33 §2 opuspkt.go, saf Go; fuzz her platformda koşar).
// Yalnız darwin arka ucu çağırır: Apple çözücüsüne giden paketin çerçevelemesi denetlenir (yük içeriği değil; birincil
// savunma çözücü yardımcısının sandbox'ıdır, §6.6). Hata iletileri yalnız kural numarası taşır (yük içeriği yok).

var (
	errOpusR1 = errors.New("opus R1: paket boş")
	errOpusR2 = errors.New("opus R2: çerçeve 1275 bayttan uzun")
	errOpusR3 = errors.New("opus R3: kod 1 paket uzunluğu tutarsız")
	errOpusR4 = errors.New("opus R4: kod 2 çerçeve uzunluğu geçersiz")
	errOpusR5 = errors.New("opus R5: kod 3 çerçeve sayısı 0 ya da toplam süre 120 ms'den uzun")
	errOpusR6 = errors.New("opus R6: kod 3 CBR uzunluk/dolgu tutarsız")
	errOpusR7 = errors.New("opus R7: kod 3 VBR başlık/uzunluk yetersiz")
)

// tocFrameSamples TOC yapılandırmasından (0..31) çerçeve süresi, 48 kHz örnek.
func tocFrameSamples(config byte) int {
	switch {
	case config < 12: // SILK 10/20/40/60 ms
		return [4]int{480, 960, 1920, 2880}[config&3]
	case config < 16: // Hibrit 10/20 ms
		return [2]int{480, 960}[config&1]
	default: // CELT 2,5/5/10/20 ms
		return [4]int{120, 240, 480, 960}[config&3]
	}
}

// frameLength RFC 6716 §3.2.1 çerçeve uzunluğu alanı (1 ya da 2 bayt): (uzunluk, tüketilen bayt, tamam).
func frameLength(b []byte) (int, int, bool) {
	switch {
	case len(b) < 1:
		return 0, 0, false
	case b[0] < 252:
		return int(b[0]), 1, true
	case len(b) < 2:
		return 0, 0, false
	}
	return int(b[1])*4 + int(b[0]), 2, true
}

// opusPacketSamples R1–R7'yi uygular; geçerli paketin toplam süresini (48 kHz örnek) döner.
func opusPacketSamples(p []byte) (int, error) {
	if len(p) < 1 {
		return 0, errOpusR1
	}
	toc := p[0]
	per := tocFrameSamples(toc >> 3)
	rest := p[1:]
	switch toc & 3 {
	case 0:
		if len(rest) > maxPacketSize {
			return 0, errOpusR2
		}
		return per, nil
	case 1:
		if len(rest)%2 != 0 {
			return 0, errOpusR3
		}
		if len(rest)/2 > maxPacketSize {
			return 0, errOpusR2
		}
		return 2 * per, nil
	case 2:
		l1, n, ok := frameLength(rest)
		if !ok || l1 > len(rest)-n {
			return 0, errOpusR4
		}
		if l1 > maxPacketSize || len(rest)-n-l1 > maxPacketSize {
			return 0, errOpusR2
		}
		return 2 * per, nil
	}
	return code3Samples(rest, per)
}

// code3Samples kod 3 paketin (TOC sonrası) çerçeve sayısı baytı, dolgusu ve çerçeve uzunlukları (R5–R7).
func code3Samples(rest []byte, per int) (int, error) {
	if len(rest) < 1 {
		return 0, errOpusR6 // kod 3 paket en az 2 bayt
	}
	fc := rest[0]
	vbr, padded, m := fc&0x80 != 0, fc&0x40 != 0, int(fc&0x3f)
	if m == 0 || m*per > maxFrame {
		return 0, errOpusR5
	}
	rest = rest[1:]
	padBytes := 0 // sondaki dolgu baytları (uzunluk baytları hariç)
	if padded {
		for {
			if len(rest) < 1 {
				if vbr {
					return 0, errOpusR7
				}
				return 0, errOpusR6
			}
			v := int(rest[0])
			rest = rest[1:]
			if v == 255 {
				padBytes += 254
				continue
			}
			padBytes += v
			break
		}
	}
	if !vbr {
		avail := len(rest) - padBytes
		if avail < 0 || avail%m != 0 {
			return 0, errOpusR6
		}
		if avail/m > maxPacketSize {
			return 0, errOpusR2
		}
		return m * per, nil
	}
	sum := 0
	for range m - 1 {
		l, n, ok := frameLength(rest)
		if !ok {
			return 0, errOpusR7
		}
		if l > maxPacketSize {
			return 0, errOpusR2
		}
		rest = rest[n:]
		sum += l
	}
	last := len(rest) - sum - padBytes
	if last < 0 {
		return 0, errOpusR7
	}
	if last > maxPacketSize {
		return 0, errOpusR2
	}
	return m * per, nil
}

// errOpusNot20ms R1–R7'den geçen ama toplam süresi 20 ms olmayan paket (V-P33-A1 / B1: Apple çözücüsü 960
// çerçeve/paket kipinde bunu hatasız 0 örnekle döndürür; paket çözücüye verilmeden düşer ve DecodeErr sayılır).
var errOpusNot20ms = errors.New("opus: paket süresi 20 ms değil")

// opus20ms darwin çözücüsüne gidecek paketin süzgeci: R1–R7 + toplam süre = 960 örnek.
func opus20ms(p []byte) error {
	n, err := opusPacketSamples(p)
	if err != nil {
		return err
	}
	if n != FrameSamples {
		return errOpusNot20ms
	}
	return nil
}
