package capture

// H.264 NAL birim türleri (ITU-T H.264 Tablo 7-1).
const (
	nalIDR = 5
	nalSPS = 7
	nalPPS = 8
)

// splitNALs Annex-B akışını başlangıç kodlarından (00 00 01 / 00 00 00 01) böler; dönen dilimler başlangıç kodu
// içermez ve girdiyle bellek paylaşır. Boş NAL'ler atlanır.
func splitNALs(b []byte) [][]byte {
	var out [][]byte
	start := -1
	i := 0
	for i+2 < len(b) {
		if b[i] == 0 && b[i+1] == 0 && b[i+2] == 1 {
			if start >= 0 {
				end := i
				for end > start && b[end-1] == 0 { // 4 baytlık kodun baştaki sıfırı ve sondaki sıfır dolgusu
					end--
				}
				if end > start {
					out = append(out, b[start:end])
				}
			}
			i += 3
			start = i
			continue
		}
		i++
	}
	if start >= 0 && start < len(b) {
		out = append(out, b[start:])
	}
	return out
}

// paramSets son görülen SPS/PPS'i tutar ve her IDR erişim biriminin önünde bulunmalarını sağlar (yeni katılan veya
// PLI gönderen alıcı yalnız IDR'den çözebilsin; MF kodlayıcı SPS/PPS'i yalnız ilk IDR'de veya medya türünde verebilir).
type paramSets struct {
	sps, pps []byte
}

// learn MF_MT_MPEG_SEQUENCE_HEADER gibi Annex-B blobundan SPS/PPS alır.
func (p *paramSets) learn(b []byte) {
	for _, n := range splitNALs(b) {
		p.keep(n)
	}
}

func (p *paramSets) keep(n []byte) {
	switch n[0] & 0x1f {
	case nalSPS:
		p.sps = append(p.sps[:0], n...)
	case nalPPS:
		p.pps = append(p.pps[:0], n...)
	}
}

// fix erişim birimini 4 baytlık başlangıç kodlarıyla yeniden yazar; IDR içerip SPS/PPS içermiyorsa önbellekteki
// SPS/PPS'i başa ekler. key: birim IDR içeriyor.
func (p *paramSets) fix(au []byte) (out []byte, key bool) {
	nals := splitNALs(au)
	var hasSPS, hasPPS bool
	for _, n := range nals {
		switch n[0] & 0x1f {
		case nalSPS:
			hasSPS = true
		case nalPPS:
			hasPPS = true
		case nalIDR:
			key = true
		}
		p.keep(n)
	}
	sc := []byte{0, 0, 0, 1}
	if key && !hasSPS && p.sps != nil {
		out = append(append(out, sc...), p.sps...)
	}
	if key && !hasPPS && p.pps != nil {
		out = append(append(out, sc...), p.pps...)
	}
	for _, n := range nals {
		out = append(append(out, sc...), n...)
	}
	return out, key
}
