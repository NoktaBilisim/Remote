//go:build darwin

package printing

import "context"

// macOS yazdırma (mimari-p28f r4 "K5 uygulama notu", ADR-0037 m.8a): sayfa sayısı istemcide hesaplanmaz — PDF bu süreçte
// ayrıştırılmaz (T9; TCC izinli süreç), ayrıştırma cupsd filtrelerindedir. Inspect yalnız `%PDF-` + ≤ 20 MB denetler ve
// sayfa sayısı 0 döner; PagesUnknown flow'a bunu bildirir (onay diyaloğu "Sayfa sayısı: yazıcıda belirlenir"). Yazıcı adı
// sabit metindir: lpstat/NSPrintInfo yok (S-P28f-16), lp sistemin varsayılanını kullanır. Varsayılan yazıcı yoksa lp hatası
// onaydan sonra ErrNoPrinter ("yazıcı yok") olur.

// DefaultPrinterLabel onay diyaloğunda gösterilen yazıcı adı.
const DefaultPrinterLabel = "Varsayılan yazıcı"

type lpPrinter struct{}

// New macOS Printer'ı (argüman kullanılmaz; işleyici süreç yok).
func New(string) Printer { return lpPrinter{} }

func (lpPrinter) DefaultPrinter() (string, error) { return DefaultPrinterLabel, nil }

// PagesUnknown Inspect'in sayfa sayısı vermediğini bildirir (clipprint → flow).
func (lpPrinter) PagesUnknown() bool { return true }

func (lpPrinter) Inspect(ctx context.Context, pdf []byte) (Job, error) {
	if err := checkPDF(ctx, pdf); err != nil {
		return nil, err
	}
	return &lpJob{pdf: pdf}, nil
}

// lpJob onaylanan değişmez dilimi lp'ye stdin'den verir; kopyalamaz, saklamaz.
type lpJob struct{ pdf []byte }

func (*lpJob) Pages() int { return 0 }

// Print yazıcı adı yok sayılır (lp -d yok, varsayılan yazıcı).
func (j *lpJob) Print(ctx context.Context, _ string) error {
	if j.pdf == nil {
		return ErrPrint
	}
	return PrintLP(ctx, j.pdf)
}

func (j *lpJob) Close() { j.pdf = nil }
