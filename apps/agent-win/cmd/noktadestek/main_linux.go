//go:build linux

// Command noktadestek Linux Hızlı Destek istemcisidir (P28g, mimari-p28g §2, ADR-0038): açılış sertleştirmesi
// (RLIMIT_CORE=0 → ortam izin listesi + `/proc/self/exe` argümansız bir kez yeniden çalıştırma → oturum türü → özel
// geçici dizin + sabit ortam) → gömülü yapılandırma ve kimlik → sistem kitaplıkları (izin listeli mutlak yol,
// internal/linux/glib) → arayüz (internal/ui/gtk, K4) → kod akışı (internal/flow, Windows/macOS ile aynı). Argüman
// okunmaz (T4). Tepsi, gözetimsiz servis, kayıt ve talep Linux'ta yoktur (V52). stdout/stderr'e kod, ad, dosya adı ve
// hata ayrıntısı yazılmaz (S-P28g-11); tek çıktı grafik oturum yokken sabit metindir.
//
// K4: arayüz internal/ui/gtk (GTK ana döngüsü ana iş parçacığında). Yakalama (K2), girdi (K3), pano/yazdırma/dosya/ses
// (K5) deps_linux.go'da açık "henüz yok" hatasıyla bağlıdır.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/linux/glib"
	"remote-support/agent-win/internal/ui/gtk"
)

// GTK yalnız ana iş parçacığında çalışır: main goroutine'i init'te ana iş parçacığına kilitlenir (§2).
func init() { runtime.LockOSThread() }

// Çıkış kodları. exitNoDisplay = 2 (§2: grafik oturum yok → stderr + çıkış 2).
const (
	exitOK        = 0
	exitHarden    = 1 // RLIMIT_CORE, yeniden çalıştırma ya da özel dizin kurulamadı (fail-closed)
	exitNoDisplay = 2
	exitConfig    = 3
	exitIdentity  = 4
	exitLibs      = 5
	exitUI        = 6
)

// closeDelay AC-107: son ekran gösterildikten sonra kapanış ("3 sn içinde" — pay bırakıldı).
const closeDelay = 2500 * time.Millisecond

func main() { os.Exit(run()) }

// run açılış sırası (mimari-p28g §5.1 T4/T5, §5.3). Özel dizin her çıkış yolunda silinir.
func run() int {
	if disableCoreDumps() != nil {
		return exitHarden
	}
	if needsReexec(os.Environ(), os.Args) {
		_ = reexec() // yalnız hatada döner: kirli ortamla devam edilmez
		return exitHarden
	}
	if sessionKind(os.Getenv) == "" {
		fmt.Fprintln(os.Stderr, flow.LinuxTexts.NoDisplay)
		return exitNoDisplay
	}
	cfg, err := config.Load()
	if err != nil {
		return exitConfig
	}
	_, fp, err := identity()
	if err != nil {
		return exitIdentity
	}
	uid, runtimeDir := os.Getuid(), os.Getenv("XDG_RUNTIME_DIR")
	priv, err := privateDir(runtimeDir, uid)
	if err != nil {
		return exitHarden
	}
	cleanup := func() { _ = os.RemoveAll(priv) }
	defer cleanup()
	applyEnv(priv, runtimeDir, uid)
	if sessionKind(os.Getenv) == "x11" {
		_ = disableDumpable() // §5.3 D-P28g-T2-4 (a): yalnız X11 (Wayland'de portal reddediyor; implementation.md)
	}
	watchSignals(cleanup)
	if glib.Load() != nil {
		return exitLibs
	}
	silenceStdio()          // S-P28g-11: GLib/GTK uyarıları dahil hiçbir şey stdout/stderr'e düşmez (geri çağrısız; K4)
	gate := &control.Gate{} // arayüz, akış ve girdi aynı kapıyı paylaşır (K3/K4)
	u, events, err := newUI(cfg, fp, sessionKind(os.Getenv) == "wayland", gate)
	if err != nil {
		return exitUI
	}
	d := flowDeps(cfg, fp, api.New(cfg.ServerURL, cfg.Version), u, events, gate)
	// GTK ana iş parçacığında (init'te kilitli), akış ayrı goroutine'de (darwin kalıbı); kapanış glib.Post ile.
	go func() {
		out := flow.Run(context.Background(), d, launch.ExeCode())
		u.Ended(out.Message)
		time.Sleep(closeDelay)
		u.Quit()
	}()
	u.Run()
	return exitOK
}

// newUI GTK arayüzü (internal/ui/gtk): XInitThreads → x11 arka ucu → gtk_init_check → sabit tema. localClick kararı
// (gtk.ClickGuard) K3'ün input.LinuxClickGuard'ıdır (gtkGuard uyarlayıcısı).
func newUI(cfg config.Config, fp string, wayland bool, gate *control.Gate) (*gtk.UI, <-chan flow.Event, error) {
	return gtk.New(gtk.Options{Host: cfg.DisplayHost(), Version: cfg.Version, Fingerprint: fp,
		ServerURL: cfg.ServerURL.String(), TestFlag: cfg.TestBuild, Wayland: wayland, Gate: gate,
		WaylandViewOnly: wayland && !cfg.WaylandControl, // K10 §5.2b m.7
		Guard:           gtkGuard{clickGuard}})          // §5.2a m.3–m.5 (K3, control_linux.go)
}

// silenceStdio fd 1 ve 2 /dev/null'a yönlendirilir (dup3; fd'ler kapatılmaz, boşalan numara sokete verilmez). GLib
// varsayılan log işleyicisi stdout/stderr'e yazdığından bu, Go geri çağrısı kurmadan (ADR-0038 m.2) S-P28g-11'in
// "sessiz işleyici" karşılığıdır. Açılamazsa olduğu gibi kalır (yalnız log sızıntısı riski; işlev etkilenmez).
func silenceStdio() {
	fd, err := syscall.Open("/dev/null", syscall.O_WRONLY|syscall.O_CLOEXEC, 0)
	if err != nil {
		return
	}
	_ = syscall.Dup3(fd, 1, 0)
	_ = syscall.Dup3(fd, 2, 0)
	if fd > 2 {
		_ = syscall.Close(fd)
	}
}

// watchSignals SIGHUP yok sayılır (terminal kapanınca oturum düşmez, §2); SIGTERM/SIGINT'te özel dizin silinip süreç
// çıkar (AC-401).
func watchSignals(cleanup func()) {
	signal.Ignore(syscall.SIGHUP)
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-ch
		cleanup()
		os.Exit(exitOK)
	}()
}
