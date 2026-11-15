//go:build windows

package printing

import (
	"encoding/binary"
	"unsafe"

	"golang.org/x/sys/windows"
)

// GDI ile yazıcıya basma (mimari-p28 §5.3): üst süreçte çalışır. Varsayılan DEVMODE üzerine dmCopies=1, spool belge
// adı sabit (dosya adı kuyruğa düşmez), sayfa yönü sayfanın en/boy oranından ResetDCW ile (DMORIENT_*), sayfa
// yazdırılabilir alana oran korunarak işleyicide sığdırılmış bitmap'tir; burada yalnız 1:1 StretchDIBits.

// DocName spool kuyruğunda görünen tek ad.
const DocName = "NoktaDestek uzaktan yazdırma"

const (
	horzRes    = 8  // GetDeviceCaps HORZRES
	vertRes    = 10 // VERTRES
	logPixelsX = 88 // LOGPIXELSX

	dmOutBuffer      = 2
	dmInBuffer       = 8
	dmOrientation    = 0x1
	dmCopies         = 0x100
	dmOrientPortrait = 1
	dmOrientLandsc   = 2
	idOK             = 1

	// DEVMODEW yerleşimi: dmDeviceName[32]WCHAR (64) | dmSpecVersion | dmDriverVersion | dmSize | dmDriverExtra |
	// dmFields u32 @72 | yazıcı birliği: dmOrientation @76 … dmCopies @86.
	devmodeFieldsOff = 72
	devmodeOrientOff = 76
	devmodeCopiesOff = 86
	devmodeMinLen    = 88

	srcCopy     = 0x00CC0020
	dibRGBColor = 0
)

var (
	modWinspool = windows.NewLazySystemDLL("winspool.drv")
	modGDI32    = windows.NewLazySystemDLL("gdi32.dll")

	pGetDefaultPrinterW  = modWinspool.NewProc("GetDefaultPrinterW")
	pOpenPrinterW        = modWinspool.NewProc("OpenPrinterW")
	pClosePrinter        = modWinspool.NewProc("ClosePrinter")
	pDocumentPropertiesW = modWinspool.NewProc("DocumentPropertiesW")
	pCreateDCW           = modGDI32.NewProc("CreateDCW")
	pResetDCW            = modGDI32.NewProc("ResetDCW")
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

// device açık yazıcı DC'si (tek kopya DEVMODE ile). orient: 0 bilinmiyor, aksi DMORIENT_*.
type device struct {
	dc     uintptr
	dm     []byte
	orient uint16
}

// openDevice adı verilen yazıcının DC'sini açar; yazıcı yoksa ErrNoPrinter.
func openDevice(name string) (*device, error) {
	n, err := windows.UTF16PtrFromString(name)
	if err != nil || name == "" {
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
	return &device{dc: dc, dm: dm}, nil
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

// Orient sayfa yönünü ResetDCW ile ayarlar (yalnız sayfalar arasında çağrılır). DEVMODE yoksa veya sürücü reddederse
// mevcut yönde devam edilir: render hedefi yine o yöndeki yazdırılabilir alandan hesaplanır, sayfa oranı korunur.
func (d *device) Orient(landscape bool) {
	want := uint16(dmOrientPortrait)
	if landscape {
		want = dmOrientLandsc
	}
	if len(d.dm) < devmodeMinLen || d.orient == want {
		return
	}
	le := binary.LittleEndian
	prevFields, prevOrient := le.Uint32(d.dm[devmodeFieldsOff:]), le.Uint16(d.dm[devmodeOrientOff:])
	le.PutUint32(d.dm[devmodeFieldsOff:], prevFields|dmOrientation)
	le.PutUint16(d.dm[devmodeOrientOff:], want)
	if r, _, _ := pResetDCW.Call(d.dc, uintptr(unsafe.Pointer(&d.dm[0]))); r == 0 {
		le.PutUint32(d.dm[devmodeFieldsOff:], prevFields)
		le.PutUint16(d.dm[devmodeOrientOff:], prevOrient)
		return
	}
	d.orient = want
}

// Target işleyiciden istenecek render boyutu: yazdırılabilir alan, DPI ≤ 300 (oran korunur), ≤ MaxPixels.
func (d *device) Target() (w, h uint32, ok bool) {
	pw, _, _ := pGetDeviceCaps.Call(d.dc, horzRes)
	ph, _, _ := pGetDeviceCaps.Call(d.dc, vertRes)
	dpi, _, _ := pGetDeviceCaps.Call(d.dc, logPixelsX)
	if int32(pw) <= 0 || int32(ph) <= 0 || int32(dpi) <= 0 {
		return 0, 0, false
	}
	return targetSize(uint32(pw), uint32(ph), uint32(dpi))
}

// begin belgeyi açar. output boş değilse spool çıktısı o dosyaya gider (yalnız test: "Microsoft Print to PDF" kayıt
// diyaloğunu açmasın diye); üretimde boş.
func (d *device) begin(output string) error {
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
	if r, _, _ := pStartDocW.Call(d.dc, uintptr(unsafe.Pointer(&di))); int32(r) <= 0 {
		return ErrPrint
	}
	return nil
}

func (d *device) end() error {
	if r, _, _ := pEndDoc.Call(d.dc); int32(r) <= 0 {
		return ErrPrint
	}
	return nil
}

func (d *device) abort() { _, _, _ = pAbortDoc.Call(d.dc) }

// Page tek sayfa: bitmap o anki yazdırılabilir alanın tamamına (render hedefi bu alandır) StretchDIBits.
func (d *device) Page(bm *Bitmap) error {
	if bm == nil || bm.W <= 0 || bm.H <= 0 || bm.Stride != int(Stride(uint32(bm.W))) || len(bm.Pix) != bm.Stride*bm.H {
		return ErrPrint
	}
	pw, _, _ := pGetDeviceCaps.Call(d.dc, horzRes)
	ph, _, _ := pGetDeviceCaps.Call(d.dc, vertRes)
	if r, _, _ := pStartPage.Call(d.dc); int32(r) <= 0 {
		return ErrPrint
	}
	bi := bitmapInfoHeader{width: int32(bm.W), height: -int32(bm.H), planes: 1, bits: 24}
	bi.size = uint32(unsafe.Sizeof(bi))
	lines, _, _ := pStretchDIBits.Call(d.dc, 0, 0, pw, ph, 0, 0, uintptr(bm.W), uintptr(bm.H),
		uintptr(unsafe.Pointer(&bm.Pix[0])), uintptr(unsafe.Pointer(&bi)), dibRGBColor, srcCopy)
	if int32(lines) <= 0 {
		return ErrPrint
	}
	if r, _, _ := pEndPage.Call(d.dc); int32(r) <= 0 {
		return ErrPrint
	}
	return nil
}

// close DC'yi bırakır.
func (d *device) close() {
	if d.dc != 0 {
		_, _, _ = pDeleteDC.Call(d.dc)
		d.dc = 0
	}
}
