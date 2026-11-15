package printing

import (
	"encoding/binary"
	"errors"
	"io"
)

// Boru protokolü (mimari-p28 §5.2): uzunluk önekli ikili, küçük endian. Üst süreç işleyici çıktısını güvenilmeyen
// girdi sayar (r2 O-P28a-3): render yanıtı hedef boyutla birebir, stride/uzunluk taşma denetimli doğrulanır.
//
//	istek : op u8 | idx u32 | w u32 | h u32 | n u32 | yük[n]   (inspect: yük = PDF; render: yük yok)
//	yanıt : st u8 | a u32   | b u32 | c u32 | n u32 | yük[n]   (inspect: a = sayfa; render: a,b,c = w,h,stride; yük = BGR)
const (
	OpInspect byte = 1
	OpRender  byte = 2

	StatusOK         byte = 0
	StatusInvalidPDF byte = 1 // parola korumalı / bozuk
	StatusError      byte = 2

	MaxPDFBytes   = 20 << 20 // §5.3 alınan bayt sınırı
	MaxFrameBytes = 64 << 20 // r2 (1) mutlak önek sınırı
	MaxPixels     = 40_000_000
	MaxPages      = 100_000
	headerLen     = 17
)

var (
	ErrProtocol   = errors.New("printing: geçersiz işleyici çerçevesi")
	ErrInvalidPDF = errors.New("printing: PDF açılamadı")
	ErrWorker     = errors.New("printing: işleyici hatası")
)

// Request üst süreçten işleyiciye.
type Request struct {
	Op        byte
	Idx, W, H uint32
	PDF       []byte
}

// Response işleyiciden üst sürece.
type Response struct {
	Status  byte
	A, B, C uint32
	Payload []byte
}

func writeFrame(w io.Writer, kind byte, a, b, c uint32, payload []byte) error {
	var h [headerLen]byte
	h[0] = kind
	binary.LittleEndian.PutUint32(h[1:], a)
	binary.LittleEndian.PutUint32(h[5:], b)
	binary.LittleEndian.PutUint32(h[9:], c)
	binary.LittleEndian.PutUint32(h[13:], uint32(len(payload)))
	if _, err := w.Write(h[:]); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

func readHeader(r io.Reader) (kind byte, a, b, c, n uint32, err error) {
	var h [headerLen]byte
	if _, err = io.ReadFull(r, h[:]); err != nil {
		return
	}
	le := binary.LittleEndian
	return h[0], le.Uint32(h[1:]), le.Uint32(h[5:]), le.Uint32(h[9:]), le.Uint32(h[13:]), nil
}

// WriteRequest isteği yazar.
func WriteRequest(w io.Writer, q Request) error { return writeFrame(w, q.Op, q.Idx, q.W, q.H, q.PDF) }

// ReadRequest işleyici tarafı: PDF yükü MaxPDFBytes'ı aşamaz, render yük taşımaz.
func ReadRequest(r io.Reader) (Request, error) {
	op, idx, w, h, n, err := readHeader(r)
	if err != nil {
		return Request{}, err
	}
	switch {
	case op == OpInspect && n > 0 && n <= MaxPDFBytes:
	case op == OpRender && n == 0 && validTarget(w, h):
	default:
		return Request{}, ErrProtocol
	}
	q := Request{Op: op, Idx: idx, W: w, H: h}
	if n > 0 {
		q.PDF = make([]byte, n)
		if _, err := io.ReadFull(r, q.PDF); err != nil {
			return Request{}, err
		}
	}
	return q, nil
}

// WriteResponse yanıtı yazar.
func WriteResponse(w io.Writer, s Response) error {
	return writeFrame(w, s.Status, s.A, s.B, s.C, s.Payload)
}

// readInspect inspect yanıtı: yük yok, sayfa 1..MaxPages.
func readInspect(r io.Reader) (int, error) {
	st, pages, _, _, n, err := readHeader(r)
	if err != nil {
		return 0, err
	}
	if n != 0 {
		return 0, ErrProtocol
	}
	if err := statusErr(st); err != nil {
		return 0, err
	}
	if pages < 1 || pages > MaxPages {
		return 0, ErrInvalidPDF
	}
	return int(pages), nil
}

// readRender render yanıtı: w,h istenenle aynı, stride == align4(w*3), n == stride*h ≤ MaxFrameBytes; aksi ErrProtocol
// (yük okunmaz, çağıran işleyiciyi öldürür).
func readRender(r io.Reader, wantW, wantH uint32) (*Bitmap, error) {
	st, w, h, stride, n, err := readHeader(r)
	if err != nil {
		return nil, err
	}
	if err := statusErr(st); err != nil {
		if n != 0 {
			return nil, ErrProtocol
		}
		return nil, err
	}
	want, ok := frameLen(wantW, wantH)
	if !ok || w != wantW || h != wantH || stride != Stride(w) || uint64(n) != want {
		return nil, ErrProtocol
	}
	px := make([]byte, n)
	if _, err := io.ReadFull(r, px); err != nil {
		return nil, err
	}
	return &Bitmap{W: int(w), H: int(h), Stride: int(stride), Pix: px}, nil
}

func statusErr(st byte) error {
	switch st {
	case StatusOK:
		return nil
	case StatusInvalidPDF:
		return ErrInvalidPDF
	case StatusError:
		return ErrWorker
	}
	return ErrProtocol
}

// Bitmap üstten aşağı 24 bit BGR, satırlar 4 bayta hizalı (DIB düzeni).
type Bitmap struct {
	W, H, Stride int
	Pix          []byte
}

// Stride 24 bit DIB satır uzunluğu.
func Stride(w uint32) uint32 { return (w*3 + 3) &^ 3 }

func validTarget(w, h uint32) bool {
	_, ok := frameLen(w, h)
	return ok
}

// frameLen stride*h; boyut 0, MaxPixels veya MaxFrameBytes aşımı geçersiz (uint64'te hesap: taşma yok).
func frameLen(w, h uint32) (uint64, bool) {
	if w == 0 || h == 0 || uint64(w)*uint64(h) > MaxPixels {
		return 0, false
	}
	n := (uint64(w)*3 + 3) &^ 3 * uint64(h)
	return n, n <= MaxFrameBytes
}
