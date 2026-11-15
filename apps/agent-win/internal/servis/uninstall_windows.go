//go:build windows

package servis

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/mgr"
)

// Kaldırma (`--uninstall`; "Uygulamalar"ın UninstallString'i ya da ayar penceresi; mimari-p27 §5.3, AC-274). Onay →
// boruyla `unregister` (servis `device.unregister` gönderir; çevrimdışıysa sessizce geçer) → servis durdur/sil →
// Run, Uninstall, HKLM kaydı, olay kaynağı → `%ProgramData%\NoktaDestek Servis` (Gelen dahil) → Program Files klasörü.
// Program Files'taki ikili kendini silemeyeceği için önce `%TEMP%` kopyasından yeniden çalışır; geçici kopya
// `MoveFileEx(DELAY_UNTIL_REBOOT)` ile ilk yeniden başlatmada silinir. Yükseltilmemiş açılış UAC ile yeniden başlar.

// UninstallUI kaldırma arayüzü kancaları (K7).
type UninstallUI interface {
	// Confirm "Gözetimsiz erişim kaldırılsın mı? Gelen dosyalar klasörü de silinir." onayı.
	Confirm() bool
	ShowError(msg string)
}

// UninstallConfirmText onay metni (K7 aynı metni gösterir).
const UninstallConfirmText = "Nokta Destek gözetimsiz erişim kaldırılsın mı? Gelen dosyalar klasörü de silinir."

// Uninstall kaldırma; dönüş süreç çıkış kodu.
func Uninstall(ui UninstallUI, elevated bool) int {
	self, err := os.Executable()
	if err != nil {
		return 1
	}
	if !elevated {
		return relaunch(self, "runas")
	}
	if inProgramDir(self) {
		tmp, err := tempCopy(self)
		if err != nil {
			ui.ShowError("Kaldırma başlatılamadı.")
			return 1
		}
		return relaunch(tmp, "open")
	}
	if !ui.Confirm() {
		return 0
	}
	if resp, err := CallPipe(CmdUnregister); err == nil && resp.OK {
		OpenEventLog().Write(EvRevokedText(true))
	}
	if err := removeService(); err != nil {
		ui.ShowError("Servis durdurulamadı. Bilgisayarı yeniden başlatıp kaldırmayı tekrar deneyin.")
		return 1
	}
	uninstallLocal()
	if strings.Contains(filepath.Base(self), "-kaldir-") {
		p, err := windows.UTF16PtrFromString(self)
		if err == nil {
			_ = windows.MoveFileEx(p, nil, windows.MOVEFILE_DELAY_UNTIL_REBOOT)
		}
	}
	return 0
}

// uninstallLocal servis dışındaki tüm izleri siler (kurulum geri alma da kullanır); en iyi çaba.
func uninstallLocal() {
	_ = removeService()
	_ = deleteAppKeys()
	removeEventSource()
	if d, err := DataDir(); err == nil {
		_ = os.RemoveAll(d) // junction bağlantının kendisi silinir, hedefi izlenmez (os.RemoveAll, Go ≥ 1.23)
	}
	if d, err := ProgramDir(); err == nil {
		_ = os.RemoveAll(d)
	}
}

func removeService() error {
	if err := stopService(); err != nil && !errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return err
	}
	err := withService(func(s *mgr.Service) error { return s.Delete() })
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) || errors.Is(err, windows.ERROR_SERVICE_MARKED_FOR_DELETE) {
		return nil
	}
	return err
}

func inProgramDir(self string) bool {
	dir, err := ProgramDir()
	if err != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(filepath.Dir(self)), filepath.Clean(dir))
}

// tempCopy ikiliyi `%TEMP%\NoktaDestekServis-kaldir-<rastgele>.exe` olarak kopyalar.
func tempCopy(self string) (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	dst := filepath.Join(os.TempDir(), "NoktaDestekServis-kaldir-"+hex.EncodeToString(b[:])+".exe")
	return dst, copyFile(self, dst)
}

// relaunch ikiliyi `--uninstall` ile yeniden başlatır (verb "runas": UAC; "open": aynı yetki).
func relaunch(exe, verb string) int {
	v, err1 := windows.UTF16PtrFromString(verb)
	f, err2 := windows.UTF16PtrFromString(exe)
	a, err3 := windows.UTF16PtrFromString("--uninstall")
	if errors.Join(err1, err2, err3) != nil {
		return 1
	}
	if err := windows.ShellExecute(0, v, f, a, nil, windows.SW_SHOWNORMAL); err != nil {
		return 1
	}
	return 0
}
