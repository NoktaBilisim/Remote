//go:build linux

package launch

import (
	"os"
	"path/filepath"
)

// ExeCode P28g (mimari-p28g §2, §4.3; AC-97/AC-398): kod `/proc/self/exe`'nin taban adından okunur (argüman ya da
// ortam kullanılmaz, T4). Bağ okunamazsa ya da ikili silinmiş/yer değiştirmişse (" (deleted)" eki desene uymaz) ""
// döner → kod alanı (fail-closed). Linux'ta yeniden başlatma dosyası yoktur (§10.1).
func ExeCode() string {
	p, err := os.Readlink("/proc/self/exe")
	if err != nil {
		return ""
	}
	return CodeFromExeName(filepath.Base(p))
}
