package annot

import (
	"testing"

	"remote-support/agent-win/internal/dc"
)

// AC-494 (AC-37/56): işaretleme iletileri, geri alma, temizleme, sınır ve ok/dikdörtgen çizgileri (uicore'dan taşındı).
func TestAC494Annot(t *testing.T) {
	x, y := 0.5, 0.25
	var s []Stroke
	var l *[2]float64
	s, l, _ = Apply(s, l, dc.Ctl{T: "annot.stroke", ID: "a", Tool: "rect", Color: "blue", Pts: [][2]float64{{0, 0}, {1, 1}}})
	s, l, _ = Apply(s, l, dc.Ctl{T: "annot.stroke", ID: "b", Tool: "arrow", Color: "red", Pts: [][2]float64{{0, 0}, {1, 0}}})
	s, l, laser := Apply(s, l, dc.Ctl{T: "annot.laser", X: &x, Y: &y})
	if len(s) != 2 || !laser || l == nil || l[0] != 0.5 {
		t.Fatal("stroke/laser")
	}
	s, _, _ = Apply(s, l, dc.Ctl{T: "annot.undo", ID: "a"})
	if len(s) != 1 || s[0].ID != "b" {
		t.Fatal("undo")
	}
	if r := Polylines(Stroke{Tool: "rect", Pts: [][2]float64{{0, 0}, {1, 1}}}, 100, 50); len(r) != 1 || len(r[0]) != 5 || r[0][2] != [2]float64{100, 50} {
		t.Fatalf("rect %v", r)
	}
	if r := Polylines(s[0], 100, 100); len(r) != 3 {
		t.Fatalf("arrow %v", r)
	}
	for range MaxStrokes + 10 {
		s, _, _ = Apply(s, nil, dc.Ctl{T: "annot.stroke", Pts: [][2]float64{{0, 0}}})
	}
	if len(s) != MaxStrokes {
		t.Fatal("sınır")
	}
	if s, l, _ = Apply(s, l, dc.Ctl{T: "annot.clear"}); s != nil || l != nil {
		t.Fatal("clear")
	}
	if Color("mor") != Color("red") {
		t.Fatal("bilinmeyen renk")
	}
}

// AC-494: ID'siz geri alma son çizimi kaldırır; 501. çizimde en eski düşer; nil X/Y lazer ve boş çizim yok sayılır.
func TestAC494AnnotEdges(t *testing.T) {
	var s []Stroke
	for i := range MaxStrokes + 1 {
		s, _, _ = Apply(s, nil, dc.Ctl{T: "annot.stroke", ID: string(rune('a' + i%26)), Pts: [][2]float64{{float64(i), 0}}})
	}
	if len(s) != MaxStrokes || s[0].Pts[0][0] != 1 || s[len(s)-1].Pts[0][0] != MaxStrokes {
		t.Fatalf("en eski düşmedi: ilk %v son %v", s[0].Pts, s[len(s)-1].Pts)
	}
	s, _, _ = Apply(s, nil, dc.Ctl{T: "annot.undo"})
	if len(s) != MaxStrokes-1 || s[len(s)-1].Pts[0][0] != MaxStrokes-1 {
		t.Fatal("ID'siz geri alma son çizimi kaldırmadı")
	}
	x := 0.3
	prev := &[2]float64{0.1, 0.1}
	if _, l, set := Apply(nil, prev, dc.Ctl{T: "annot.laser", X: &x}); set || l != prev {
		t.Fatal("eksik Y'li lazer uygulandı")
	}
	if got, _, _ := Apply(nil, nil, dc.Ctl{T: "annot.stroke", ID: "x"}); len(got) != 0 {
		t.Fatal("noktasız çizim eklendi")
	}
	if got, _, _ := Apply([]Stroke{{ID: "a", Pts: [][2]float64{{0, 0}}}}, nil, dc.Ctl{T: "annot.undo", ID: "yok"}); len(got) != 1 {
		t.Fatal("bilinmeyen ID ile geri alma çizim sildi")
	}
	if Polylines(Stroke{Tool: "pen"}, 10, 10) != nil {
		t.Fatal("boş çizim çizgisi")
	}
	if c := Color("green"); c[1] != 197.0/255 {
		t.Fatalf("yeşil %v", c)
	}
}

// AC-494 / P30 güvenlik turu: toplam nokta bütçesi — aşılınca en eski çizimler düşer, son çizim kalır.
func TestAC494AnnotPointBudget(t *testing.T) {
	pts := make([][2]float64, 500)
	var s []Stroke
	for i := range 100 {
		s, _, _ = Apply(s, nil, dc.Ctl{T: "annot.stroke", ID: string(rune('A' + i%26)), Pts: pts})
	}
	total := 0
	for _, st := range s {
		total += len(st.Pts)
	}
	if total > MaxPoints || len(s) != MaxPoints/500 {
		t.Fatalf("toplam %d nokta, %d çizim", total, len(s))
	}
	s, _, _ = Apply(s, nil, dc.Ctl{T: "annot.stroke", ID: "son", Pts: [][2]float64{{0, 0}}})
	if s[len(s)-1].ID != "son" || len(s) != MaxPoints/500 {
		t.Fatalf("son çizim %q, %d çizim", s[len(s)-1].ID, len(s))
	}
}
