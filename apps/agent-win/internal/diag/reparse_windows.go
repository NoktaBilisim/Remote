//go:build windows

package diag

import (
	"os"
	"syscall"
)

// isReparse sembolik bağlantı, junction (Go'da ModeIrregular) veya FILE_ATTRIBUTE_REPARSE_POINT taşıyan her girdi.
func isReparse(fi os.FileInfo) bool {
	if fi.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 {
		return true
	}
	if a, ok := fi.Sys().(*syscall.Win32FileAttributeData); ok {
		return a.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0
	}
	return false
}
