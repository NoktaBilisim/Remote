package printing

import (
	"bytes"
	"errors"
	"testing"
)

func TestProtoInspectRoundTrip(t *testing.T) {
	var b bytes.Buffer
	if err := WriteRequest(&b, Request{Op: OpInspect, PDF: []byte("%PDF-1.4")}); err != nil {
		t.Fatal(err)
	}
	q, err := ReadRequest(&b)
	if err != nil || q.Op != OpInspect || string(q.PDF) != "%PDF-1.4" {
		t.Fatalf("istek = %+v, %v", q, err)
	}
	b.Reset()
	_ = WriteResponse(&b, Response{Status: StatusOK, A: 2})
	if n, err := readInspect(&b); n != 2 || err != nil {
		t.Fatalf("inspect = %d, %v", n, err)
	}
}

func TestProtoRejectsBadRequests(t *testing.T) {
	cases := map[string][]byte{}
	var b bytes.Buffer
	_ = writeFrame(&b, OpInspect, 0, 0, 0, nil) // boş PDF
	cases["boş PDF"] = append([]byte(nil), b.Bytes()...)
	b.Reset()
	_ = writeFrame(&b, OpRender, 0, 10, 10, []byte{1}) // render yük taşımaz
	cases["render yükü"] = append([]byte(nil), b.Bytes()...)
	b.Reset()
	_ = writeFrame(&b, OpRender, 0, 50_000, 50_000, nil) // > MaxPixels
	cases["dev hedef"] = append([]byte(nil), b.Bytes()...)
	b.Reset()
	_ = writeFrame(&b, 9, 0, 1, 1, nil)
	cases["bilinmeyen op"] = append([]byte(nil), b.Bytes()...)
	for name, raw := range cases {
		if _, err := ReadRequest(bytes.NewReader(raw)); !errors.Is(err, ErrProtocol) {
			t.Errorf("%s: hata = %v, ErrProtocol beklenir", name, err)
		}
	}
	// Beyan edilen PDF boyutu sınırı aşıyorsa yük okunmadan reddedilir.
	var h [headerLen]byte
	h[0] = OpInspect
	h[13], h[14], h[15], h[16] = 0x01, 0x00, 0x40, 0x01 // ≈ 20 MiB + 1
	if _, err := ReadRequest(bytes.NewReader(h[:])); !errors.Is(err, ErrProtocol) {
		t.Errorf("büyük PDF: %v", err)
	}
}

// r2 O-P28a-3: işleyici çıktısı güvenilmez; w/h/stride/uzunluk hedefle birebir olmalı, sayfa 1..100000.
func TestProtoRenderResponseValidated(t *testing.T) {
	const w, h = 5, 3
	good := make([]byte, Stride(w)*h)
	check := func(name string, st byte, a, b, c uint32, payload []byte, want error) {
		t.Helper()
		var buf bytes.Buffer
		_ = writeFrame(&buf, st, a, b, c, payload)
		bm, err := readRender(&buf, w, h)
		if !errors.Is(err, want) && !(want == nil && err == nil) {
			t.Errorf("%s: hata = %v, beklenen %v", name, err, want)
		}
		if want == nil && (bm == nil || bm.Stride != 16 || len(bm.Pix) != 48) {
			t.Errorf("%s: bitmap = %+v", name, bm)
		}
	}
	check("geçerli", StatusOK, w, h, Stride(w), good, nil)
	check("farklı genişlik", StatusOK, w+1, h, Stride(w+1), make([]byte, Stride(w+1)*h), ErrProtocol)
	check("yanlış stride", StatusOK, w, h, w*3, make([]byte, w*3*h), ErrProtocol)
	check("kısa yük", StatusOK, w, h, Stride(w), good[:10], ErrProtocol)
	check("hata durumu", StatusError, 0, 0, 0, nil, ErrWorker)
	check("hata + yük", StatusError, 0, 0, 0, []byte{1}, ErrProtocol)
	check("geçersiz PDF", StatusInvalidPDF, 0, 0, 0, nil, ErrInvalidPDF)

	for _, pages := range []uint32{0, MaxPages + 1} {
		var buf bytes.Buffer
		_ = writeFrame(&buf, StatusOK, pages, 0, 0, nil)
		if _, err := readInspect(&buf); !errors.Is(err, ErrInvalidPDF) {
			t.Errorf("sayfa %d: %v", pages, err)
		}
	}
}

func TestProtoFrameLimits(t *testing.T) {
	if n, ok := frameLen(1, 1); !ok || n != 4 {
		t.Errorf("1×1 = %d %v", n, ok)
	}
	if _, ok := frameLen(0, 10); ok {
		t.Error("sıfır genişlik kabul edildi")
	}
	if _, ok := frameLen(6000, 6000); ok { // 36 Mpx ama 108 MB > 64 MiB
		t.Error("64 MiB üstü kabul edildi")
	}
	if _, ok := frameLen(2480, 3508); !ok { // A4 @ 300 DPI
		t.Error("A4 300 DPI reddedildi")
	}
}
