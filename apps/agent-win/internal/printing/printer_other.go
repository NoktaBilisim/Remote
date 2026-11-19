//go:build !windows && !darwin && !linux

package printing

import "context"

// Yazdırma Windows (mimari-p28 §5.1) , macOS ve Linux (printer_unix.go; P28f/P28g) istemcisindedir.

type noPrinter struct{}

// New bu platformda varsayılan yazıcısı olmayan Printer döner (flow print.ready yerine NO_PRINTER raporlar).
func New(string) Printer { return noPrinter{} }

func (noPrinter) DefaultPrinter() (string, error) { return "", ErrNoPrinter }

func (noPrinter) Inspect(context.Context, []byte) (Job, error) { return nil, ErrUnsupported }
