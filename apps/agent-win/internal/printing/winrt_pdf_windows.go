//go:build windows

package printing

import (
	"bytes"
	"image"
	"image/png"
	"math"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows.Data.Pdf (WinRT, Windows 10+ yerleşik) ile PDF → sayfa bitmap'i (mimari-p28 §5.1, ADR-0031). PDF yalnız
// bellekte: SHCreateMemStream değil, tasarımdaki InMemoryRandomAccessStream (RoActivateInstance) kullanılır; bayt
// yazma/okuma için shcore CreateStreamOverRandomAccessStream ile aynı akışın IStream görünümü alınır (IBuffer
// gerekmez). Windows.Data.Pdf bir görüntüleyicidir: JavaScript, form eylemi, OpenAction/Launch/URI çalıştırmaz.
//
// Çıktı kodlayıcısı varsayılanı PNG'dir (PdfPageRenderOptions.BitmapEncoderId); PNG Go standart kütüphanesiyle
// çözülür (yeni bağımlılık yok) ve hedef boyutta, beyaz zemin üzerinde ortalanmış 24 bit BGR'a dönüştürülür.
//
// Vtable sıraları windows.data.pdf.h / windows.storage.streams.h (Windows SDK) C arayüzlerinden; IInspectable
// türevlerinde yöntemler 6'dan başlar. 64 bitlik değer argümanları (Seek konumu) tek yazmaçta geçer: yalnız 64 bit
// Windows (hedef windows/amd64, build.sh).

var (
	modShcore = windows.NewLazySystemDLL("shcore.dll")

	pCreateStreamOverRAS = modShcore.NewProc("CreateStreamOverRandomAccessStream")

	iidIPdfDocumentStatics   = guid(0x433a0b5f, 0xc007, 0x4788, 0x90, 0xf2, 0x08, 0x14, 0x3d, 0x92, 0x25, 0x99)
	iidIPdfPageRenderOptions = guid(0x3c98056f, 0xb7cf, 0x4c29, 0x9a, 0x04, 0x52, 0xd9, 0x02, 0x67, 0xf4, 0x25)
	iidIRandomAccessStream   = guid(0x905a0fe1, 0xbc53, 0x11df, 0x8c, 0x49, 0x00, 0x1e, 0x4f, 0xc6, 0x86, 0xda)
	iidIStream               = guid(0x0000000c, 0x0000, 0x0000, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46)
)

const (
	classPdfDocument          = "Windows.Data.Pdf.PdfDocument"
	classPdfPageRenderOptions = "Windows.Data.Pdf.PdfPageRenderOptions"
	classInMemoryStream       = "Windows.Storage.Streams.InMemoryRandomAccessStream"

	vtPdfStaticsLoadFromStream = 8  // IPdfDocumentStatics.LoadFromStreamAsync
	vtPdfDocGetPage            = 6  // IPdfDocument.GetPage
	vtPdfDocPageCount          = 7  // IPdfDocument.get_PageCount
	vtPdfPageRenderWithOptions = 7  // IPdfPage.RenderWithOptionsToStreamAsync
	vtPdfPageSize              = 10 // IPdfPage.get_Size (DIP)
	vtOptPutDestWidth          = 9  // IPdfPageRenderOptions.put_DestinationWidth
	vtOptPutDestHeight         = 11 // IPdfPageRenderOptions.put_DestinationHeight
	vtRASGetSize               = 6  // IRandomAccessStream.get_Size
	vtRASSeek                  = 11 // IRandomAccessStream.Seek
	vtStreamRead               = 3  // IStream.Read
	vtStreamWrite              = 4  // IStream.Write

	loadTimeout   = 15 * time.Second // §5.2 inspect
	renderTimeout = 15 * time.Second // §5.2 sayfa başına
	maxPNGBytes   = MaxFrameBytes
)

// pdfDoc yüklü belge; yalnız açıldığı (roInit yapılmış, kilitli) iş parçacığında kullanılır.
type pdfDoc struct {
	doc   *comObj
	pages uint32
}

// loadPDF belgeyi bellekten açar. Parola korumalı/bozuk belge ErrInvalidPDF; WinRT/COM altyapı hatası HRError.
func loadPDF(data []byte) (*pdfDoc, error) {
	ras, err := memStream(data)
	if err != nil {
		return nil, err
	}
	defer ras.release()
	st, err := activationFactory(classPdfDocument, &iidIPdfDocumentStatics)
	if err != nil {
		return nil, err
	}
	defer st.release()
	var op *comObj
	if hr := st.call(vtPdfStaticsLoadFromStream, uintptr(unsafe.Pointer(ras)), uintptr(unsafe.Pointer(&op))); hr.failed() {
		return nil, hr.err("PdfDocument.LoadFromStreamAsync")
	}
	defer op.release()
	if err := await(op, loadTimeout, "PdfDocument.LoadFromStreamAsync"); err != nil {
		return nil, ErrInvalidPDF // parola/bozuk belge async hata olarak döner; ayrıntı kayda girmez
	}
	d := &pdfDoc{}
	if hr := op.call(vtAsyncGetResults, uintptr(unsafe.Pointer(&d.doc))); hr.failed() || d.doc == nil {
		return nil, ErrInvalidPDF
	}
	if hr := d.doc.call(vtPdfDocPageCount, uintptr(unsafe.Pointer(&d.pages))); hr.failed() {
		d.close()
		return nil, hr.err("PdfDocument.PageCount")
	}
	if d.pages < 1 || d.pages > MaxPages {
		d.close()
		return nil, ErrInvalidPDF
	}
	return d, nil
}

func (d *pdfDoc) close() {
	d.doc.release()
	d.doc = nil
}

// render idx sayfasını tam w×h hedefe, oranı koruyarak beyaz zemine ortalanmış BGR olarak çizer. Hedef boyutu üst
// süreç verir (yazıcı yazdırılabilir alanı); sayfa ölçüsü yalnız oran için okunur.
func (d *pdfDoc) render(idx, w, h uint32) (*Bitmap, error) {
	n, ok := frameLen(w, h)
	if !ok || idx >= d.pages {
		return nil, ErrProtocol
	}
	var page *comObj
	if hr := d.doc.call(vtPdfDocGetPage, uintptr(idx), uintptr(unsafe.Pointer(&page))); hr.failed() {
		return nil, hr.err("PdfDocument.GetPage")
	}
	defer page.release()
	var size struct{ W, H float32 }
	if hr := page.call(vtPdfPageSize, uintptr(unsafe.Pointer(&size))); hr.failed() {
		return nil, hr.err("PdfPage.Size")
	}
	dw, dh := fit(float64(size.W), float64(size.H), w, h)
	encoded, err := renderPNG(page, dw, dh)
	if err != nil {
		return nil, err
	}
	img, err := png.Decode(bytes.NewReader(encoded))
	if err != nil {
		return nil, &HRError{Op: "png.Decode"}
	}
	bm := &Bitmap{W: int(w), H: int(h), Stride: int(Stride(w)), Pix: make([]byte, n)}
	compose(bm, img)
	return bm, nil
}

// fit sayfa oranını koruyarak w×h içine sığan boyut (en az 1 piksel); oran okunamazsa hedefin kendisi.
func fit(pw, ph float64, w, h uint32) (uint32, uint32) {
	if !(pw > 0) || !(ph > 0) || math.IsInf(pw, 0) || math.IsInf(ph, 0) {
		return w, h
	}
	s := math.Min(float64(w)/pw, float64(h)/ph)
	dw := uint32(math.Max(1, math.Min(float64(w), math.Round(pw*s))))
	dh := uint32(math.Max(1, math.Min(float64(h), math.Round(ph*s))))
	return dw, dh
}

// renderPNG sayfayı dw×dh PNG olarak bellekteki akışa çizer ve baytları döner.
func renderPNG(page *comObj, dw, dh uint32) ([]byte, error) {
	opts, err := activate(classPdfPageRenderOptions, &iidIPdfPageRenderOptions)
	if err != nil {
		return nil, err
	}
	defer opts.release()
	if hr := opts.call(vtOptPutDestWidth, uintptr(dw)); hr.failed() {
		return nil, hr.err("RenderOptions.DestinationWidth")
	}
	if hr := opts.call(vtOptPutDestHeight, uintptr(dh)); hr.failed() {
		return nil, hr.err("RenderOptions.DestinationHeight")
	}
	out, err := activate(classInMemoryStream, &iidIRandomAccessStream)
	if err != nil {
		return nil, err
	}
	defer out.release()
	var action *comObj
	if hr := page.call(vtPdfPageRenderWithOptions, uintptr(unsafe.Pointer(out)), uintptr(unsafe.Pointer(opts)),
		uintptr(unsafe.Pointer(&action))); hr.failed() {
		return nil, hr.err("PdfPage.RenderToStreamAsync")
	}
	defer action.release()
	if err := await(action, renderTimeout, "PdfPage.RenderToStreamAsync"); err != nil {
		return nil, err
	}
	if hr := action.call(vtAsyncGetResults); hr.failed() {
		return nil, hr.err("PdfPage.RenderToStreamAsync")
	}
	var size uint64
	if hr := out.call(vtRASGetSize, uintptr(unsafe.Pointer(&size))); hr.failed() {
		return nil, hr.err("Stream.Size")
	}
	if size == 0 || size > maxPNGBytes {
		return nil, &HRError{Op: "Stream.Size"}
	}
	if hr := out.call(vtRASSeek, 0); hr.failed() {
		return nil, hr.err("Stream.Seek")
	}
	ist, err := streamOver(out)
	if err != nil {
		return nil, err
	}
	defer ist.release()
	buf := make([]byte, size)
	for off := 0; off < len(buf); {
		var got uint32
		if hr := ist.call(vtStreamRead, uintptr(unsafe.Pointer(&buf[off])), uintptr(len(buf)-off),
			uintptr(unsafe.Pointer(&got))); hr.failed() {
			return nil, hr.err("IStream.Read")
		}
		if got == 0 {
			return nil, &HRError{Op: "IStream.Read"}
		}
		off += int(got)
	}
	return buf, nil
}

// memStream PDF baytlarını içeren, başa sarılmış InMemoryRandomAccessStream.
func memStream(data []byte) (*comObj, error) {
	ras, err := activate(classInMemoryStream, &iidIRandomAccessStream)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			ras.release()
		}
	}()
	ist, err := streamOver(ras)
	if err != nil {
		return nil, err
	}
	defer ist.release()
	var n uint32
	if hr := ist.call(vtStreamWrite, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)), uintptr(unsafe.Pointer(&n))); hr.failed() {
		return nil, hr.err("IStream.Write")
	}
	if int(n) != len(data) {
		return nil, &HRError{Op: "IStream.Write"}
	}
	if hr := ras.call(vtRASSeek, 0); hr.failed() {
		return nil, hr.err("Stream.Seek")
	}
	ok = true
	return ras, nil
}

// streamOver aynı akışın klasik COM IStream görünümü.
func streamOver(ras *comObj) (*comObj, error) {
	var ist *comObj
	if err := procHR(pCreateStreamOverRAS, "CreateStreamOverRandomAccessStream", uintptr(unsafe.Pointer(ras)),
		uintptr(unsafe.Pointer(&iidIStream)), uintptr(unsafe.Pointer(&ist))); err != nil {
		return nil, err
	}
	return ist, nil
}

// compose img'yi beyaz bm üzerine ortalar (24 bit BGR, üstten aşağı). Saydamlık beyaza karıştırılır.
func compose(bm *Bitmap, img image.Image) {
	for i := range bm.Pix {
		bm.Pix[i] = 0xff
	}
	b := img.Bounds()
	iw, ih := min(b.Dx(), bm.W), min(b.Dy(), bm.H)
	ox, oy := (bm.W-iw)/2, (bm.H-ih)/2
	for y := 0; y < ih; y++ {
		row := bm.Pix[(oy+y)*bm.Stride+ox*3:]
		for x := 0; x < iw; x++ {
			r, g, bl, a := img.At(b.Min.X+x, b.Min.Y+y).RGBA() // 16 bit, alfa ön çarpımlı
			inv := 0xffff - a
			row[x*3] = byte((bl + inv) >> 8)
			row[x*3+1] = byte((g + inv) >> 8)
			row[x*3+2] = byte((r + inv) >> 8)
		}
	}
}
