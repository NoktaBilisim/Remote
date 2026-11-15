// Package clipprint internal/clip ve internal/printing'i flow'un (K3) Clipboard/Printer arayüzlerine uyarlar ve paket
// hatalarını flow hatalarına eşler (P28a-K4). Kurucular: NewClipboard, NewPrinter; bağlama cmd/noktadestek (K5).
// clip/printing flow'u içe aktarmaz: PDF işleyici kipi akış/ağ kodunu ikiliye çekmesin, yön tek olsun.
package clipprint

import (
	"context"
	"errors"
	"fmt"

	"remote-support/agent-win/internal/clip"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/printing"
)

// Clipboard flow.Clipboard'u clip.Clipboard üstünde sağlar.
type Clipboard struct{ c clip.Clipboard }

// NewClipboard pano iş parçacığını başlatır (Windows dışında clip.ErrUnsupported). Kapatmak için Close.
func NewClipboard() (*Clipboard, error) {
	c, err := clip.New()
	if err != nil {
		return nil, err
	}
	return &Clipboard{c: c}, nil
}

var _ flow.Clipboard = (*Clipboard)(nil)

// Read panodaki metni UTF-8 bayt olarak döner.
func (a *Clipboard) Read() ([]byte, error) {
	s, err := a.c.ReadText()
	if err != nil {
		return nil, clipErr(err)
	}
	return []byte(s), nil
}

// Write metni panoya koyar (geçmiş/bulut dışı).
func (a *Clipboard) Write(text []byte) error { return clipErr(a.c.WriteText(string(text))) }

// Close pano iş parçacığını durdurur.
func (a *Clipboard) Close() { a.c.Close() }

func clipErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, clip.ErrEmpty):
		return fmt.Errorf("%w: %w", flow.ErrClipEmpty, err)
	case errors.Is(err, clip.ErrSensitive):
		return fmt.Errorf("%w: %w", flow.ErrClipSensitive, err)
	case errors.Is(err, clip.ErrTooLarge):
		return fmt.Errorf("%w: %w", flow.ErrClipTooLarge, err)
	}
	return err
}

// Printer flow.Printer'ı printing.Printer üstünde sağlar. Durumsuzdur: Inspect işleyiciyi sayfa sayısını okuyunca
// kapatır (onay diyaloğu süresince süreç beklemez); Print aynı değişmez dilimi yeni işleyicide yeniden açar ve sayfa
// sayısının onaylananla aynı olduğunu doğrular. ctx iptali her iki adımda işleyici job'unu kapatır.
type Printer struct{ p printing.Printer }

// NewPrinter exe bu ikilinin yoludur (işleyici `exe --pdf-isleyici` ile açılır).
func NewPrinter(exe string) *Printer { return &Printer{p: printing.New(exe)} }

var _ flow.Printer = (*Printer)(nil)

// DefaultPrinter varsayılan yazıcı adı; yoksa ok=false.
func (a *Printer) DefaultPrinter() (string, bool) {
	name, err := a.p.DefaultPrinter()
	return name, err == nil && name != ""
}

// Inspect sayfa sayısı (1..100000); bozuk/parola korumalı/çok büyük belge flow.ErrPrintInvalidPDF.
func (a *Printer) Inspect(ctx context.Context, pdf []byte) (int, error) {
	job, err := a.p.Inspect(ctx, pdf)
	if err != nil {
		return 0, printErr(err)
	}
	defer job.Close()
	return job.Pages(), nil
}

// errPagesChanged yeniden açılan belgenin sayfa sayısı onaylanandan farklı (olmaması gerekir; ERROR).
var errPagesChanged = errors.New("clipprint: sayfa sayısı değişti")

// Print belgeyi varsayılan yazıcıya basar.
func (a *Printer) Print(ctx context.Context, pdf []byte, pages int) error {
	name, err := a.p.DefaultPrinter()
	if err != nil {
		return printErr(err)
	}
	job, err := a.p.Inspect(ctx, pdf)
	if err != nil {
		return printErr(err)
	}
	defer job.Close()
	if job.Pages() != pages {
		return errPagesChanged
	}
	return printErr(job.Print(ctx, name))
}

func printErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, printing.ErrNoPrinter):
		return fmt.Errorf("%w: %w", flow.ErrNoPrinter, err)
	case errors.Is(err, printing.ErrInvalidPDF), errors.Is(err, printing.ErrTooLarge):
		return fmt.Errorf("%w: %w", flow.ErrPrintInvalidPDF, err)
	}
	return err
}
