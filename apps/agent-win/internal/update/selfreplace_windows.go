//go:build windows

package update

import (
	"errors"
	"io"
	"os"
	"syscall"
)

// Windows taşınabilir yer değiştirmenin sistem çağrıları (K-P29-9). Yalnız stdlib: CREATE_NEW + share=0 burada;
// MoveFileEx ve GetDriveType stdlib `syscall`'da yok, cmd/noktadestek x/sys/windows ile enjekte eder (reason.go kuralı).

// NewWindowsFS gerçek WinFS. move = MoveFileEx(REPLACE_EXISTING|WRITE_THROUGH); fixed = yerel sabit disk denetimi.
func NewWindowsFS(move func(from, to string) error, fixed func(path string) bool) WinFS {
	return winFS{move: move, fixed: fixed}
}

type winFS struct {
	move  func(from, to string) error
	fixed func(path string) bool
}

func (w winFS) FixedLocal(path string) bool        { return w.fixed != nil && w.fixed(path) }
func (w winFS) Move(from, to string) error         { return w.move(from, to) }
func (w winFS) Remove(path string) error           { return os.Remove(path) }
func (w winFS) WriteFile(p string, b []byte) error { return os.WriteFile(p, b, 0o600) }

// ReadFile en çok max bayt okur (fazlası hata).
func (w winFS) ReadFile(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, errors.New("update: dosya sınırı aştı")
	}
	return b, nil
}

// Windows hata kodları (syscall'da dışa açık olmayanlar).
const errSharingViolation = syscall.Errno(32)

// CreateExclusive CREATE_NEW, paylaşımsız (share=0), yalnız yazma. Var olan / başka örneğin tuttuğu dosya ErrBusy.
func (winFS) CreateExclusive(path string) (WinFile, error) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, ErrNotWritable
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_WRITE, 0, nil, syscall.CREATE_NEW, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		if errors.Is(err, syscall.ERROR_FILE_EXISTS) || errors.Is(err, syscall.ERROR_ALREADY_EXISTS) ||
			errors.Is(err, errSharingViolation) {
			return nil, ErrBusy
		}
		return nil, ErrNotWritable
	}
	return os.NewFile(uintptr(h), path), nil
}
