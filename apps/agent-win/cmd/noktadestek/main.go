//go:build windows

// Command noktadestek müşteri bilgisayarında çalışan Hızlı Destek istemcisidir (P6): güvenli açılış (DLL arama sırası,
// gömülü yapılandırma, kimlik) → kod (dosya adı veya elle) → resolve → karşılama/KVKK → join → lobi → admit → paylaşım →
// session.ended → en geç 3 sn içinde çıkış (AC-107). Akış internal/flow, arayüz internal/ui.
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
	"remote-support/agent-win/internal/dllsafe"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/pairing"
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
	u, err := ui.New(cfg.DisplayHost(), cfg.Version, fp)
	if err != nil {
		ui.ShowError("Arayüz başlatılamadı.")
		return exitUI
	}
	defer u.Close()

	client := api.New(cfg.ServerURL, cfg.Version)
	code, _ := pairing.FromFileName(exe) // AC-97: okunamazsa flow elle giriş ister
	out := flow.Run(context.Background(), flow.Deps{
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
	}, code)
	if out.Message != (flow.Message{}) {
		u.Ended(out.Message)
		time.Sleep(closeDelay)
	}
	return exitOK
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
