package printing

import (
	"context"
	"errors"
)

// Üst süreç yazdırma hizmeti (mimari-p28 §5.2–5.3). flow (K3) bu arayüzü kullanır; Windows uygulaması New ile gelir.
// PDF baytları çağıranındır ve değişmezdir (O-P28a-2): Inspect onları işleyiciye yazar, kopyalamaz ve silmez.

var (
	ErrNoPrinter   = errors.New("printing: varsayılan yazıcı yok")
	ErrPrint       = errors.New("printing: yazdırma başarısız")
	ErrTooLarge    = errors.New("printing: belge çok büyük")
	ErrCancelled   = errors.New("printing: iptal edildi")
	ErrUnsupported = errors.New("printing: bu platformda desteklenmiyor")
)

// Printer varsayılan yazıcı sorgusu ve belge açma.
type Printer interface {
	// DefaultPrinter varsayılan yazıcının adı; yoksa ErrNoPrinter (diyalog açılmaz).
	DefaultPrinter() (string, error)
	// Inspect belgeyi kısıtlı işleyicide açar ve sayfa sayısını okur. Hatalar: ErrTooLarge, ErrInvalidPDF,
	// ErrCancelled (ctx iptali), ErrWorker. Başarıda dönen Job mutlaka Close edilir.
	Inspect(ctx context.Context, pdf []byte) (Job, error)
}

// Job açılmış belge; yöntemleri eşzamanlı çağrılmaz, iptal yalnız ctx ile yapılır.
type Job interface {
	// Pages inspect'in doğruladığı sayfa sayısı (1..MaxPages).
	Pages() int
	// Print tüm sayfaları printer'a tek belge olarak basar. ctx iptali işleyiciyi durdurur ve ErrCancelled döner;
	// yazıcı açılamazsa ErrNoPrinter; diğerleri ErrPrint / ErrWorker / ErrProtocol.
	Print(ctx context.Context, printer string) error
	// Close işleyiciyi durdurur (job kapanır). Tekrar çağrılabilir.
	Close()
}

// pageSource sayfa ölçüsü ve render (işleyici); pageSink yazıcı DC'si.
type pageSource interface {
	PageSize(ctx context.Context, idx uint32) (w, h uint32, err error)
	Render(ctx context.Context, idx, w, h uint32) (*Bitmap, error)
}

type pageSink interface {
	Orient(landscape bool)
	Target() (w, h uint32, ok bool)
	Page(bm *Bitmap) error
}

// printPages sayfaları sırayla basar: sayfa yönü en/boy oranından (§5.3 ResetDCW), render hedefi yazıcının o yöndeki
// yazdırılabilir alanından (üst süreç belirler, O-P28a-3). Her bitmap basıldıktan sonra sıfırlanır.
func printPages(ctx context.Context, src pageSource, dst pageSink, pages int) error {
	for i := 0; i < pages; i++ {
		if ctx.Err() != nil {
			return ErrCancelled
		}
		pw, ph, err := src.PageSize(ctx, uint32(i))
		if err != nil {
			return err
		}
		dst.Orient(pw > ph)
		tw, th, ok := dst.Target()
		if !ok {
			return ErrPrint
		}
		bm, err := src.Render(ctx, uint32(i), tw, th)
		if err != nil {
			return err
		}
		err = dst.Page(bm)
		clear(bm.Pix)
		if err != nil {
			return err
		}
	}
	return nil
}
