//go:build windows

package servis

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/mgr"
)

// Kaldırma (`--uninstall`; "Uygulamalar"ın UninstallString'i ya da ayar penceresi; mimari-p27 §5.3, AC-274). Onay →
// boruyla `unregister` (servis `device.unregister` gönderir; çevrimdışıysa sessizce geçer) → servis durdur/sil →
// Run, Uninstall, HKLM kaydı, olay kaynağı → `%ProgramData%\NoktaDestek Servis` (Gelen dahil) → Program Files klasörü.
// Program Files'taki ikili kendini silemeyeceği için önce `%SystemRoot%\Temp\NoktaDestekServis-kaldir-<rastgele>\`
// kopyasından (yalnız SY/BA yazar, SHA-256 denetimli; D-P27-K5, uninstall_copy_windows.go) yeniden çalışır; kopya ve
// klasörü her çıkış yolunda `MoveFileEx(DELAY_UNTIL_REBOOT)` ile ilk yeniden başlatmada silinir. Yükseltilmemiş
// açılış UAC ile yeniden başlar.

// UninstallUI kaldırma arayüzü kancaları (K7).
type UninstallUI interface {
	// Confirm "Gözetimsiz erişim kaldırılsın mı? Gelen dosyalar klasörü de silinir." onayı.
	Confirm() bool
	ShowError(msg string)
}

const programDirTries = 24

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
		return relaunchFromCopy(ui, self)
	}
	if IsUninstallTemp(self) {
		defer scheduleTempRemoval(self)
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
	return 0
}

// relaunchFromCopy güvenli kopyayı oluşturur ve kopya açık/sabit tutulurken aynı yetkiyle başlatır (ikinci UAC yok;
// kopya klasörüne orta bütünlükteki süreçler yazamaz). Başlatılamazsa klasör silinir.
func relaunchFromCopy(ui UninstallUI, self string) int {
	tmp, held, err := secureCopy(self)
	if err != nil {
		ui.ShowError("Kaldırma başlatılamadı.")
		return 1
	}
	code := relaunch(tmp, "open")
	held.Close()
	if code != 0 {
		_ = os.RemoveAll(filepath.Dir(tmp))
	}
	return code
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
		removeProgramDir(d)
	}
}

// removeProgramDir K7: kullanıcı oturumlarındaki tepsi/ayar penceresi süreçleri kurulu ikiliden çalışır ve HKLM kaydı
// silinince en geç ~3 sn'de çıkar; ikilinin kilidi kalkana kadar en çok ~6 sn yeniden denenir.
func removeProgramDir(d string) {
	for i := 0; i < programDirTries; i++ {
		if err := os.RemoveAll(d); err == nil {
			return
		}
		time.Sleep(250 * time.Millisecond)
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
