//go:build !windows

package printing

import "context"

// Yazdırma yalnız Windows istemcidedir (mimari-p28 §5.1); macOS/Linux P28f/g'de CUPS ile aynı arayüzü uygular.

type noPrinter struct{}

// New bu platformda varsayılan yazıcısı olmayan Printer döner (flow print.ready yerine NO_PRINTER raporlar).
func New(string) Printer { return noPrinter{} }

func (noPrinter) DefaultPrinter() (string, error) { return "", ErrNoPrinter }

func (noPrinter) Inspect(context.Context, []byte) (Job, error) { return nil, ErrUnsupported }
