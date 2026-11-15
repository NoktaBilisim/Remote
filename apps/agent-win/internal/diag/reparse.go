//go:build !windows

package diag

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Windows dışı eş (geliştirme ve Linux CI birim testleri): mod bitleriyle denetim. Gerçek koruma (handle üzerinden
// açma/silme, klasör sabitleme) reparse_windows.go'dadır (AC-249).

// isReparse sembolik bağlantı veya düzensiz dosya (Windows dışı: yalnız mod bitleri).
func isReparse(fi os.FileInfo) bool { return fi.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 }

// Dir denetlenmiş klasör.
type Dir struct{ path string }

// lcheck yol yoksa os.ErrNotExist; bağlantı/düzensiz ya da beklenen türde değilse ErrReparse.
func lcheck(path string, wantDir bool) (os.FileInfo, error) {
	fi, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, os.ErrNotExist
		}
		return nil, err
	}
	if isReparse(fi) || fi.IsDir() != wantDir {
		return nil, ErrReparse
	}
	return fi, nil
}

// OpenDir üst klasörü ve klasörü denetler; create true ise yalnız son bileşeni oluşturur.
func OpenDir(path string, create bool) (*Dir, error) {
	path = filepath.Clean(path)
	if _, err := lcheck(filepath.Dir(path), true); err != nil {
		return nil, err
	}
	if create {
		if err := os.Mkdir(path, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
	}
	if _, err := lcheck(path, true); err != nil {
		return nil, err
	}
	return &Dir{path: path}, nil
}

// Close Windows eşiyle aynı imza (burada tutulan kaynak yok).
func (d *Dir) Close() {}

func (d *Dir) child(name string) (string, error) {
	if name == "" || name != filepath.Base(name) || strings.ContainsAny(name, `\/:`) {
		return "", errors.New("diag: geçersiz dosya adı")
	}
	return filepath.Join(d.path, name), nil
}

// Open dosyayı açar; bağlantı veya düzensiz dosya reddedilir, açılan dosya Lstat ile aynı olmalıdır.
func (d *Dir) Open(name string, m Mode) (*os.File, error) {
	path, err := d.child(name)
	if err != nil {
		return nil, err
	}
	before, err := lcheck(path, false)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	var flag int
	switch m {
	case ModeRead:
		flag = os.O_RDONLY
	case ModeAppend:
		flag = os.O_WRONLY | os.O_CREATE | os.O_APPEND
	case ModeCreate:
		flag = os.O_WRONLY | os.O_CREATE | os.O_EXCL
	case ModeLock:
		flag = os.O_RDWR | os.O_CREATE
	default:
		return nil, errors.New("diag: geçersiz kip")
	}
	f, err := os.OpenFile(path, flag, 0o600)
	if err != nil {
		return nil, err
	}
	fi, err := f.Stat()
	if err != nil || !fi.Mode().IsRegular() || (before != nil && !os.SameFile(before, fi)) {
		_ = f.Close()
		return nil, ErrReparse
	}
	return f, nil
}

// Rename klasör içinde from → to; ikisi de bağlantı olamaz.
func (d *Dir) Rename(from, to string) error {
	src, err := d.child(from)
	if err != nil {
		return err
	}
	dst, err := d.child(to)
	if err != nil {
		return err
	}
	if _, err := lcheck(src, false); err != nil {
		return err
	}
	if _, err := lcheck(dst, false); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(src, dst)
}

// Remove dosyayı siler; yoksa os.ErrNotExist, bağlantıysa ErrReparse.
func (d *Dir) Remove(name string) error {
	path, err := d.child(name)
	if err != nil {
		return err
	}
	if _, err := lcheck(path, false); err != nil {
		return err
	}
	return os.Remove(path)
}

// RemoveIfEmpty klasörü yalnız boşsa siler.
func (d *Dir) RemoveIfEmpty() {
	if ents, err := os.ReadDir(d.path); err == nil && len(ents) == 0 {
		_ = os.Remove(d.path)
	}
}
