package control

// Point / Rect fiziksel ekran koordinatları (Win32 POINT/RECT eşi; sağ/alt hariç).
type Point struct{ X, Y int32 }

type Rect struct{ Left, Top, Right, Bottom int32 }

// Contains nokta dikdörtgende mi.
func (r Rect) Contains(p Point) bool {
	return p.X >= r.Left && p.X < r.Right && p.Y >= r.Top && p.Y < r.Bottom
}

// PlaceAway G-03: w×h diyaloğun sol-üst köşesi; diyalog imleci içermez. Sıra: orta, üst-orta, alt-orta, sol-orta,
// sağ-orta. Hiçbiri olmazsa (çalışma alanından büyük diyalog) imlecin altına/üstüne kaydırılır.
func PlaceAway(cursor Point, work Rect, w, h, pad int32) (int32, int32) {
	cx := (work.Left + work.Right - w) / 2
	cy := (work.Top + work.Bottom - h) / 2
	cands := [][2]int32{{cx, cy}, {cx, work.Top + pad}, {cx, work.Bottom - h - pad},
		{work.Left + pad, cy}, {work.Right - w - pad, cy}}
	for _, c := range cands {
		if !(Rect{c[0], c[1], c[0] + w, c[1] + h}).Contains(cursor) {
			return c[0], c[1]
		}
	}
	if cursor.Y-work.Top > work.Bottom-cursor.Y {
		return cx, cursor.Y - h - pad
	}
	return cx, cursor.Y + pad
}
