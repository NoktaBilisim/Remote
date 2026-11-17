package launch

import (
	"path/filepath"
	"regexp"
	"strings"
)

// P28f (mimari-p28f §2 launch/code_darwin.go, AC-97/AC-392, S-P28f-13): macOS zip'i `Destek-<kod>/Nokta Destek.app`
// olarak açılır; kod bundle'ın (translocation çözülmüş) üst klasör adından, yoksa bundle adından okunur. Desen çapalı:
// tarayıcı/Finder kopya ekleri " (1)" ve " 2" kabul edilir, başka hiçbir şey kabul edilmez.
var folderCode = regexp.MustCompile(`^Destek-([0-9]{8})(?: \([0-9]{1,3}\)| [0-9]{1,3})?$`)

// CodeFromBundlePath özgün bundle yolundan kod; bulunamazsa "" (kod alanı, AC-97).
func CodeFromBundlePath(bundle string) string {
	if bundle == "" {
		return ""
	}
	bundle = filepath.Clean(bundle)
	if m := folderCode.FindStringSubmatch(filepath.Base(filepath.Dir(bundle))); m != nil {
		return m[1]
	}
	if m := folderCode.FindStringSubmatch(strings.TrimSuffix(filepath.Base(bundle), ".app")); m != nil {
		return m[1]
	}
	return ""
}
