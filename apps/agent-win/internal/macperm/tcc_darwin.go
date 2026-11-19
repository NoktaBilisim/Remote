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

// RequestAccessibility AC-506 / S-r4-9: Erişilebilirlik izni yoksa AXIsProcessTrustedWithOptions
// ({kAXTrustedCheckOptionPrompt: true}) bir kez çağrılır; macOS uygulamayı (listeden "−" ile kaldırılmışsa da) listeye
// kapalı olarak ekler ve kendi istemini gösterir. "+" ile Finder'dan seçme yolunun yerini tutar. Herhangi bir sembol
// bağlanamazsa sessizce atlanır (rehber metni geçerli kalır). Diske yazmaz. Ana iş parçacığında çağrılır.
func RequestAccessibility() {
	b, ok := bindAXPrompt()
	if !ok || b.trusted() {
		return
	}
	objc.Pool(func() {
		// CFStringRef/CFBooleanRef NSString/NSNumber ile köprülüdür; sözlük autorelease (havuzla bırakılır).
		opts := objc.ID(b.dict).Send(objc.Sel("dictionaryWithObject:forKey:"), objc.ID(b.yes), objc.ID(b.key))
		if opts != 0 {
			b.withOptions(uintptr(opts))
		}
	})
}

// axPrompt RequestAccessibility'nin bağlanan sembolleri.
type axPrompt struct {
	trusted     func() bool
	withOptions func(uintptr) bool
	key, yes    uintptr // kAXTrustedCheckOptionPrompt, kCFBooleanTrue
	dict        objc.Class
}

// bindAXPrompt sembolleri bağlar; biri eksikse ok=false (fail-closed: istem açılmaz).
func bindAXPrompt() (axPrompt, bool) {
	var b axPrompt
	ax, err := objc.Framework("ApplicationServices")
	if err != nil {
		return b, false
	}
	cf, err := objc.Framework("CoreFoundation")
	if err != nil {
		return b, false
	}
	if objc.Func(&b.trusted, ax, "AXIsProcessTrusted") != nil ||
		objc.Func(&b.withOptions, ax, "AXIsProcessTrustedWithOptions") != nil {
		return b, false
	}
	if b.key, err = objc.Symbol(ax, "kAXTrustedCheckOptionPrompt"); err != nil || b.key == 0 {
		return b, false
	}
	if b.yes, err = objc.Symbol(cf, "kCFBooleanTrue"); err != nil || b.yes == 0 {
		return b, false
	}
	if b.dict, err = objc.GetClass("NSDictionary"); err != nil {
		return b, false
	}
	return b, true
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
