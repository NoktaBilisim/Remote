package servis

import (
	"crypto/sha256"
	"errors"
)

// K-P29-13 / AC-476 platform imzası kararı (platformsuz; Windows bağlaması update_sign_windows.go).

// ErrPlatformSignature yeni ikilinin platform imzası çalışan ikiliyle uyuşmuyor.
var ErrPlatformSignature = errors.New("servis: platform imzası uyuşmuyor")

// checkPublisher çalışan ikili imzasızsa nil (yalnız manifest kapısı). İmzalıysa yeni ikili de geçerli imzalı olmalı ve
// imzalayan yaprak sertifika özetleri eşit olmalı; özet okunamazsa ret (fail-closed).
func checkPublisher(signed func(path string) bool, digest func(path string) ([sha256.Size]byte, error),
	selfExe, newPath string) error {
	if !signed(selfExe) {
		return nil
	}
	if !signed(newPath) {
		return ErrPlatformSignature
	}
	a, err1 := digest(selfExe)
	b, err2 := digest(newPath)
	if errors.Join(err1, err2) != nil || a != b {
		return ErrPlatformSignature
	}
	return nil
}
