//go:build darwin

package files

import (
	"errors"
	"os"
	"path/filepath"
)

// ErrNoDownloads İndirilenler klasörü yok ya da bu kullanıcıya ait gerçek dizin değil (dosya teklifleri otomatik reddedilir).
var ErrNoDownloads = errors.New("files: İndirilenler klasörü yok")

// DownloadsDir macOS İndirilenler klasörü (`~/Downloads`; ADR-0037 m.8 (i)). Son bileşen sembolik bağ olamaz ve dizin bu
// kullanıcıya ait olmalıdır; aksi halde ErrNoDownloads (fail-closed: alınan dosya başka yere yazılmaz).
func DownloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || !filepath.IsAbs(home) {
		return "", ErrNoDownloads
	}
	return downloadsIn(home)
}

func downloadsIn(home string) (string, error) {
	dir := filepath.Join(home, "Downloads")
	if !ownedDir(dir) {
		return "", ErrNoDownloads
	}
	return dir, nil
}
