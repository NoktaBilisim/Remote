//go:build darwin

// Command noktadestek macOS Hızlı Destek istemcisidir (P28f, mimari-p28f §2, ADR-0037): gömülü yapılandırma ve kimlik →
// sistem çerçeveleri (izin listeli mutlak yol) → AppKit arayüzü (internal/ui/mac) → kod akışı (internal/flow, Windows
// ile aynı) → son ekran ve en geç 3 sn içinde çıkış (AC-107). Ana goroutine ana iş parçacığına kilitlidir ve
// NSApplication döngüsünü çalıştırır; akış ayrı goroutine'dedir. Tek okunan argüman `--restart <belirteç>`tir (T4, §5.3;
// start_darwin.go). Tepsi, gözetimsiz servis, kayıt ve talep macOS'ta yoktur (V52).
package main

import (
	"context"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/ui/mac"
	"remote-support/agent-win/internal/update"
)

// AppKit yalnız ana iş parçacığında çalışır: main goroutine'i init'te ana iş parçacığına kilitlenir.
func init() { runtime.LockOSThread() }

// Çıkış kodları (Windows ile aynı anlam; DLL sertleştirmesinin macOS karşılığı izin listeli yükleme, objc.Open).
const (
	exitOK = iota
	exitFrameworks
	exitConfig
	exitIdentity
	exitUI
)

// closeDelay AC-107: son ekran gösterildikten sonra kapanış ("3 sn içinde" — pay bırakıldı).
const closeDelay = 2500 * time.Millisecond

func main() { os.Exit(run()) }

// run kurulum → arayüz → NSApplication döngüsü (akış bitince uygulama sonlandırılır).
func run() int {
	app, err := startApp()
	if err != nil {
		return exitFrameworks
	}
	cfg, err := config.Load()
	if err != nil {
		return exitConfig
	}
	_, fp, err := identity()
	if err != nil {
		return exitIdentity
	}
	_ = files.CleanTraces() // AC-394: önceki (çökmüş) oturumdan kalan izler
	watchSignals()
	client := api.New(cfg.ServerURL, cfg.Version)
	// P29 K8 (K-P29-10, D-6): macOS bugün yalnız bildirir; paket inmez, diske bir şey yazılmaz.
	bundle, translocated := launch.BundleLocation()
	upd := newUpdater(cfg, client, update.MacReplacer{Bundle: bundle, Translocated: translocated}, "", nil, nil)
	code := exitOK
	objc.Pool(func() {
		gate := &control.Gate{} // arayüz ("Kontrolü kapat", gösterge fail-closed) ve akış/girdi aynı kapıyı paylaşır
		u, events, err := mac.New(mac.Options{Host: cfg.DisplayHost(), Version: cfg.Version, Fingerprint: fp,
			TestBuild: cfg.TestBuild, TeamID: cfg.TeamID, Gate: gate})
		if err != nil {
			code = exitUI
			return
		}
		d := flowDeps(cfg, fp, client, u, events, gate)
		go func() {
			ctx := context.Background()
			initial, ok := startCode(ctx, u) // K4: yeniden başlatma dosyası / klasör adı + Ekran Kaydı rehberi
			if !ok {
				terminate(app)
				return
			}
			upd.Begin()
			upd.Start(ctx)
			out := flow.Run(ctx, d, initial)
			upd.End()
			u.Ended(withUpdateNotice(out.Message, upd))
			closed := make(chan struct{})
			go func() { upd.Close(updateCloseTimeout); close(closed) }()
			time.Sleep(closeDelay)
			<-closed
			terminate(app)
		}()
		app.Send(objc.Sel("run"))
	})
	return code
}

// startApp Foundation + AppKit'i izin listeli mutlak yoldan yükler ve paylaşılan NSApplication'ı döner.
func startApp() (objc.ID, error) {
	for _, fw := range []string{"Foundation", "AppKit"} {
		if _, err := objc.Framework(fw); err != nil {
			return 0, err
		}
	}
	c, err := objc.GetClass("NSApplication")
	if err != nil {
		return 0, err
	}
	return objc.ID(c).Send(objc.Sel("sharedApplication")), nil
}

// watchSignals SIGTERM/SIGINT'te izler temizlenip süreç çıkar (CI iz testi uygulamayı SIGTERM ile kapatır; AC-394).
func watchSignals() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-ch
		_ = files.CleanTraces()
		os.Exit(exitOK)
	}()
}

// terminate NSApp'i ana kuyrukta sonlandırır (süreç çıkar). Kuyruk bağlanamazsa süreç doğrudan çıkar (AC-107).
func terminate(app objc.ID) {
	_ = files.CleanTraces() // AC-394: terminate:'ten hemen önce (Saved Application State, Metal önbelleği vb.)
	q, err := objc.MainQueue()
	if err == nil {
		err = objc.Async(q, func() { app.Send(objc.Sel("terminate:"), objc.ID(0)) })
	}
	if err != nil {
		os.Exit(exitOK)
	}
}
