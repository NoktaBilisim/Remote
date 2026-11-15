//go:build windows && !(amd64 || arm64)

package capture

// AC-248: WGC yalnız amd64/arm64'te (SizeInt32 değerle geçirme ABI'si, wgc_windows.go). Diğer mimarilerde pencere
// modu sunulmaz; yalnız tüm ekran (DXGI/GDI) kalır.

// WindowCaptureSupported bu mimaride her zaman false.
func WindowCaptureSupported() bool { return false }

func openWGCGrabber(uintptr) (grabber, error) {
	return nil, &Error{Reason: ReasonWGCUnsupported, Op: "WGC.Arch", Method: MethodWGC}
}
