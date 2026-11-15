//go:build windows

package printing

import "context"

// winPrinter Printer'ın Windows uygulaması: render kısıtlı işleyicide, GDI basma bu süreçte.
type winPrinter struct {
	exe    string
	iso    Isolation
	output string // yalnız test: spool çıktısı dosyaya (Microsoft Print to PDF kayıt diyaloğu açılmasın)
}

// New exe (bu ikilinin yolu) ile Printer döner; yalıtım DefaultIsolation.
func New(exe string) Printer { return &winPrinter{exe: exe, iso: DefaultIsolation} }

func (p *winPrinter) DefaultPrinter() (string, error) { return DefaultPrinter() }

func (p *winPrinter) Inspect(ctx context.Context, pdf []byte) (Job, error) {
	switch {
	case len(pdf) == 0:
		return nil, ErrInvalidPDF
	case len(pdf) > MaxPDFBytes:
		return nil, ErrTooLarge
	}
	w, err := StartWorker(p.exe, p.iso)
	if err != nil {
		return nil, err
	}
	pages, err := w.Inspect(ctx, pdf)
	if err != nil {
		w.Close()
		return nil, err
	}
	return &winJob{w: w, pages: pages, output: p.output}, nil
}

type winJob struct {
	w      *Worker
	pages  int
	output string
}

func (j *winJob) Pages() int { return j.pages }

func (j *winJob) Close() { j.w.Close() }

// Print yazıcıyı açar, tek belge başlatır, sayfaları basar; hata veya iptalde AbortDoc.
func (j *winJob) Print(ctx context.Context, printer string) error {
	if ctx.Err() != nil {
		return ErrCancelled
	}
	dev, err := openDevice(printer)
	if err != nil {
		return err
	}
	defer dev.close()
	if err := dev.begin(j.output); err != nil {
		return err
	}
	if err := printPages(ctx, j.w, dev, j.pages); err != nil {
		dev.abort()
		return err
	}
	return dev.end()
}
