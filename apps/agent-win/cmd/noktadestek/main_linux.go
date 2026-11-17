//go:build linux

// Command noktadestek Linux Hızlı Destek istemcisidir (P28g, mimari-p28g §2, ADR-0038): açılış sertleştirmesi
// (RLIMIT_CORE=0 → ortam izin listesi + `/proc/self/exe` argümansız bir kez yeniden çalıştırma → oturum türü → özel
// geçici dizin + sabit ortam) → gömülü yapılandırma ve kimlik → sistem kitaplıkları (izin listeli mutlak yol,
// internal/linux/glib) → arayüz (internal/ui/gtk, K4) → kod akışı (internal/flow, Windows/macOS ile aynı). Argüman
// okunmaz (T4). Tepsi, gözetimsiz servis, kayıt ve talep Linux'ta yoktur (V52). stdout/stderr'e kod, ad, dosya adı ve
// hata ayrıntısı yazılmaz (S-P28g-11); tek çıktı grafik oturum yokken sabit metindir.
//
// K1 iskeleti: GTK arayüzü (K4) henüz yok; newUI exitUI ile çıkar. Yakalama (K2), girdi (K3), pano/yazdırma/dosya/ses
// (K5) deps_linux.go'da açık "henüz yok" hatasıyla bağlıdır.
package main

import (
	"context"
	"errors"
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

// errNoUI K1: GTK arayüzü K4'te gelir.
var errNoUI = errors.New("linux: arayüz henüz yok (P28g K4)")

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
	watchSignals(cleanup)
	if glib.Load() != nil {
		return exitLibs
	}
	gate := &control.Gate{} // arayüz, akış ve girdi aynı kapıyı paylaşır (K3/K4)
	u, events, err := newUI(gate)
	if err != nil {
		return exitUI
	}
	d := flowDeps(cfg, fp, api.New(cfg.ServerURL, cfg.Version), u, events, gate)
	out := flow.Run(context.Background(), d, launch.ExeCode())
	u.Ended(out.Message)
	time.Sleep(closeDelay)
	return exitOK
}

// newUI K4'te GTK arayüzünü (internal/ui/gtk) kurar; K1'de arayüz yoktur.
func newUI(*control.Gate) (flow.UI, <-chan flow.Event, error) { return nil, nil, errNoUI }

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
