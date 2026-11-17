//go:build !windows && !darwin

package printing

import "context"

// Yazdırma Windows (mimari-p28 §5.1) ve macOS (printer_darwin.go, P28f) istemcisindedir; Linux P28g'de lp_unix.go ile.

type noPrinter struct{}

// New bu platformda varsayılan yazıcısı olmayan Printer döner (flow print.ready yerine NO_PRINTER raporlar).
func New(string) Printer { return noPrinter{} }

func (noPrinter) DefaultPrinter() (string, error) { return "", ErrNoPrinter }

func (noPrinter) Inspect(context.Context, []byte) (Job, error) { return nil, ErrUnsupported }
