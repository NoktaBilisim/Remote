//go:build windows

package transfer

import (
	"errors"

	"golang.org/x/sys/windows"
)

// renameNoReplace S6-3: MoveFileEx bayraksız (MOVEFILE_REPLACE_EXISTING yok) — hedef varsa üzerine yazmaz.
// Aynı birimde ADS (Zone.Identifier) dosyayla birlikte taşınır.
func renameNoReplace(src, dst string) error {
	s, err := windows.UTF16PtrFromString(src)
	if err != nil {
		return err
	}
	d, err := windows.UTF16PtrFromString(dst)
	if err != nil {
		return err
	}
	err = windows.MoveFileEx(s, d, 0)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) || errors.Is(err, windows.ERROR_FILE_EXISTS) {
		return errExists
	}
	return err
}
