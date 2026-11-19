//go:build darwin

package update

import (
	"path/filepath"
	"syscall"
)

// wOK access(2) W_OK.
const wOK = 2

// MacReplacer macOS paketi (K-P29-10). Bugün her durumda yalnız bildirir (DecideMac); zip hiç indirilmez.
type MacReplacer struct {
	// Bundle çalışan paketin özgün yolu (translocation çözülmüş; launch.BundlePath).
	Bundle string
	// Translocated paket App Translocation altında çalışıyor (launch.BundleTranslocated).
	Translocated bool
}

// Prepare ErrNotWritable (translocation / yazılamayan konum) ya da ErrManualOnly döner.
func (r MacReplacer) Prepare() (Staging, error) {
	w := r.Bundle != "" && syscall.Access(r.Bundle, wOK) == nil && syscall.Access(filepath.Dir(r.Bundle), wOK) == nil
	return nil, DecideMac(MacLocation{Translocated: r.Translocated, Writable: w})
}
