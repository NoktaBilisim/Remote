package glib

import "unsafe"

func ptrAdd(p *byte, n int) unsafe.Pointer { return unsafe.Add(unsafe.Pointer(p), n) }
