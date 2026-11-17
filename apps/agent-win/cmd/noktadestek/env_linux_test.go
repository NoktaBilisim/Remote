//go:build linux

package main

import (
	"net"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
)

// S-P28g-5 / §15 D-P28g-T2-1: izin listesi; liste dışı (kitaplık/modül kaçırma, TLS kökü, HTTP vekili) süzülür, PATH
// sabit; işlem idempotent (ikinci açılışta yeniden çalıştırma yok).
func TestAC398P28gK1EnvAllowList(t *testing.T) {
	in := []string{
		"HOME=/home/a", "USER=a", "LANG=tr_TR.UTF-8", "LC_ALL=tr_TR.UTF-8", "LC_CTYPE=C", "DISPLAY=:0",
		"WAYLAND_DISPLAY=wayland-0", "XDG_RUNTIME_DIR=/run/user/1000", "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
		"HTTPS_PROXY=http://u:p@vekil:3128", "https_proxy=x", "NO_PROXY=a", "no_proxy=b", "GDK_SCALE=2", "GTK_IM_MODULE=ibus",
		"PATH=/home/a/bin:/usr/bin", "LD_PRELOAD=/tmp/x.so", "LD_LIBRARY_PATH=/tmp", "GTK_MODULES=x", "GTK3_MODULES=x",
		"GTK_PATH=/tmp", "GTK_DEBUG=all", "GDK_DEBUG=all", "GDK_CORE_DEVICE_EVENTS=1", "GDK_BACKEND=wayland",
		"GIO_MODULE_DIR=/tmp", "GDK_PIXBUF_MODULE_FILE=/tmp/x", "GSETTINGS_BACKEND=memory", "GST_PLUGIN_PATH=/tmp",
		"GST_PLUGIN_PATH_1_0=/tmp", "GST_REGISTRY_1_0=/tmp/r", "LIBGL_DRIVERS_PATH=/tmp", "__EGL_VENDOR_LIBRARY_DIRS=/tmp",
		"PULSE_SERVER=tcp:x", "SSL_CERT_FILE=/tmp/ca", "SSL_CERT_DIR=/tmp", "HTTP_PROXY=http://v", "http_proxy=x",
		"ALL_PROXY=socks5://v", "TMPDIR=/home/a/t", "LC_=x", "lc_all=x", "HOME=/ikinci", "=bos", "bozuk", "",
	}
	got := filterEnv(in)
	want := []string{
		"HOME=/home/a", "USER=a", "LANG=tr_TR.UTF-8", "LC_ALL=tr_TR.UTF-8", "LC_CTYPE=C", "DISPLAY=:0",
		"WAYLAND_DISPLAY=wayland-0", "XDG_RUNTIME_DIR=/run/user/1000", "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus",
		"HTTPS_PROXY=http://u:p@vekil:3128", "https_proxy=x", "NO_PROXY=a", "no_proxy=b", "GDK_SCALE=2", "GTK_IM_MODULE=ibus",
		"PATH=/usr/bin:/bin",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("filterEnv:\n got %q\nwant %q", got, want)
	}
	if !slices.Equal(filterEnv(got), got) {
		t.Fatal("idempotent olmalı")
	}
	// K0s-5: XTEST ayrımını silen değişken ve GDK/GTK hata ayıklama değişkenleri açıkça yok.
	for _, k := range []string{"GDK_CORE_DEVICE_EVENTS", "GDK_DEBUG", "GTK_DEBUG", "HTTP_PROXY", "ALL_PROXY", "SSL_CERT_FILE"} {
		for _, kv := range got {
			if strings.HasPrefix(kv, k+"=") {
				t.Errorf("%s süzülmeli", k)
			}
		}
	}
	if !needsReexec(in, []string{"x"}) {
		t.Fatal("kirli ortam yeniden çalıştırma ister")
	}
	if needsReexec(got, []string{"x"}) {
		t.Fatal("süzülmüş ortamla ikinci açılış yeniden çalıştırmamalı (döngü yok)")
	}
	if !needsReexec(got, []string{"x", "--restart", "y"}) {
		t.Fatal("T4: argüman varsa yeniden çalıştırılır (argüman kabul edilmez)")
	}
	if !needsReexec([]string{"HOME=/h"}, []string{"x"}) {
		t.Fatal("PATH sabit değilse yeniden çalıştırılır")
	}
	if !needsReexec([]string{"HOME=/h", "PATH=/usr/bin:/bin", "HOME=/x"}, []string{"x"}) {
		t.Fatal("yinelenen anahtar yeniden çalıştırma ister")
	}
}

func TestAC397P28gK1SessionKind(t *testing.T) {
	for _, c := range []struct{ w, d, want string }{{"wayland-0", ":0", "wayland"}, {"", ":0", "x11"}, {"", "", ""}} {
		get := func(k string) string {
			if k == "WAYLAND_DISPLAY" {
				return c.w
			}
			if k == "DISPLAY" {
				return c.d
			}
			return ""
		}
		if got := sessionKind(get); got != c.want {
			t.Errorf("%+v: %q", c, got)
		}
	}
}

// S-P28g-11: XDG_RUNTIME_DIR sembolik bağ değil, dizin, sahibi uid, 0700; değilse /tmp yedeği. Alt dizin 0700.
func TestAC401P28gK1PrivateDir(t *testing.T) {
	uid := os.Getuid()
	rt := t.TempDir()
	if err := os.Chmod(rt, 0o700); err != nil {
		t.Fatal(err)
	}
	d, err := privateDir(rt, uid)
	if err != nil || filepath.Dir(d) != rt || !strings.HasPrefix(filepath.Base(d), "noktadestek-") || !validRuntimeDir(d, uid) {
		t.Fatalf("runtime altında beklenirdi: %q %v", d, err)
	}
	link := filepath.Join(t.TempDir(), "baglanti")
	if err := os.Symlink(rt, link); err != nil {
		t.Fatal(err)
	}
	loose := t.TempDir()
	if err := os.Chmod(loose, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, bad := range map[string]string{"bos": "", "goreli": "run/user", "baglanti": link, "0755": loose,
		"yok": filepath.Join(rt, "yok"), "baska-sahip": rt} {
		u := uid
		if name == "baska-sahip" {
			u = uid + 1
		}
		if validRuntimeDir(bad, u) {
			t.Errorf("%s geçerli sayılmamalı", name)
		}
		d, err := privateDir(bad, u)
		if name == "baska-sahip" {
			continue // yedek de bu uid'e ait olmadığından reddedilir (aşağıda)
		}
		if err != nil || filepath.Dir(d) != os.TempDir() || !validRuntimeDir(d, uid) {
			t.Errorf("%s: /tmp yedeği beklenirdi: %q %v", name, d, err)
		}
		_ = os.RemoveAll(d)
	}
	if _, err := privateDir(rt, uid+1); err == nil {
		t.Error("başka uid için doğrulanamayan dizin hata vermeli")
	}
}

// D-P28g-T2-1: oturum veri yolu yalnız `unix:path=<XDG_RUNTIME_DIR>/bus`, uid'e ait soket; boşsa varsayılan.
func TestAC399P28gK1SessionBus(t *testing.T) {
	uid := os.Getuid()
	rt, err := os.MkdirTemp("/tmp", "rt-") // unix soket yolu kısa olmalı
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(rt) })
	if _, ok := sessionBus("", rt, uid); ok {
		t.Fatal("soket yokken kabul edilmemeli")
	}
	if err := os.WriteFile(filepath.Join(rt, "bus"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := sessionBus("", rt, uid); ok {
		t.Fatal("normal dosya soket değil")
	}
	_ = os.Remove(filepath.Join(rt, "bus"))
	l, err := net.Listen("unix", filepath.Join(rt, "bus"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = l.Close() })
	want := "unix:path=" + rt + "/bus"
	if got, ok := sessionBus("", rt, uid); !ok || got != want {
		t.Fatalf("varsayılan: %q %v", got, ok)
	}
	if got, ok := sessionBus(want, rt, uid); !ok || got != want {
		t.Fatalf("tam eşleşme: %q %v", got, ok)
	}
	other := t.TempDir()
	for _, bad := range []string{"unix:abstract=/tmp/dbus-x", "tcp:host=127.0.0.1,port=1", "unix:path=" + other + "/bus",
		want + ",guid=1", "unix:path=" + rt + "/../" + filepath.Base(rt) + "/bus", "unix:path=" + rt + "/bus2", "unix:path=/run/user/0/bus"} {
		if _, ok := sessionBus(bad, rt, uid); ok {
			t.Errorf("ret beklenirdi: %q", bad)
		}
	}
	if _, ok := sessionBus(want, rt, uid+1); ok {
		t.Fatal("başka sahip ret")
	}
	if err := os.Chmod(rt, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, ok := sessionBus(want, rt, uid); ok {
		t.Fatal("runtime dizini 0700 değilse ret")
	}
}

// D-P28g-T2-4: RLIMIT_CORE=0.
func TestAC401P28gK1CoreDumpsDisabled(t *testing.T) {
	if err := disableCoreDumps(); err != nil {
		t.Fatal(err)
	}
	var r syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_CORE, &r); err != nil || r.Cur != 0 || r.Max != 0 {
		t.Fatalf("RLIMIT_CORE %+v %v", r, err)
	}
}

// §5.1 T5 / §5.3: yeniden çalıştırma sonrası ortam — GStreamer kaydı ve önbellek özel dizinde, eklenti yolu sabit,
// XTEST ayrımını bozan değişken yok.
func TestAC401P28gK1ApplyEnv(t *testing.T) {
	priv := t.TempDir()
	t.Setenv("GDK_CORE_DEVICE_EVENTS", "1")
	t.Setenv("GDK_DEBUG", "x")
	t.Setenv("GTK_DEBUG", "x")
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", "")
	for _, k := range []string{"XDG_CACHE_HOME", "GST_REGISTRY_1_0", "GST_PLUGIN_SYSTEM_PATH_1_0", "GST_PLUGIN_SCANNER_1_0"} {
		t.Setenv(k, "")
	}
	applyEnv(priv, "", os.Getuid())
	for _, k := range []string{"GDK_CORE_DEVICE_EVENTS", "GDK_DEBUG", "GTK_DEBUG"} {
		if _, ok := os.LookupEnv(k); ok {
			t.Errorf("%s silinmeli", k)
		}
	}
	if os.Getenv("DBUS_SESSION_BUS_ADDRESS") != "" {
		t.Error("geçersiz runtime dizininde varsayılan veri yolu ayarlanmamalı")
	}
	if os.Getenv("XDG_CACHE_HOME") != priv || os.Getenv("GST_REGISTRY_1_0") != priv+"/gst-registry.bin" ||
		os.Getenv("GST_PLUGIN_SYSTEM_PATH_1_0") != "/usr/lib/x86_64-linux-gnu/gstreamer-1.0" ||
		os.Getenv("GST_PLUGIN_SCANNER_1_0") != "/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner" {
		t.Fatal("GStreamer/önbellek ortamı")
	}
}
