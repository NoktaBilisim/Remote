//go:build darwin

package macperm

import (
	"errors"
	"os/exec"
	"strings"

	"remote-support/agent-win/internal/darwin/objc"
)

// TCC yoklaması ve yeniden başlatma (mimari-p28f §5.3). CoreGraphics işlevleri bağlanamazsa izin "yok" sayılır
// (fail-closed: rehber gösterilir).

const csDarwinUserTempDir = 65537 // _CS_DARWIN_USER_TEMP_DIR

var errNoBind = errors.New("macperm: sistem işlevi bağlanamadı")

// ScreenCaptureGranted CGPreflightScreenCaptureAccess (istem açmaz).
func ScreenCaptureGranted() bool {
	var fn func() bool
	h, err := objc.Framework("CoreGraphics")
	if err != nil || objc.Func(&fn, h, "CGPreflightScreenCaptureAccess") != nil {
		return false
	}
	return fn()
}

// RequestScreenCapture CGRequestScreenCaptureAccess bir kez (sistem uygulamayı Ekran Kaydı listesine ekler).
func RequestScreenCapture() {
	var fn func() bool
	h, err := objc.Framework("CoreGraphics")
	if err == nil && objc.Func(&fn, h, "CGRequestScreenCaptureAccess") == nil {
		fn()
	}
}

// TempDir confstr(_CS_DARWIN_USER_TEMP_DIR) — ortam değişkeni ($TMPDIR) değil (T6).
func TempDir() (string, error) {
	var confstr func(name int32, buf *byte, n uintptr) uintptr
	h, err := objc.Open(objc.LibSystem)
	if err != nil || objc.Func(&confstr, h, "confstr") != nil {
		return "", errNoBind
	}
	buf := make([]byte, 1024)
	n := confstr(csDarwinUserTempDir, &buf[0], uintptr(len(buf)))
	if n == 0 || n > uintptr(len(buf)) {
		return "", errNoBind
	}
	return strings.TrimRight(string(buf[:n-1]), "/"), nil
}

// Relaunch `/usr/bin/open -n <bundle> --args --restart <belirteç>` (yalnız .app bundle'ı; kabuk yok).
func Relaunch(bundle, token string) error {
	if !strings.HasSuffix(bundle, ".app") || !tokenRe.MatchString(token) {
		return errors.New("macperm: bundle değil")
	}
	return exec.Command("/usr/bin/open", "-n", bundle, "--args", RestartFlag, token).Run()
}
