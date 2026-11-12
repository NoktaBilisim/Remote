//go:build !windows

package diag

import "os"

// isReparse sembolik bağlantı veya düzensiz dosya (Windows dışı: yalnız mod bitleri).
func isReparse(fi os.FileInfo) bool { return fi.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 }
