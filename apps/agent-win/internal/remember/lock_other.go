//go:build !windows

package remember

import (
	"errors"
	"os"
	"syscall"
)

// Windows dışı eş (geliştirme ve Linux CI birim testleri): flock. Windows'ta LockFileEx (lock_windows.go).

// tryLock dosyaya özel kilidi beklemeden almayı dener; başkasında ise (false, nil).
func tryLock(f *os.File) (bool, error) {
	err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if errors.Is(err, syscall.EWOULDBLOCK) {
		return false, nil
	}
	return err == nil, err
}

func unlock(f *os.File) { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN) }

func isSharing(error) bool { return false }
