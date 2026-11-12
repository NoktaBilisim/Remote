//go:build windows

// Command noktadestek müşteri bilgisayarında çalışan Hızlı Destek istemcisidir (P6): güvenli açılış (DLL arama sırası,
// gömülü yapılandırma, kimlik) → açılış kararı (internal/launch: kod / firma dosyası / bilgisayar kaydı, P8c) → kod akışı
// (internal/flow) veya ana ekran + talep (internal/request) → paylaşım → en geç 3 sn içinde çıkış (AC-107). Arayüz
// internal/ui.
package main

import (
	"context"
	"errors"
	"os"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/dllsafe"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/ui"
)

// Çıkış kodları.
const (
	exitOK = iota
	exitDLLHarden
	exitConfig
	exitIdentity
	exitUI
)

// closeDelay AC-107: son ekran gösterildikten sonra kapanış ("3 sn içinde" — pay bırakıldı).
const closeDelay = 2500 * time.Millisecond

func main() {
	os.Exit(run())
}

func run() int {
	// G-08: başka hiçbir DLL yüklenmeden önce.
	if err := dllsafe.Harden(); err != nil {
		return exitDLLHarden
	}
	cfg, err := config.Load()
	if err != nil {
		ui.ShowError("Bu program hatalı derlenmiş (sunucu adresi yok). Teknisyeninizden yeni bir indirme bağlantısı isteyin.")
		return exitConfig
	}
	exe, fp, err := identity()
	if err != nil {
		ui.ShowError("Program dosyası okunamadı. Dosyayı yeniden indirip tekrar deneyin.")
		return exitIdentity
	}
	gate := &control.Gate{} // P7 izin kapısı: varsayılan kapalı (yalnız görüntüleme)
	u, err := ui.New(cfg.DisplayHost(), cfg.Version, fp, gate)
	if err != nil {
		ui.ShowError("Arayüz başlatılamadı.")
		return exitUI
	}
	defer u.Close()

	selfElevated := env.SelfElevated() // S7-9/K8: süreç ömrü boyunca sabit, açılışta bir kez ölçülür
	u.SetElevated(selfElevated)        // yerel kırmızı uyarı

	// P7: SendInput alıcısı, kapatma kısayolu (Ctrl+Shift+F12, yedek Ctrl+Shift+F11) ve yalnız kapı açıkken kurulan
	// yerel öncelik kancaları (S7-7).
	applier := input.NewApplier(gate, input.SendInputInjector{}, nil)
	host := input.Start(gate, u.HotkeyPressed)
	defer host.Stop()
	hotkey := ""
	if host.HotkeyErr == nil {
		hotkey = host.Hotkey.Label
	}
	u.SetHotkey(hotkey)

	client := api.New(cfg.ServerURL, cfg.Version)
	deps := flow.Deps{
		Host: cfg.DisplayHost(), Version: cfg.Version, Fingerprint: fp,
		API: client,
		Dial: func(ctx context.Context, cred signal.Credential) (flow.Conn, error) {
			return signal.Dial(ctx, client.HTTPClient(), cfg.ServerURL, cred)
		},
		NewPeer: func(ice []signal.IceServer, caps []string, h rtc.Handlers) (flow.Peer, error) {
			return rtc.New(ice, caps, h)
		},
		Monitors:    capture.Monitors,
		Capture:     capture.Open,
		DownloadDir: func() (string, error) { return windows.KnownFolderPath(windows.FOLDERID_Downloads, 0) },
		MOTW:        files.WriteMOTW,
		Logo:        client.Logo, // AC-98: yalnız gömülü sunucu kökeni, PNG/JPG ≤ 2 MB
		UI:          u,
		Events:      u.Events(),
		Gate:        gate,
		Hotkey:      hotkey,
		Input:       applier.Handle,
		SetInputMonitor: func(id int) {
			if r, ok := capture.MonitorRect(id); ok {
				applier.SetTarget(control.Rect{Left: r.Left, Top: r.Top, Right: r.Right, Bottom: r.Bottom}, input.VirtualScreen())
			}
		},
		EnvProbe:     env.Probe,
		SelfElevated: selfElevated, // K8: env.state.selfElevated (GRANTED audit'i, konsol rozeti)
	}
	store := rememberStore()
	ld := launch.Deps{Exe: exe, ServerURL: cfg.ServerURL, API: client, Flow: deps,
		Request: request.Deps{UI: u, Events: u.RequestEvents(), Version: cfg.Version, Logo: client.Logo,
			Dial: func(ctx context.Context, secret string) (request.Conn, error) {
				return request.Dial(ctx, client.HTTPClient(), cfg.ServerURL, secret)
			}}}
	if store != nil {
		ld.Store = store
	}
	// mimari-e10 §8.1: dosya adı + ağ yanıtı + bilgisayar kaydı → kod akışı / ana ekran (internal/launch).
	out := launch.Run(context.Background(), ld)
	if out.Message != (flow.Message{}) {
		if out.BindingChanged != "" {
			u.EndedNote(launch.ChangedText(out.BindingChanged)) // AC-187
		}
		u.Ended(out.Message)
		time.Sleep(closeDelay)
	}
	return exitOK
}

// rememberStore hatırlama dosyası deposu; LocalAppData bulunamazsa nil (kayıt ve hatırlama kapalı).
func rememberStore() *remember.Store {
	s, err := remember.DefaultStore()
	if err != nil {
		return nil
	}
	return s
}

// identity çalışan ikilinin yolu ve SHA-256 ilk 8 hanesi (AC-128).
func identity() (string, string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", "", err
	}
	f, err := os.Open(exe)
	if err != nil {
		return "", "", err
	}
	defer f.Close()
	fp, err := config.Fingerprint(f)
	if err != nil {
		return "", "", errors.Join(errors.New("parmak izi hesaplanamadı"), err)
	}
	return exe, fp, nil
}
