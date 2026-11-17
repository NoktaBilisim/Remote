package capture

import (
	"encoding/binary"
	"errors"
	"math/bits"
)

// P28f K2 (mimari-p28f §2, ADR-0037 m.2): macOS yakalama hattının platformdan bağımsız parçaları. Etiketsizdir ki
// Linux/Windows'ta da derlenip test edilsin (C belleğine dokunmaz; darwin dosyaları C düzlemlerini önce denetimli
// dilime çevirir).

// maxPlaneBytes tek düzlemin kabul edilen en büyük boyutu (FFI kuralı 4: 16K × 16K tavanının da üstü; daha büyüğü
// bozuk bytesPerRow/yükseklik sayılır).
const maxPlaneBytes = 1 << 30

var (
	errPlaneSize = errors.New("capture: düzlem boyutu geçersiz")
	errAVCC      = errors.New("capture: AVCC erişim birimi bozuk")
)

// planeBytes bytesPerRow × rows çarpımı (FFI kuralı 4): taşma ya da maxPlaneBytes aşımında ok=false.
func planeBytes(bytesPerRow, rows uint64) (int, bool) {
	hi, lo := bits.Mul64(bytesPerRow, rows)
	if hi != 0 || lo > maxPlaneBytes || bytesPerRow == 0 || rows == 0 {
		return 0, false
	}
	return int(lo), true
}

// copyPlane rows satırın her birinden rowBytes baytı src'den (adım srcStride) dst'ye (adım dstStride) kopyalar. Adım
// satırdan kısa ya da dilimler son satıra yetmiyorsa hiçbir şey kopyalanmaz.
func copyPlane(dst []byte, dstStride int, src []byte, srcStride, rowBytes, rows int) error {
	if rowBytes <= 0 || rows <= 0 || dstStride < rowBytes || srcStride < rowBytes {
		return errPlaneSize
	}
	if need(dstStride, rowBytes, rows) > len(dst) || need(srcStride, rowBytes, rows) > len(src) {
		return errPlaneSize
	}
	if dstStride == rowBytes && srcStride == rowBytes {
		copy(dst[:rowBytes*rows], src[:rowBytes*rows])
		return nil
	}
	for r := range rows {
		copy(dst[r*dstStride:r*dstStride+rowBytes], src[r*srcStride:r*srcStride+rowBytes])
	}
	return nil
}

// need adımlı rows satırın son baytına kadar gereken uzunluk (son satırın dolgusu gerekmez).
func need(stride, rowBytes, rows int) int { return stride*(rows-1) + rowBytes }

// avccToAnnexB VideoToolbox'un AVCC çıktısını (her NAL önünde nalLen baytlık büyük-endian uzunluk) Annex-B'ye
// (00 00 00 01) çevirir; key ise SPS/PPS (params) başa eklenir (yeni katılan teknisyen ve PLI yalnız IDR'den çözer).
// Uzunluk alanı tampon dışına taşarsa ya da sıfırsa hata (sınır denetimli; kısmi çıktı dönmez).
func avccToAnnexB(avcc []byte, nalLen int, params [][]byte, key bool) ([]byte, error) {
	if nalLen != 1 && nalLen != 2 && nalLen != 4 {
		return nil, errAVCC
	}
	sc := []byte{0, 0, 0, 1}
	out := make([]byte, 0, len(avcc)+64)
	if key {
		for _, p := range params {
			if len(p) > 0 {
				out = append(append(out, sc...), p...)
			}
		}
	}
	nals := 0
	for off := 0; off < len(avcc); {
		if len(avcc)-off < nalLen {
			return nil, errAVCC
		}
		var n uint64
		switch nalLen {
		case 1:
			n = uint64(avcc[off])
		case 2:
			n = uint64(binary.BigEndian.Uint16(avcc[off:]))
		default:
			n = uint64(binary.BigEndian.Uint32(avcc[off:]))
		}
		off += nalLen
		if n == 0 || n > uint64(len(avcc)-off) {
			return nil, errAVCC
		}
		out = append(append(out, sc...), avcc[off:off+int(n)]...)
		off += int(n)
		nals++
	}
	if nals == 0 {
		return nil, errAVCC
	}
	return out, nil
}

// maxMonitors share.state'te bildirilen en çok monitör (Windows ve macOS).
const maxMonitors = 16

// display macOS ekran listesinin bir öğesi (CGGetActiveDisplayList).
type display struct {
	id     uint32 // CGDirectDisplayID
	mirror bool   // başka ekranın yansısı (ayrı monitör sayılmaz)
}

// orderDisplays monitör kimliği kuralı (AC-106, K3/K4 aynı eşlemeyi kullanır): yansı ekranlar atlanır, ana ekran 1
// numaradır, diğerleri CoreGraphics'in verdiği sırayla 2, 3, … olur; en çok maxMonitors.
func orderDisplays(list []display, main uint32) []uint32 {
	out := make([]uint32, 0, len(list))
	for _, d := range list {
		if d.id == main && !d.mirror {
			out = append(out, d.id)
		}
	}
	for _, d := range list {
		if d.id != main && !d.mirror && len(out) < maxMonitors {
			out = append(out, d.id)
		}
	}
	return out
}

// ptsClock VideoToolbox sunum zamanı (mikrosaniye): kareler seyrek gelir (yalnız değişen kare), bu yüzden kare
// indeksi değil gerçek geçen süre kullanılır; değer kesin artandır.
type ptsClock struct {
	last int64
	set  bool
}

// next geçen süreden (µs) kesin artan PTS.
func (c *ptsClock) next(elapsedMicros int64) int64 {
	if c.set && elapsedMicros <= c.last {
		elapsedMicros = c.last + 1
	}
	c.last, c.set = elapsedMicros, true
	return elapsedMicros
}
