//go:build linux

package main

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"syscall"

	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/linux/glib"
)

// P28g K1 — açılış sertleştirmesi (mimari-p28g §5.1 T4/T5, §5.3, §13 S-P28g-5/11, §15 D-P28g-T2-1/4; ADR-0038 m.1, m.14).

// fixedPath yeniden çalıştırılan sürecin PATH'i (kullanıcı PATH'i alınmaz).
const fixedPath = "PATH=/usr/bin:/bin"

// envAllow ortam izin listesi (mimari-p28g §13 S-P28g-5 + §15 D-P28g-T2-1). `HTTP_PROXY`/`http_proxy`/`ALL_PROXY`,
// `SSL_CERT_*`, `LD_*`, `GTK_*` (GTK_IM_MODULE dışında), `GDK_*` (GDK_SCALE/GDK_DPI_SCALE dışında; GDK_CORE_DEVICE_EVENTS
// ve GDK_DEBUG dahil), `GIO_*`, `GST_*`, `LIBGL_*`, `__EGL_*`, `PULSE_SERVER`, `TMPDIR` listede YOKTUR.
var envAllow = map[string]bool{
	"HOME": true, "USER": true, "LOGNAME": true, "LANG": true,
	"DISPLAY": true, "WAYLAND_DISPLAY": true, "XAUTHORITY": true,
	"XDG_RUNTIME_DIR": true, "XDG_SESSION_TYPE": true, "XDG_CURRENT_DESKTOP": true, "XDG_DATA_DIRS": true,
	"XDG_CONFIG_DIRS": true, "DBUS_SESSION_BUS_ADDRESS": true,
	"GDK_SCALE": true, "GDK_DPI_SCALE": true, "GTK_IM_MODULE": true,
	"HTTPS_PROXY": true, "https_proxy": true, "NO_PROXY": true, "no_proxy": true,
}

// lcKey yerel ayar değişkenleri (LC_ALL, LC_CTYPE, …).
var lcKey = regexp.MustCompile(`^LC_[A-Z_]+$`)

func envAllowed(key string) bool { return envAllow[key] || lcKey.MatchString(key) }

// filterEnv izinli değişkenleri (her anahtarın ilk değeri, sıra korunur) ve sabit PATH'i döner. Biçimsiz girdi
// (`=` yok, boş anahtar) atılır. İdempotenttir: filterEnv(filterEnv(e)) == filterEnv(e).
func filterEnv(env []string) []string {
	out := make([]string, 0, len(env)+1)
	seen := map[string]bool{}
	for _, kv := range env {
		k, _, ok := strings.Cut(kv, "=")
		if !ok || k == "" || seen[k] || !envAllowed(k) {
			continue
		}
		seen[k] = true
		out = append(out, kv)
	}
	return append(out, fixedPath)
}

// needsReexec argüman varsa ya da ortam süzülmüş hâlinden farklıysa true (T4: argüman kabul edilmez; T5: liste dışı
// değişken). Süzülmüş ortamla ikinci açılışta false döner (döngü yok).
func needsReexec(env, args []string) bool {
	return len(args) > 1 || !slices.Equal(env, filterEnv(env))
}

// reexec `/proc/self/exe`'yi argümansız ve süzülmüş ortamla bir kez yeniden çalıştırır. Yalnız hata durumunda döner
// (çağıran çıkar; kirli ortamla devam edilmez).
func reexec() error {
	argv0 := "noktadestek"
	if len(os.Args) > 0 && os.Args[0] != "" {
		argv0 = os.Args[0]
	}
	return syscall.Exec("/proc/self/exe", []string{argv0}, filterEnv(os.Environ()))
}

// disableCoreDumps D-P28g-T2-4: RLIMIT_CORE=0 koşulsuz (exec'te korunur). PR_SET_DUMPABLE ölçümü K2'de.
func disableCoreDumps() error {
	return syscall.Setrlimit(syscall.RLIMIT_CORE, &syscall.Rlimit{})
}

// sessionKind oturum türü (§2): WAYLAND_DISPLAY doluysa Wayland, değilse DISPLAY ile X11, ikisi de yoksa "".
func sessionKind(getenv func(string) string) string {
	switch {
	case getenv("WAYLAND_DISPLAY") != "":
		return "wayland"
	case getenv("DISPLAY") != "":
		return "x11"
	}
	return ""
}

// ownedEntry yol (sembolik bağ izlenmeden) beklenen türde ve uid'e ait mi.
func ownedEntry(path string, uid int, mode os.FileMode) (os.FileInfo, bool) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, false
	}
	fi, err := os.Lstat(path)
	if err != nil || fi.Mode().Type() != mode {
		return nil, false
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	return fi, ok && int(st.Uid) == uid
}

// validRuntimeDir S-P28g-11: XDG_RUNTIME_DIR sembolik bağ değil, dizin, sahibi uid, kip 0700.
func validRuntimeDir(dir string, uid int) bool {
	fi, ok := ownedEntry(dir, uid, os.ModeDir)
	return ok && fi.Mode().Perm() == 0o700
}

// privateDir S-P28g-11 / §5.3: `$XDG_RUNTIME_DIR/noktadestek-<rastgele>` (0700, tmpfs); runtime dizini geçersizse ya
// da alt dizin doğrulanamazsa yedek `os.MkdirTemp("", "noktadestek-")` (TMPDIR süzüldüğünden /tmp). Kapanışta silinir.
func privateDir(runtimeDir string, uid int) (string, error) {
	if validRuntimeDir(runtimeDir, uid) {
		if d, err := os.MkdirTemp(runtimeDir, "noktadestek-"); err == nil {
			if validRuntimeDir(d, uid) {
				return d, nil
			}
			_ = os.RemoveAll(d)
		}
	}
	d, err := os.MkdirTemp("", "noktadestek-")
	if err != nil {
		return "", err
	}
	if !validRuntimeDir(d, uid) {
		_ = os.RemoveAll(d)
		return "", errors.New("özel geçici dizin doğrulanamadı")
	}
	return d, nil
}

// sessionBus D-P28g-T2-1: oturum veri yolu adresi tam olarak `unix:path=<doğrulanmış XDG_RUNTIME_DIR>/bus` olmalı ve
// yol uid'e ait bir soket olmalı; addr boşsa bu varsayılan kullanılır. Dönen adres (ok=true) ayarlanacak değerdir.
// ok=false → görüntü çalışabilir ama kontrol verilmez (K3: Wayland `WAYLAND_NO_CONTROL`, X11'de kilit izlenemez).
func sessionBus(addr, runtimeDir string, uid int) (string, bool) {
	if !validRuntimeDir(runtimeDir, uid) {
		return "", false
	}
	sock := runtimeDir + "/bus"
	want := "unix:path=" + sock
	if addr == "" {
		addr = want
	}
	if addr != want {
		return "", false
	}
	if _, ok := ownedEntry(sock, uid, os.ModeSocket); !ok {
		return "", false
	}
	return want, true
}

// applyEnv yeniden çalıştırmadan sonra C kitaplıkları yüklenmeden önce ayarlanan ortam (§5.1 T5, §5.3; K0s-1: os.Setenv
// libc environ'a yansır, g_setenv gerekmez). GStreamer kaydı ve önbellekler özel dizine; eklenti yolu ve tarayıcı sabit.
func applyEnv(priv, runtimeDir string, uid int) {
	for _, k := range []string{"GDK_CORE_DEVICE_EVENTS", "GDK_DEBUG", "GTK_DEBUG"} { // izin listesi dışı; açık savunma
		_ = os.Unsetenv(k)
	}
	if os.Getenv("DBUS_SESSION_BUS_ADDRESS") == "" {
		if addr, ok := sessionBus("", runtimeDir, uid); ok {
			_ = os.Setenv("DBUS_SESSION_BUS_ADDRESS", addr)
		}
	}
	_ = os.Setenv("XDG_CACHE_HOME", priv)
	_ = os.Setenv("GST_REGISTRY_1_0", filepath.Join(priv, "gst-registry.bin"))
	_ = os.Setenv("GST_PLUGIN_SYSTEM_PATH_1_0", glib.LibDir+"gstreamer-1.0")
	_ = os.Setenv("GST_PLUGIN_SCANNER_1_0", glib.LibDir+"gstreamer1.0/gstreamer-1.0/gst-plugin-scanner")
	if home, err := os.UserHomeDir(); err == nil { // K5 (§5.3): libpulse çerez dosyası oluşturmasın
		if c := files.PulseCookieEnv(home, priv); c != "" {
			_ = os.Setenv("PULSE_COOKIE", c)
		}
	}
}
