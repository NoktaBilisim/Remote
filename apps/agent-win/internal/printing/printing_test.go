package printing

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"testing"
)

func TestP28aServeRoundTrip(t *testing.T) {
	var in, out bytes.Buffer
	_ = WriteRequest(&in, Request{Op: OpInspect, PDF: []byte("%PDF-x")})
	_ = WriteRequest(&in, Request{Op: OpPageSize, Idx: 1})
	_ = WriteRequest(&in, Request{Op: OpRender, Idx: 1, W: 3, H: 2})
	_ = WriteRequest(&in, Request{Op: OpRender, Idx: 7, W: 3, H: 2}) // dizin dışı → hata yanıtı, süreç sürer
	doc := &memDoc{pages: 2}
	if code := serve(&in, &out, func(b []byte) (pageDoc, error) { return doc, nil }); code != WorkerExitOK {
		t.Fatalf("çıkış = %d", code)
	}
	if n, err := readInspect(&out); n != 2 || err != nil {
		t.Fatalf("inspect %d %v", n, err)
	}
	if w, h, err := readPageSize(&out); w != 800 || h != 600 || err != nil {
		t.Fatalf("size %d %d %v", w, h, err)
	}
	if bm, err := readRender(&out, 3, 2); err != nil || len(bm.Pix) != 24 {
		t.Fatalf("render %v", err)
	}
	if _, err := readRender(&out, 3, 2); !errors.Is(err, ErrWorker) {
		t.Fatalf("dizin dışı: %v", err)
	}
	if !doc.closed {
		t.Fatal("belge kapanmadı")
	}
}

func TestP28aServeInvalidPDFAndBadFrame(t *testing.T) {
	var in, out bytes.Buffer
	_ = WriteRequest(&in, Request{Op: OpInspect, PDF: []byte("x")})
	_ = WriteRequest(&in, Request{Op: OpRender, W: 2, H: 2}) // belge yok → hata
	_ = writeFrame(&in, 9, 0, 0, 0, nil)                     // bilinmeyen op → işleyici çıkar
	code := serve(&in, &out, func([]byte) (pageDoc, error) { return nil, ErrInvalidPDF })
	if code != WorkerExitIO {
		t.Fatalf("çıkış = %d", code)
	}
	if _, err := readInspect(&out); !errors.Is(err, ErrInvalidPDF) {
		t.Fatal(err)
	}
	if _, err := readRender(&out, 2, 2); !errors.Is(err, ErrWorker) {
		t.Fatal(err)
	}
}

type memDoc struct {
	pages  uint32
	closed bool
}

func (d *memDoc) pageCount() uint32 { return d.pages }
func (d *memDoc) pageSize(idx uint32) (uint32, uint32, error) {
	if idx >= d.pages {
		return 0, 0, ErrProtocol
	}
	if idx == 1 {
		return 800, 600, nil
	}
	return 600, 800, nil
}
func (d *memDoc) render(idx, w, h uint32) (*Bitmap, error) {
	n, ok := frameLen(w, h)
	if !ok || idx >= d.pages {
		return nil, ErrProtocol
	}
	return &Bitmap{W: int(w), H: int(h), Stride: int(Stride(w)), Pix: make([]byte, n)}, nil
}
func (d *memDoc) close() { d.closed = true }

// sahte kaynak/hedef: sayfa yönü en/boy oranından, hedef yönlenmiş alandan; bitmap basıldıktan sonra sıfırlanır.
type fakeSrc struct{ sizes [][2]uint32 }

func (s fakeSrc) PageSize(_ context.Context, i uint32) (uint32, uint32, error) {
	return s.sizes[i][0], s.sizes[i][1], nil
}
func (s fakeSrc) Render(_ context.Context, _, w, h uint32) (*Bitmap, error) {
	n, _ := frameLen(w, h)
	px := bytes.Repeat([]byte{7}, int(n))
	return &Bitmap{W: int(w), H: int(h), Stride: int(Stride(w)), Pix: px}, nil
}

type fakeSink struct {
	landscape []bool
	cur       bool
	pages     []*Bitmap
	snap      [][2]int
}

func (k *fakeSink) Orient(l bool) { k.cur = l; k.landscape = append(k.landscape, l) }
func (k *fakeSink) Target() (uint32, uint32, bool) {
	if k.cur {
		return 300, 200, true
	}
	return 200, 300, true
}
func (k *fakeSink) Page(bm *Bitmap) error {
	k.pages = append(k.pages, bm)
	k.snap = append(k.snap, [2]int{bm.W, int(bm.Pix[0])})
	return nil
}

func TestP28aPrintPagesOrientationAndWipe(t *testing.T) {
	src := fakeSrc{sizes: [][2]uint32{{600, 800}, {800, 600}}}
	sink := &fakeSink{}
	if err := printPages(context.Background(), src, sink, 2); err != nil {
		t.Fatal(err)
	}
	if len(sink.landscape) != 2 || sink.landscape[0] || !sink.landscape[1] {
		t.Fatalf("yön = %v", sink.landscape)
	}
	if sink.snap[0] != [2]int{200, 7} || sink.snap[1] != [2]int{300, 7} {
		t.Fatalf("hedef = %v", sink.snap)
	}
	for _, bm := range sink.pages {
		if bytes.ContainsFunc(bm.Pix, func(r rune) bool { return r != 0 }) {
			t.Fatal("bitmap sıfırlanmadı")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := printPages(ctx, src, &fakeSink{}, 2); !errors.Is(err, ErrCancelled) {
		t.Fatalf("iptal: %v", err)
	}
}

func TestP28aTargetSize(t *testing.T) {
	if w, h, ok := targetSize(4960, 7016, 600); !ok || w != 2480 || h != 3508 { // A4 600 DPI → 300
		t.Errorf("A4 600 DPI = %d×%d %v", w, h, ok)
	}
	if w, h, ok := targetSize(2400, 3300, 300); !ok || w != 2400 || h != 3300 {
		t.Errorf("300 DPI = %d×%d", w, h)
	}
	w, h, ok := targetSize(36000, 24000, 300) // çizici: 864 Mpx → ≤ 40 Mpx, oran korunur
	if !ok || uint64(w)*uint64(h) > MaxPixels || w < h {
		t.Errorf("dev alan = %d×%d %v", w, h, ok)
	}
	if r := float64(w) / float64(h); r < 1.49 || r > 1.51 {
		t.Errorf("oran %f", r)
	}
	if _, _, ok := targetSize(0, 10, 300); ok {
		t.Error("sıfır alan kabul edildi")
	}
}

func TestP28aComposeFastPaths(t *testing.T) {
	nrgba := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	nrgba.SetNRGBA(0, 0, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
	nrgba.SetNRGBA(1, 0, color.NRGBA{R: 0, G: 0, B: 0, A: 0}) // saydam → beyaz
	rgba := image.NewRGBA(image.Rect(0, 0, 2, 1))
	rgba.SetRGBA(0, 0, color.RGBA{R: 10, G: 20, B: 30, A: 255})
	gray := image.NewGray(image.Rect(0, 0, 2, 1))
	gray.SetGray(0, 0, color.Gray{Y: 10})
	gray.SetGray(1, 0, color.Gray{Y: 255})
	for name, img := range map[string]image.Image{"nrgba": nrgba, "rgba": rgba, "genel": gray} {
		bm := &Bitmap{W: 4, H: 1, Stride: int(Stride(4)), Pix: make([]byte, Stride(4))}
		compose(bm, img)
		px := bm.Pix[3:9] // ortalanmış: x=1..2
		if name != "genel" && (px[0] != 30 || px[1] != 20 || px[2] != 10) {
			t.Errorf("%s: piksel = %v", name, px[:3])
		}
		if name == "nrgba" && (px[3] != 255 || px[4] != 255 || px[5] != 255) {
			t.Errorf("saydam beyaz değil: %v", px[3:])
		}
		if bm.Pix[0] != 255 || bm.Pix[9] != 255 {
			t.Errorf("%s: kenar beyaz değil", name)
		}
	}
}
