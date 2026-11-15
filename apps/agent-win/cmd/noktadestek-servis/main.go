//go:build windows

// Command noktadestek-servis gözetimsiz erişim ikilisidir (`NoktaDestekServis.exe`, P27; mimari-p27 §5.1): tek ikili,
// kipleri ilk argümandan seçer. Kullanıcının gördüğü tek şey ayar penceresidir (K7); `--service` SCM, `--helper`
// servis tarafından başlatılır (K6). Tüm kiplerde ilk iş güvenli DLL arama yoludur (AC-341); sunucu adresi yalnız
// derleme zamanında gömülüdür (`-ldflags -X config.serverURL`, AC-340).
package main

import (
	"context"
	"os"

	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/dllsafe"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/servis"
	"remote-support/agent-win/internal/servisui"
	"remote-support/agent-win/internal/ui"
)

// Çıkış kodları.
const (
	exitOK = iota
	exitDLLHarden
	exitConfig
	exitFailed
	exitUnavailable // kip bu derlemede henüz bağlı değil (K6/K7 kancası boş)
)

// Kip kancaları: K6 (`--helper`) ve K7 (ayar penceresi, tepsi, kod iletişim kutusu, kaldırma onayı) kendi
// paketlerini burada bağlar. Boş kanca → exitUnavailable (sessiz; servis/kurulum çekirdeği K5'tedir).
var (
	runHelper   func(cfg config.Config) int
	runUI       func(mode servis.Mode, cfg config.Config) int = servisui.Run
	installUI   servis.InstallUI                              = &servisui.InstallDialog{}
	uninstallUI servis.UninstallUI                            = servisui.UninstallDialog{}
)

func main() {
	if err := dllsafe.Harden(); err != nil { // G-08/AC-341: kip ayrıştırmadan ve başka DLL yüklenmeden önce
		os.Exit(exitDLLHarden)
	}
	os.Exit(run(servis.ParseMode(os.Args)))
}

func run(mode servis.Mode) int {
	cfg, err := config.Load()
	if err != nil {
		if mode != servis.ModeService && mode != servis.ModeHelper {
			ui.ShowError("Bu program hatalı derlenmiş (sunucu adresi yok). Destek firmanızdan yeni indirme isteyin.")
		}
		return exitConfig
	}
	switch mode {
	case servis.ModeService:
		return servis.RunService(cfg)
	case servis.ModeHelper:
		if runHelper == nil {
			return exitUnavailable
		}
		return runHelper(cfg)
	case servis.ModeInstall:
		if installUI == nil {
			return exitUnavailable
		}
		return servis.Install(context.Background(), cfg, installUI)
	case servis.ModeUninstall:
		if uninstallUI == nil {
			return exitUnavailable
		}
		return servis.Uninstall(uninstallUI, env.SelfElevated())
	case servis.ModeEnable:
		return enable()
	}
	if runUI == nil {
		return exitUnavailable
	}
	return runUI(mode, cfg)
}

// enable `--enable` (UAC ile yükseltilmiş): HKLM LocalEnabled=1. Borudan ya da sunucudan açma yolu yoktur (AC-295).
func enable() int {
	if !env.SelfElevated() {
		ui.ShowError("Gözetimsiz erişimi açmak için yönetici onayı gerekir.")
		return exitFailed
	}
	if err := servis.SetLocalEnabled(true); err != nil {
		ui.ShowError("Gözetimsiz erişim açılamadı. Program kurulu mu?")
		return exitFailed
	}
	return exitOK
}
