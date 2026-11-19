package servis

import (
	"errors"
	"strings"
)

// Mode çalışma kipi (mimari-p27 §5.1). Kip yalnız ilk argümandan ve tam eşleşmeyle okunur; bilinmeyen argüman ayar
// penceresidir (P20 G-P20-6 kalıbı). Komut satırından adres, kod veya bilet alınmaz.
type Mode int

const (
	ModeWindow    Mode = iota // argümansız: ayar penceresi (K7)
	ModeService               // --service: SCM, LocalSystem
	ModeHelper                // --helper: servis başlatır (K6)
	ModeTray                  // --tray: HKLM Run (K7)
	ModeInstall               // --install: UAC
	ModeUninstall             // --uninstall: "Uygulamalar"
	ModeEnable                // --enable: UAC, HKLM LocalEnabled=1
	// P29 (mimari-p29 §5.3, §14.3): yalnız LocalSystem; yapılandırma okunmaz, arayüz yok.
	ModeUpdateApply   // --update-apply: servisin başlattığı gözetmen (eski ikili)
	ModeUpdateRecover // --update-recover: SCM FailureActions RUN_COMMAND (exe.eski)
)

var modeArgs = map[string]Mode{
	"--service":   ModeService,
	"--helper":    ModeHelper,
	"--tray":      ModeTray,
	"--install":   ModeInstall,
	"--uninstall": ModeUninstall,
	"--enable":    ModeEnable,

	"--update-apply":   ModeUpdateApply,
	"--update-recover": ModeUpdateRecover,
}

// ParseMode os.Args'tan kipi seçer.
func ParseMode(args []string) Mode {
	if len(args) < 2 {
		return ModeWindow
	}
	if m, ok := modeArgs[args[1]]; ok {
		return m
	}
	return ModeWindow
}

// Kurulum adları (§5.3).
const (
	ServiceName     = "NoktaDestekServis"
	ServiceDisplay  = "Nokta Destek — Gözetimsiz Erişim"
	ExeName         = "NoktaDestekServis.exe"
	InstallDirName  = "NoktaDestek Servis" // %ProgramFiles% ve %ProgramData% altında
	IncomingDirName = "Gelen"
	Publisher       = "Nokta Bilişim"
	RegKeyPath      = `SOFTWARE\NoktaDestek\Servis`
	RunKeyPath      = `SOFTWARE\Microsoft\Windows\CurrentVersion\Run`
	UninstallKey    = `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\NoktaDestekServis`
	RunValueName    = "NoktaDestekServis"
)

// Klasör güvenlik tanımları (§5.3 r2, K-P27-15): tek çağrıda sahip + korumalı DACL.
const (
	DataDirSDDL     = "O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"
	IncomingDirSDDL = "O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;AU)"
)

var errQuote = errors.New("servis: yol tırnak içeremez")

func quoted(exe, arg string) (string, error) {
	if exe == "" || strings.ContainsRune(exe, '"') {
		return "", errQuote
	}
	return `"` + exe + `" ` + arg, nil
}

// ImagePath hizmet komut satırı: her zaman tırnaklı (D-P27-2).
func ImagePath(exe string) (string, error) { return quoted(exe, "--service") }

// RunCommand `HKLM\…\Run` değeri (tırnaklı, G-P20-6).
func RunCommand(exe string) (string, error) { return quoted(exe, "--tray") }

// UninstallCommand `UninstallString`.
func UninstallCommand(exe string) (string, error) { return quoted(exe, "--uninstall") }
