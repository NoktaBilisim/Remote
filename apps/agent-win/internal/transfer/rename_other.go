//go:build !windows

package transfer

import (
	"errors"
	"io/fs"
	"os"
)

// renameNoReplace Windows dışı (testler): link + kaynağı silme; hedef varsa EEXIST → üzerine yazılmaz.
func renameNoReplace(src, dst string) error {
	if err := os.Link(src, dst); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return errExists
		}
		return err
	}
	return os.Remove(src)
}
