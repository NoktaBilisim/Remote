//go:build windows

package remember

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

// tryLock `kayitlar.lock` üzerinde LockFileEx(LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY) (G-P20-16):
// oturumlar arası geçerlidir (konsol + RDP aynı dosyayı yazar), adlandırılmış nesne olmadığı için başka kullanıcı
// önceden oluşturup kilitleyemez; handle kapanınca (süreç çökmesi dahil) işletim sistemi bırakır. Başkasında ise
// (false, nil).
func tryLock(f *os.File) (bool, error) {
	err := windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0, 1, 0, new(windows.Overlapped))
	if errors.Is(err, windows.ERROR_LOCK_VIOLATION) || errors.Is(err, windows.ERROR_IO_PENDING) {
		return false, nil
	}
	return err == nil, err
}

func unlock(f *os.File) {
	_ = windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, new(windows.Overlapped))
}

// isSharing paylaşım/kilit ihlali (ör. AV dosyayı açık tutuyor): sınıf 2.
func isSharing(err error) bool {
	return errors.Is(err, windows.ERROR_SHARING_VIOLATION) || errors.Is(err, windows.ERROR_LOCK_VIOLATION)
}
