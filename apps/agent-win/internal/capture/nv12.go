package capture

import "errors"

// Rotation DXGI_MODE_ROTATION karşılığı: yakalanan yüzey ekranın fiziksel (döndürülmemiş) yönündedir; masaüstü
// görüntüsü için yüzey bu kadar saat yönünde döndürülür (Microsoft DesktopDuplication örneğindeki doku eşlemesi).
type Rotation int

const (
	RotNone Rotation = iota
	Rot90
	Rot180
	Rot270
)

// Kodlanan görüntünün üst sınırı (AC-41: 1080p'de ≥ 15 fps). Daha büyük masaüstleri en-boy korunarak küçültülür.
const (
	maxLongSide  = 1920
	maxShortSide = 1080
)

// NV12 Y düzlemi (W×H) ve ardından aralıklı UV düzlemi (W×H/2); satır adımı W'dir.
type NV12 struct {
	W, H int
	Data []byte
}

// NewNV12 çift boyutlu boş kare.
func NewNV12(w, h int) *NV12 { return &NV12{W: w, H: h, Data: make([]byte, w*h*3/2)} }

// DesktopSize yüzey boyutundan döndürme sonrası masaüstü boyutu.
func DesktopSize(srcW, srcH int, rot Rotation) (int, int) {
	if rot == Rot90 || rot == Rot270 {
		return srcH, srcW
	}
	return srcW, srcH
}

// OutputSize masaüstü boyutunu kodlayıcı sınırına (1920×1080, iki yönde) sığdırır; en-boy korunur, boyutlar çifttir.
func OutputSize(w, h int) (int, int) {
	long, short := w, h
	if h > w {
		long, short = h, w
	}
	num, den := 1, 1 // ölçek = num/den ≤ 1 (kayan nokta yuvarlamasından kaçınmak için tamsayı)
	if long > maxLongSide {
		num, den = maxLongSide, long
	}
	if short*num > maxShortSide*den {
		num, den = maxShortSide, short
	}
	ow, oh := (w*num/den)&^1, (h*num/den)&^1
	if ow < 2 {
		ow = 2
	}
	if oh < 2 {
		oh = 2
	}
	return ow, oh
}

var errBadFrame = errors.New("capture: geçersiz kare boyutu")

// ConvertBGRA BGRA yüzeyi (srcW×srcH, satır adımı stride bayt) döndürüp en yakın komşu ile dst boyutuna ölçekler ve
// BT.601 sınırlı aralık NV12'ye çevirir (renk 2×2 blok ortalaması). Ofsetler satır/sütun tablolarından gelir; döndürme
// ve ölçek iç döngüye ek maliyet getirmez.
func ConvertBGRA(dst *NV12, src []byte, srcW, srcH, stride int, rot Rotation) error {
	W, H := dst.W, dst.H
	if W < 2 || H < 2 || W%2 != 0 || H%2 != 0 || len(dst.Data) < W*H*3/2 ||
		srcW < 1 || srcH < 1 || stride < srcW*4 || len(src) < stride*(srcH-1)+srcW*4 {
		return errBadFrame
	}
	dw, dh := DesktopSize(srcW, srcH, rot)
	col := make([]int, W) // çıkış x → kaynak ofset bileşeni
	row := make([]int, H) // çıkış y → kaynak ofset bileşeni
	for x := range col {
		dx := x * dw / W
		switch rot {
		case Rot90:
			col[x] = (srcH - 1 - dx) * stride
		case Rot180:
			col[x] = (srcW - 1 - dx) * 4
		case Rot270:
			col[x] = dx * stride
		default:
			col[x] = dx * 4
		}
	}
	for y := range row {
		dy := y * dh / H
		switch rot {
		case Rot90:
			row[y] = dy * 4
		case Rot180:
			row[y] = (srcH - 1 - dy) * stride
		case Rot270:
			row[y] = (srcW - 1 - dy) * 4
		default:
			row[y] = dy * stride
		}
	}
	yp, uv := dst.Data[:W*H], dst.Data[W*H:W*H*3/2]
	for y := 0; y < H; y += 2 {
		r0, r1 := row[y], row[y+1]
		y0, y1 := yp[y*W:(y+1)*W], yp[(y+1)*W:(y+2)*W]
		c := uv[(y/2)*W : (y/2+1)*W]
		for x := 0; x < W; x += 2 {
			c0, c1 := col[x], col[x+1]
			var sr, sg, sb int
			for i, off := range [4]int{r0 + c0, r0 + c1, r1 + c0, r1 + c1} {
				b, g, r := int(src[off]), int(src[off+1]), int(src[off+2])
				sr, sg, sb = sr+r, sg+g, sb+b
				l := byte(((66*r + 129*g + 25*b + 128) >> 8) + 16)
				switch i {
				case 0:
					y0[x] = l
				case 1:
					y0[x+1] = l
				case 2:
					y1[x] = l
				default:
					y1[x+1] = l
				}
			}
			sr, sg, sb = (sr+2)>>2, (sg+2)>>2, (sb+2)>>2
			c[x] = byte(((-38*sr - 74*sg + 112*sb + 128) >> 8) + 128)
			c[x+1] = byte(((112*sr - 94*sg - 18*sb + 128) >> 8) + 128)
		}
	}
	return nil
}
