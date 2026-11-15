//go:build windows

package servis

import (
	"path/filepath"

	"golang.org/x/sys/windows"
)

// ProgramDir `%ProgramFiles%\NoktaDestek Servis` (bilinen klasör API'si; ortam değişkeni okunmaz).
func ProgramDir() (string, error) {
	base, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil {
		return "", err
	}
	return filepath.Join(base, InstallDirName), nil
}

// DataDir `%ProgramData%\NoktaDestek Servis`.
func DataDir() (string, error) {
	base, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, 0)
	if err != nil {
		return "", err
	}
	return filepath.Join(base, InstallDirName), nil
}

// InstalledExe kurulu ikilinin yolu.
func InstalledExe() (string, error) {
	dir, err := ProgramDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, ExeName), nil
}
