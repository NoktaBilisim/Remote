//go:build darwin

package files

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"

	"remote-support/agent-win/internal/darwin/objc"
)

// İz önlemleri (AC-394, ADR-0037 m.8, mimari-p28f §5.3 m.5, S-P28f-14): kapanışta (ve emniyet için açılışta) AppKit'in
// bıraktığı iki iz silinir — Metal gölgelendirici önbelleği `confstr(_CS_DARWIN_USER_CACHE_DIR)/<bundle id>` ve pencere
// geri yükleme `~/Library/Saved Application State/<bundle id>.savedState`. Bundle kimliği çalışma anında okunmaz (boş ya
// da değiştirilmiş kimlikle üst dizin silinemesin): yalnız sabit prod ve staging kimlikleri. NSUserDefaults kullanılmaz;
// önbellek dizini ortam değişkeninden değil confstr'den alınır.

// bundleIDs silinecek izlerin sahibi olabilecek kimlikler (prod, staging; §5.3 m.6).
var bundleIDs = []string{"net.noktabilisim.destek", "net.noktabilisim.destek.stg"}

// _CS_DARWIN_USER_CACHE_DIR (<unistd.h>).
const csDarwinUserCacheDir = 65538

var errNoCacheDir = errors.New("kullanıcı önbellek dizini alınamadı")

// userCacheDir confstr(_CS_DARWIN_USER_CACHE_DIR): mutlak, gerçek dizin (bağ değil), sahibi bu kullanıcı.
func userCacheDir() (string, error) {
	h, err := objc.Open(objc.LibSystem)
	if err != nil {
		return "", errors.Join(errNoCacheDir, err)
	}
	var confstr func(name int32, buf *byte, n uintptr) uintptr
	if err := objc.Func(&confstr, h, "confstr"); err != nil {
		return "", errors.Join(errNoCacheDir, err)
	}
	buf := make([]byte, 1024)
	n := confstr(csDarwinUserCacheDir, &buf[0], uintptr(len(buf)))
	if n < 2 || n > uintptr(len(buf)) {
		return "", errNoCacheDir
	}
	dir := filepath.Clean(string(buf[:n-1]))
	if !filepath.IsAbs(dir) || !ownedDir(dir) {
		return "", errNoCacheDir
	}
	return dir, nil
}

// ownedDir yol bu kullanıcıya ait gerçek dizin mi (son bileşen sembolik bağ değil).
func ownedDir(p string) bool {
	fi, err := os.Lstat(p)
	if err != nil || !fi.IsDir() {
		return false
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	return ok && int(st.Uid) == os.Getuid()
}

// removeTraces cache ve home altındaki sabit iz yollarını siler (yoksa sessiz). Boş/göreli kök atlanır. Bağ izlenmez
// (os.RemoveAll son bileşeni bağsa yalnız bağı siler).
func removeTraces(cache, home string) error {
	var errs []error
	for _, id := range bundleIDs {
		var paths []string
		if cache != "" && filepath.IsAbs(cache) {
			paths = append(paths, filepath.Join(cache, id))
		}
		if home != "" && filepath.IsAbs(home) {
			paths = append(paths, filepath.Join(home, "Library", "Saved Application State", id+".savedState"))
		}
		for _, p := range paths {
			if err := os.RemoveAll(p); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

// CleanTraces K4/main_darwin.go çağırır: açılışta (önceki çökmüş oturumdan kalan) ve `terminate:`'ten hemen önce
// (applicationWillTerminate ya da akış bitişi). İdempotent; hata yalnız bilgi içindir (iz testi doğrular).
func CleanTraces() error {
	cache, cerr := userCacheDir()
	home, herr := os.UserHomeDir()
	if cerr != nil {
		cache = ""
	}
	if herr != nil {
		home = ""
	}
	return errors.Join(cerr, herr, removeTraces(cache, home))
}
