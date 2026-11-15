//go:build windows

package printing

import (
	"encoding/binary"
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// GDI ile yazıcıya basma (mimari-p28 §5.3): üst süreçte çalışır. Varsayılan DEVMODE üzerine dmCopies=1, spool belge
// adı sabit (dosya adı kuyruğa düşmez), sayfa yazdırılabilir alana oran korunarak işleyicide sığdırılmış bitmap'tir;
// burada yalnız 1:1 StretchDIBits. K0 taslağı: sayfa yönü (ResetDCW) K4'te.

// DocName spool kuyruğunda görünen tek ad.
const DocName = "NoktaDestek uzaktan yazdırma"

const (
	maxPrintDPI = 300

	horzRes    = 8  // GetDeviceCaps HORZRES
	vertRes    = 10 // VERTRES
	logPixelsX = 88 // LOGPIXELSX

	dmOutBuffer = 2
	dmInBuffer  = 8
	dmCopies    = 0x100
	idOK        = 1

	// DEVMODEW yerleşimi: dmDeviceName[32]WCHAR (64) | dmSpecVersion | dmDriverVersion | dmSize | dmDriverExtra |
	// dmFields u32 @72 | yazıcı birliği: dmOrientation @76 … dmCopies @86.
	devmodeFieldsOff = 72
	devmodeCopiesOff = 86
	devmodeMinLen    = 88

	srcCopy     = 0x00CC0020
	dibRGBColor = 0
)

var (
	ErrNoPrinter = errors.New("printing: varsayılan yazıcı yok")
	ErrPrint     = errors.New("printing: yazdırma başarısız")
)

var (
	modWinspool = windows.NewLazySystemDLL("winspool.drv")
	modGDI32    = windows.NewLazySystemDLL("gdi32.dll")

	pGetDefaultPrinterW  = modWinspool.NewProc("GetDefaultPrinterW")
	pOpenPrinterW        = modWinspool.NewProc("OpenPrinterW")
	pClosePrinter        = modWinspool.NewProc("ClosePrinter")
	pDocumentPropertiesW = modWinspool.NewProc("DocumentPropertiesW")
	pCreateDCW           = modGDI32.NewProc("CreateDCW")
	pDeleteDC            = modGDI32.NewProc("DeleteDC")
	pGetDeviceCaps       = modGDI32.NewProc("GetDeviceCaps")
	pStartDocW           = modGDI32.NewProc("StartDocW")
	pStartPage           = modGDI32.NewProc("StartPage")
	pEndPage             = modGDI32.NewProc("EndPage")
	pEndDoc              = modGDI32.NewProc("EndDoc")
	pAbortDoc            = modGDI32.NewProc("AbortDoc")
	pStretchDIBits       = modGDI32.NewProc("StretchDIBits")
)

type docInfo struct {
	size     int32
	docName  *uint16
	output   *uint16
	datatype *uint16
	fwType   uint32
}

type bitmapInfoHeader struct {
	size          uint32
	width, height int32
	planes, bits  uint16
	compression   uint32
	sizeImage     uint32
	xppm, yppm    int32
	clrUsed       uint32
	clrImportant  uint32
}

// DefaultPrinter varsayılan yazıcının adı; yoksa ErrNoPrinter (diyalog açılmaz).
func DefaultPrinter() (string, error) {
	var n uint32
	_, _, _ = pGetDefaultPrinterW.Call(0, uintptr(unsafe.Pointer(&n)))
	if n == 0 || n > 4096 {
		return "", ErrNoPrinter
	}
	buf := make([]uint16, n)
	if r, _, _ := pGetDefaultPrinterW.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); r == 0 {
		return "", ErrNoPrinter
	}
	return windows.UTF16ToString(buf), nil
}

// Printer açık yazıcı DC'si (tek kopya DEVMODE ile).
type Printer struct {
	dc uintptr
}

// OpenPrinter adı verilen yazıcının DC'sini açar; yazıcı yoksa ErrNoPrinter.
func OpenPrinter(name string) (*Printer, error) {
	n, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, ErrNoPrinter
	}
	dm := oneCopyDevmode(n)
	var dmPtr *byte
	if len(dm) > 0 {
		dmPtr = &dm[0]
	}
	drv, _ := windows.UTF16PtrFromString("WINSPOOL")
	dc, _, _ := pCreateDCW.Call(uintptr(unsafe.Pointer(drv)), uintptr(unsafe.Pointer(n)), 0, uintptr(unsafe.Pointer(dmPtr)))
	if dc == 0 {
		return nil, ErrNoPrinter
	}
	return &Printer{dc: dc}, nil
}

// oneCopyDevmode sürücünün varsayılan DEVMODE'u, dmCopies=1 ile birleştirilmiş; alınamazsa nil (CreateDC varsayılanı).
func oneCopyDevmode(name *uint16) []byte {
	var h windows.Handle
	if r, _, _ := pOpenPrinterW.Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&h)), 0); r == 0 {
		return nil
	}
	defer func() { _, _, _ = pClosePrinter.Call(uintptr(h)) }()
	size, _, _ := pDocumentPropertiesW.Call(0, uintptr(h), uintptr(unsafe.Pointer(name)), 0, 0, 0)
	if int32(size) < devmodeMinLen || size > 1<<20 {
		return nil
	}
	dm := make([]byte, size)
	if r, _, _ := pDocumentPropertiesW.Call(0, uintptr(h), uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&dm[0])), 0,
		dmOutBuffer); int32(r) != idOK {
		return nil
	}
	le := binary.LittleEndian
	le.PutUint32(dm[devmodeFieldsOff:], le.Uint32(dm[devmodeFieldsOff:])|dmCopies)
	le.PutUint16(dm[devmodeCopiesOff:], 1)
	if r, _, _ := pDocumentPropertiesW.Call(0, uintptr(h), uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&dm[0])),
		uintptr(unsafe.Pointer(&dm[0])), dmInBuffer|dmOutBuffer); int32(r) != idOK {
		return nil
	}
	return dm
}

// Target işleyiciden istenecek render boyutu: yazdırılabilir alan, DPI ≤ 300 (oran korunur), ≤ MaxPixels.
func (p *Printer) Target() (w, h uint32, ok bool) {
	pw, _, _ := pGetDeviceCaps.Call(p.dc, horzRes)
	ph, _, _ := pGetDeviceCaps.Call(p.dc, vertRes)
	dpi, _, _ := pGetDeviceCaps.Call(p.dc, logPixelsX)
	if int32(pw) <= 0 || int32(ph) <= 0 || int32(dpi) <= 0 {
		return 0, 0, false
	}
	w, h = uint32(pw), uint32(ph)
	if d := uint32(dpi); d > maxPrintDPI {
		w, h = max(1, w*maxPrintDPI/d), max(1, h*maxPrintDPI/d)
	}
	return w, h, validTarget(w, h)
}

// Print sayfaları tek belge olarak basar. output boş değilse spool çıktısı o dosyaya gider (yalnız test: "Microsoft
// Print to PDF" kayıt diyaloğunu açmasın diye); üretimde boş.
func (p *Printer) Print(pages []*Bitmap, output string) error {
	name, _ := windows.UTF16PtrFromString(DocName)
	di := docInfo{docName: name}
	di.size = int32(unsafe.Sizeof(di))
	if output != "" {
		out, err := windows.UTF16PtrFromString(output)
		if err != nil {
			return ErrPrint
		}
		di.output = out
	}
	if r, _, _ := pStartDocW.Call(p.dc, uintptr(unsafe.Pointer(&di))); int32(r) <= 0 {
		return ErrPrint
	}
	pw, _, _ := pGetDeviceCaps.Call(p.dc, horzRes)
	ph, _, _ := pGetDeviceCaps.Call(p.dc, vertRes)
	for _, bm := range pages {
		if err := p.page(bm, int32(pw), int32(ph)); err != nil {
			_, _, _ = pAbortDoc.Call(p.dc)
			return err
		}
	}
	if r, _, _ := pEndDoc.Call(p.dc); int32(r) <= 0 {
		return ErrPrint
	}
	return nil
}

// page tek sayfa: bitmap yazdırılabilir alanın tamamına (render hedefi bu alanın oranında) StretchDIBits.
func (p *Printer) page(bm *Bitmap, pw, ph int32) error {
	if bm == nil || bm.Stride != int(Stride(uint32(bm.W))) || len(bm.Pix) != bm.Stride*bm.H {
		return ErrPrint
	}
	if r, _, _ := pStartPage.Call(p.dc); int32(r) <= 0 {
		return ErrPrint
	}
	bi := bitmapInfoHeader{width: int32(bm.W), height: -int32(bm.H), planes: 1, bits: 24}
	bi.size = uint32(unsafe.Sizeof(bi))
	lines, _, _ := pStretchDIBits.Call(p.dc, 0, 0, uintptr(pw), uintptr(ph), 0, 0, uintptr(bm.W), uintptr(bm.H),
		uintptr(unsafe.Pointer(&bm.Pix[0])), uintptr(unsafe.Pointer(&bi)), dibRGBColor, srcCopy)
	if int32(lines) <= 0 {
		return ErrPrint
	}
	if r, _, _ := pEndPage.Call(p.dc); int32(r) <= 0 {
		return ErrPrint
	}
	return nil
}

// Close DC'yi bırakır.
func (p *Printer) Close() {
	if p.dc != 0 {
		_, _, _ = pDeleteDC.Call(p.dc)
		p.dc = 0
	}
}
