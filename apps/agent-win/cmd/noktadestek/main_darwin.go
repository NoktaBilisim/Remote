//go:build darwin

// Command noktadestek macOS Hızlı Destek istemcisidir (P28f, mimari-p28f §2, ADR-0037): gömülü yapılandırma ve kimlik →
// sistem çerçeveleri (izin listeli mutlak yol) → AppKit arayüzü (internal/ui/mac) → kod akışı (internal/flow, Windows
// ile aynı) → son ekran ve en geç 3 sn içinde çıkış (AC-107). Ana goroutine ana iş parçacığına kilitlidir ve
// NSApplication döngüsünü çalıştırır; akış ayrı goroutine'dedir. Komut satırı argümanı okunmaz (T4; `--restart` K4'te
// launch/code_darwin.go'da). Tepsi, gözetimsiz servis, kayıt ve talep macOS'ta yoktur (V52).
package main

import (
	"context"
	"os"
	"runtime"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/mac"
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
	code := exitOK
	objc.Pool(func() {
		u, events, err := mac.New(cfg.DisplayHost(), cfg.Version, fp)
		if err != nil {
			code = exitUI
			return
		}
		d := flowDeps(cfg, fp, api.New(cfg.ServerURL, cfg.Version), u, events)
		go func() {
			out := flow.Run(context.Background(), d, "") // K4: kod klasör adından (launch/code_darwin.go)
			u.Ended(out.Message)
			time.Sleep(closeDelay)
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

// terminate NSApp'i ana kuyrukta sonlandırır (süreç çıkar). Kuyruk bağlanamazsa süreç doğrudan çıkar (AC-107).
func terminate(app objc.ID) {
	q, err := objc.MainQueue()
	if err == nil {
		err = objc.Async(q, func() { app.Send(objc.Sel("terminate:"), objc.ID(0)) })
	}
	if err != nil {
		os.Exit(exitOK)
	}
}
