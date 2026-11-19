//go:build windows

package servis

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

// `--update-apply` / `--update-recover` giriş noktaları (mimari-p29 §5.3, §14.3). Yapılandırma okunmaz, arayüz
// gösterilmez (oturum 0'da asılı iletişim kutusu olmasın); LocalSystem değilse sessiz çıkış. Yollar sabittir: kurulu
// ikili (Program Files) ve `%ProgramData%\NoktaDestek Servis\Guncelleme`.

// RunUpdateApply gözetmen kipi.
func RunUpdateApply() int {
	sup, done, err := newSupervisor()
	if err != nil {
		return ApplyFailed
	}
	defer done()
	return sup.Apply()
}

// RunUpdateRecover önyükleme kurtarma kancası (SCM RUN_COMMAND).
func RunUpdateRecover() int {
	sup, done, err := newSupervisor()
	if err != nil {
		return ApplyFailed
	}
	defer done()
	return sup.Recover()
}

func newSupervisor() (*Supervisor, func(), error) {
	dataDir, err1 := DataDir()
	exe, err2 := InstalledExe()
	if err := errors.Join(err1, err2); err != nil {
		return nil, nil, err
	}
	dir := UpdateDir(dataDir)
	events := OpenEventLog()
	return &Supervisor{Sys: &winApplySys{dataDir: dataDir, dir: dir, exe: exe}, Store: newStateStore(dir), Events: events},
		events.Close, nil
}

type winApplySys struct {
	dataDir, dir, exe string
}

// IsLocalSystem süreç jetonunun kullanıcısı S-1-5-18 mi.
func (w *winApplySys) IsLocalSystem() bool { return isLocalSystem() }

func isLocalSystem() bool {
	tu, err := windows.GetCurrentProcessToken().GetTokenUser()
	return err == nil && tu.User.Sid.String() == SIDSystem
}

func (w *winApplySys) AcquireSupervisor() (func(), bool) { return acquireNamed(supervisorMutexName) }

func (w *winApplySys) PrepareDir() (bool, error) { return prepareUpdateDir(w.dataDir) }

func (w *winApplySys) ReadNonce() (string, error) {
	f, err := os.Open(filepath.Join(w.dir, nonceFileName))
	if err != nil {
		return "", err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 64))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

func (w *winApplySys) CopyStagedToNew(sha string) error { return copyStaged(w.dir, w.exe, sha) }

func (w *winApplySys) QueryFailureActions() (RecoveryBackup, error) { return queryRecovery() }

func (w *winApplySys) SetRecoverActions() error { return setRecoverActions(w.exe) }

func (w *winApplySys) RestoreFailureActions(b *RecoveryBackup) error { return restoreRecovery(b) }

func (w *winApplySys) StopService() error { return stopService() }

// StartService zaten çalışıyorsa hata sayılmaz.
func (w *winApplySys) StartService() error {
	err := startService()
	if errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
		return nil
	}
	return err
}

func (w *winApplySys) ServiceStopped() (bool, error) {
	stopped := false
	err := withService(func(s *mgr.Service) error {
		st, err := s.Query()
		stopped = err == nil && st.State == svc.Stopped
		return err
	})
	return stopped, err
}

func (w *winApplySys) Swap() error { return swapExe(w.exe) }

func (w *winApplySys) RollbackFiles() error { return rollbackExe(w.exe) }

func (w *winApplySys) RemoveStaged() { removeStaged(w.dir) }

func (w *winApplySys) RemoveNew() { _ = removeIfExists(w.exe + exeNewSuffix) }
