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
	if !validFrame(dst, src, srcW, srcH, stride) {
		return errBadFrame
	}
	col, row := convTables(dst.W, dst.H, srcW, srcH, stride, rot)
	convertRegion(dst, src, col, row, Rect{0, 0, dst.W, dst.H})
	return nil
}

// ConvertBGRARegions yalnız verilen çıkış bölgelerini (NV12 koordinatı, kenarları çift) ConvertBGRA ile aynı eşlemeyle
// yeniden hesaplar; bölge dışı baytlar değişmez (AC-246). Bölgeler örtüşebilir (aynı değer yeniden yazılır).
func ConvertBGRARegions(dst *NV12, src []byte, srcW, srcH, stride int, rot Rotation, regions []Rect) error {
	if !validFrame(dst, src, srcW, srcH, stride) {
		return errBadFrame
	}
	for _, r := range regions {
		if r.X0 < 0 || r.Y0 < 0 || r.X1 > dst.W || r.Y1 > dst.H || r.X0%2 != 0 || r.Y0%2 != 0 || r.X1%2 != 0 || r.Y1%2 != 0 {
			return errBadFrame
		}
	}
	if len(regions) == 0 {
		return nil
	}
	col, row := convTables(dst.W, dst.H, srcW, srcH, stride, rot)
	for _, r := range regions {
		convertRegion(dst, src, col, row, r)
	}
	return nil
}

func validFrame(dst *NV12, src []byte, srcW, srcH, stride int) bool {
	W, H := dst.W, dst.H
	return W >= 2 && H >= 2 && W%2 == 0 && H%2 == 0 && len(dst.Data) >= W*H*3/2 &&
		srcW >= 1 && srcH >= 1 && stride >= srcW*4 && len(src) >= stride*(srcH-1)+srcW*4
}

// convTables çıkış sütunu/satırı → kaynak bayt ofseti bileşenleri (en yakın komşu + döndürme).
func convTables(W, H, srcW, srcH, stride int, rot Rotation) (col, row []int) {
	dw, dh := DesktopSize(srcW, srcH, rot)
	col = make([]int, W) // çıkış x → kaynak ofset bileşeni
	row = make([]int, H) // çıkış y → kaynak ofset bileşeni
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
	return col, row
}

// convertRegion rg'nin (kenarları çift, dst içinde) Y ve UV baytlarını yazar.
func convertRegion(dst *NV12, src []byte, col, row []int, rg Rect) {
	W, H := dst.W, dst.H
	yp, uv := dst.Data[:W*H], dst.Data[W*H:W*H*3/2]
	for y := rg.Y0; y < rg.Y1; y += 2 {
		r0, r1 := row[y], row[y+1]
		y0, y1 := yp[y*W:(y+1)*W], yp[(y+1)*W:(y+2)*W]
		c := uv[(y/2)*W : (y/2+1)*W]
		for x := rg.X0; x < rg.X1; x += 2 {
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
}

// Rect yarı açık dikdörtgen [X0, X1) × [Y0, Y1).
type Rect struct{ X0, Y0, X1, Y1 int }

func (r Rect) empty() bool { return r.X0 >= r.X1 || r.Y0 >= r.Y1 }

// Damage yeni karenin değişen bölgesi (AC-246): Rects yakalanan yüzeyin (döndürülmemiş) piksel koordinatında kirli
// dikdörtgenlerdir (GetFrameDirtyRects). Full: bölge bilinmiyor ya da tam dönüşüm gerekiyor (taşıma dikdörtgeni,
// meta veri alınamadı, ilk kare). Full=false ve Rects boş: görüntü değişmedi (yalnız imleç).
type Damage struct {
	Rects []Rect
	Full  bool
}

const (
	maxDirtyRects = 64 // üstünde tam dönüşüm (mimari §8.1 AC-246)
	dirtyAlign    = 16 // kirli bölge çıkışta 16 px'e genişletilir (makro blok; renk 2×2 bloğunu da kapsar)
)

// surfaceToDesktop yüzey dikdörtgenini (kırpılarak) döndürme sonrası masaüstü koordinatına çevirir (srcOffset'in tersi).
func surfaceToDesktop(r Rect, srcW, srcH int, rot Rotation) Rect {
	r = Rect{max(r.X0, 0), max(r.Y0, 0), min(r.X1, srcW), min(r.Y1, srcH)}
	if r.empty() {
		return Rect{}
	}
	switch rot {
	case Rot90: // sx = dy, sy = srcH-1-dx
		return Rect{srcH - r.Y1, r.X0, srcH - r.Y0, r.X1}
	case Rot180: // sx = srcW-1-dx, sy = srcH-1-dy
		return Rect{srcW - r.X1, srcH - r.Y1, srcW - r.X0, srcH - r.Y0}
	case Rot270: // sx = srcW-1-dy, sy = dx
		return Rect{r.Y0, srcW - r.X1, r.Y1, srcW - r.X0}
	}
	return r
}

// outRange örneklenen masaüstü koordinatı a·d/n ∈ [a0, a1) olan çıkış aralığı (n çıkış, d masaüstü boyutu), align'a
// (2'nin kuvveti) genişletilip n ile kırpılır.
func outRange(a0, a1, d, n, align int) (int, int) {
	return ceilDiv(a0*n, d) &^ (align - 1), min(n, (ceilDiv(a1*n, d)+align-1)&^(align-1))
}

// desktopRegion masaüstü dikdörtgeninin etkilediği çıkış bölgesi (dirtyAlign hizalı); boşsa ok=false.
func desktopRegion(r Rect, dw, dh, W, H int) (Rect, bool) {
	if r.empty() {
		return Rect{}, false
	}
	xs, xe := outRange(r.X0, r.X1, dw, W, dirtyAlign)
	ys, ye := outRange(r.Y0, r.Y1, dh, H, dirtyAlign)
	o := Rect{xs, ys, xe, ye}
	return o, !o.empty()
}

// frameConv sürekli NV12 tamponunu tutar (AC-246): önceki kare geçerliyse yalnız kirli bölgeler (ve önceki imlecin
// kapladığı bölge) yeniden dönüştürülür, sonra imleç bindirilir. Sonuç her zaman ConvertBGRA + OverlayCursor ile bayt
// bayt aynıdır (birim testi). Taşıma dikdörtgeni/bilinmeyen bölge (Damage.Full), > maxDirtyRects dikdörtgen, boyut ya
// da döndürme değişimi ve önceki dönüşümün yarım kalması tam dönüşüme düşer. Yalnız kaynağın iş parçacığında kullanılır.
type frameConv struct {
	frame      *NV12
	valid      bool // frame son yüzeyin tam dönüşümü + imleç
	srcW, srcH int
	rot        Rotation
	cursor     Rect // önceki imlecin masaüstü dikdörtgeni (boş: imleç çizilmedi)
	regions    []Rect
}

// invalidate sonraki dönüşümü tam yapar (kaynak yeniden açıldı: yüzey ile tampon arasındaki ilişki kayboldu).
func (c *frameConv) invalidate() { c.valid = false }

// convert yüzeyi c.frame'e çevirir; çıktı boyutu değiştiyse (yeni tampon) resized=true.
func (c *frameConv) convert(px []byte, w, h, pitch int, rot Rotation, cur *Cursor, dmg Damage) (resized bool, err error) {
	dw, dh := DesktopSize(w, h, rot)
	ow, oh := OutputSize(dw, dh)
	if c.frame == nil || c.frame.W != ow || c.frame.H != oh {
		c.frame, c.valid, resized = NewNV12(ow, oh), false, true
	}
	full := !c.valid || dmg.Full || len(dmg.Rects) > maxDirtyRects || w != c.srcW || h != c.srcH || rot != c.rot
	c.valid = false // hata/yarıda kalma → sonraki tam
	if full {
		err = ConvertBGRA(c.frame, px, w, h, pitch, rot)
	} else {
		c.regions = c.regions[:0]
		for _, r := range dmg.Rects {
			if o, ok := desktopRegion(surfaceToDesktop(r, w, h, rot), dw, dh, ow, oh); ok {
				c.regions = append(c.regions, o)
			}
		}
		if o, ok := desktopRegion(c.cursor, dw, dh, ow, oh); ok {
			c.regions = append(c.regions, o) // eski imleç izini sil
		}
		err = ConvertBGRARegions(c.frame, px, w, h, pitch, rot, c.regions)
	}
	if err == nil {
		err = OverlayCursor(c.frame, px, w, h, pitch, rot, cur)
	}
	if err != nil {
		return resized, err
	}
	c.valid, c.srcW, c.srcH, c.rot = true, w, h, rot
	c.cursor = cursorBounds(cur, dw, dh)
	return resized, nil
}
