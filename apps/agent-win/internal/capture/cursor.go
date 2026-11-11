package capture

// DXGI Desktop Duplication karesi fare imlecini içermez; imleç konumu (DXGI_OUTDUPL_FRAME_INFO.PointerPosition) ve
// şekli (GetFramePointerShape) ayrıca gelir. Bu dosya platformdan bağımsızdır: şekil, masaüstü yönündeki (döndürülmüş)
// fiziksel piksel koordinatlarında yorumlanır ve yalnız imlecin kapladığı NV12 blokları yeniden hesaplanır. Bindirme,
// yakalanan BGRA'ya yazmadan (eşlenmiş staging yüzeyi salt okunur) yapılır; sonuç, imlecin önce BGRA'ya çizilip
// ConvertBGRA'dan geçirilmesiyle bayt bayt aynıdır (birim testi).

// DXGI_OUTDUPL_POINTER_SHAPE_TYPE değerleri.
const (
	PointerMono        = 1 // 1 bpp: üstte AND, altta XOR maskesi (Height iki maskenin toplamı)
	PointerColor       = 2 // 32 bpp BGRA, düz (önçarpımsız) alfa ile karıştırılır
	PointerMaskedColor = 4 // 32 bpp; alfa 0 → renk kopyalanır, alfa ≠ 0 → renk masaüstüyle XOR'lanır
)

// PointerShape GetFramePointerShape çıktısı. Mono için H, AND + XOR maskelerinin toplam satır sayısıdır. Sıcak nokta
// tutulmaz: DXGI konumu zaten şeklin sol üst köşesidir.
type PointerShape struct {
	Type  uint32
	W, H  int
	Pitch int
	Data  []byte
}

// Cursor çıktıya göre imleç durumu. X, Y şeklin sol üst köşesi (çıktının sol üstüne göre, masaüstü yönünde, fiziksel
// piksel). Per-Monitor V2 DPI farkındalığında hem konum hem şekil fiziksel ölçektedir; sistem imleci DPI'ya göre
// büyütülmüş verir, ek ölçek gerekmez. Kodlayıcı sınırına küçültme, karenin geri kalanıyla aynı eşlemeyle yapılır.
type Cursor struct {
	Visible bool
	X, Y    int
	Shape   PointerShape
}

// Size şeklin görünür boyutu; şekil geçersizse (bilinmeyen tür, kısa tampon, yetersiz satır adımı) ok=false.
func (s *PointerShape) Size() (w, h int, ok bool) {
	if s.W < 1 || s.H < 1 || s.Pitch < 1 || len(s.Data) < s.Pitch*s.H {
		return 0, 0, false
	}
	switch s.Type {
	case PointerMono:
		if s.H%2 != 0 || s.Pitch < (s.W+7)/8 {
			return 0, 0, false
		}
		return s.W, s.H / 2, true
	case PointerColor, PointerMaskedColor:
		if s.Pitch < s.W*4 {
			return 0, 0, false
		}
		return s.W, s.H, true
	}
	return 0, 0, false
}

// BlendPointer pw×ph boyutlu sıkı BGRA yamasına (masaüstü pikselleri) şekli çizer. Yamanın (0,0) pikseli şeklin
// (sx0, sy0) pikseline karşılık gelir; şekil dışına düşen yama pikselleri değişmez. Alfa baytı dokunulmaz.
func BlendPointer(patch []byte, pw, ph, sx0, sy0 int, s *PointerShape) {
	sw, sh, ok := s.Size()
	if !ok || pw < 1 || ph < 1 || len(patch) < pw*ph*4 {
		return
	}
	for py := 0; py < ph; py++ {
		sy := sy0 + py
		if sy < 0 || sy >= sh {
			continue
		}
		for px := 0; px < pw; px++ {
			sx := sx0 + px
			if sx < 0 || sx >= sw {
				continue
			}
			d := patch[(py*pw+px)*4 : (py*pw+px)*4+3]
			switch s.Type {
			case PointerMono:
				bit := byte(0x80) >> (sx % 8)
				and := s.Data[sy*s.Pitch+sx/8]&bit != 0
				xor := s.Data[(sy+sh)*s.Pitch+sx/8]&bit != 0
				for i := range d {
					if !and {
						d[i] = 0
					}
					if xor {
						d[i] ^= 0xFF
					}
				}
			case PointerColor:
				c := s.Data[sy*s.Pitch+sx*4 : sy*s.Pitch+sx*4+4]
				a := int(c[3])
				for i := range d {
					d[i] = byte((int(c[i])*a + int(d[i])*(255-a) + 127) / 255)
				}
			case PointerMaskedColor:
				c := s.Data[sy*s.Pitch+sx*4 : sy*s.Pitch+sx*4+4]
				for i := range d {
					if c[3] == 0 {
						d[i] = c[i]
					} else {
						d[i] ^= c[i]
					}
				}
			}
		}
	}
}

// srcOffset masaüstü koordinatındaki (dx, dy) pikselin döndürülmemiş yüzeydeki bayt ofseti (ConvertBGRA'daki
// satır/sütun tablolarıyla aynı eşleme).
func srcOffset(dx, dy, srcW, srcH, stride int, rot Rotation) int {
	switch rot {
	case Rot90:
		return (srcH-1-dx)*stride + dy*4
	case Rot180:
		return (srcW-1-dx)*4 + (srcH-1-dy)*stride
	case Rot270:
		return dx*stride + (srcW-1-dy)*4
	}
	return dx*4 + dy*stride
}

// ceilDiv a ≥ 0, b > 0 için ⌈a/b⌉.
func ceilDiv(a, b int) int { return (a + b - 1) / b }

// OverlayCursor ConvertBGRA ile doldurulmuş dst üzerine imleci bindirir: imleç görünmüyorsa, şekli geçersizse veya
// tamamen çıktının dışındaysa dst değişmez. Masaüstü kenarında şekil kırpılır. src, ConvertBGRA'ya verilenle aynı
// (salt okunur) yüzeydir.
func OverlayCursor(dst *NV12, src []byte, srcW, srcH, stride int, rot Rotation, c *Cursor) error {
	W, H := dst.W, dst.H
	if W < 2 || H < 2 || W%2 != 0 || H%2 != 0 || len(dst.Data) < W*H*3/2 ||
		srcW < 1 || srcH < 1 || stride < srcW*4 || len(src) < stride*(srcH-1)+srcW*4 {
		return errBadFrame
	}
	if c == nil || !c.Visible {
		return nil
	}
	sw, sh, ok := c.Shape.Size()
	if !ok {
		return nil
	}
	dw, dh := DesktopSize(srcW, srcH, rot)
	x0, y0 := max(c.X, 0), max(c.Y, 0)
	x1, y1 := min(c.X+sw, dw), min(c.Y+sh, dh)
	if x0 >= x1 || y0 >= y1 {
		return nil
	}
	pw, ph := x1-x0, y1-y0
	patch := make([]byte, pw*ph*4)
	for py := 0; py < ph; py++ {
		for px := 0; px < pw; px++ {
			o := srcOffset(x0+px, y0+py, srcW, srcH, stride, rot)
			copy(patch[(py*pw+px)*4:(py*pw+px)*4+4], src[o:o+4])
		}
	}
	BlendPointer(patch, pw, ph, x0-c.X, y0-c.Y, &c.Shape)

	// Örneklenen masaüstü koordinatı x*dw/W ∈ [x0, x1) olan çıkış sütunları; NV12 renk örneği 2×2 olduğundan çifte
	// genişletilir.
	xs, xe := ceilDiv(x0*W, dw)&^1, min(W, (ceilDiv(x1*W, dw)+1)&^1)
	ys, ye := ceilDiv(y0*H, dh)&^1, min(H, (ceilDiv(y1*H, dh)+1)&^1)
	if xs >= xe || ys >= ye {
		return nil // imleç küçültmede örnekler arasına düştü
	}
	pixel := func(x, y int) (r, g, b int) {
		dx, dy := x*dw/W, y*dh/H
		var p []byte
		if dx >= x0 && dx < x1 && dy >= y0 && dy < y1 {
			p = patch[((dy-y0)*pw+dx-x0)*4:]
		} else {
			p = src[srcOffset(dx, dy, srcW, srcH, stride, rot):]
		}
		return int(p[2]), int(p[1]), int(p[0])
	}
	yp, uv := dst.Data[:W*H], dst.Data[W*H:W*H*3/2]
	for y := ys; y < ye; y += 2 {
		for x := xs; x < xe; x += 2 {
			var sr, sg, sb int
			for _, q := range [4][2]int{{x, y}, {x + 1, y}, {x, y + 1}, {x + 1, y + 1}} {
				r, g, b := pixel(q[0], q[1])
				sr, sg, sb = sr+r, sg+g, sb+b
				yp[q[1]*W+q[0]] = byte(((66*r + 129*g + 25*b + 128) >> 8) + 16)
			}
			sr, sg, sb = (sr+2)>>2, (sg+2)>>2, (sb+2)>>2
			cuv := uv[(y/2)*W:]
			cuv[x] = byte(((-38*sr - 74*sg + 112*sb + 128) >> 8) + 128)
			cuv[x+1] = byte(((112*sr - 94*sg - 18*sb + 128) >> 8) + 128)
		}
	}
	return nil
}
