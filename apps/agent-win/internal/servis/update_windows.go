//go:build windows

package servis

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc/mgr"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/diag"
	"remote-support/agent-win/internal/update"
)

// P29 servis güncellemesinin Windows tarafı (mimari-p29 §5.3, §14.3). K0s spike'ında gerçek Windows'ta doğrulanacak
// davranışlar docs/implementation.md "P29-K0s/K7" listesindedir (K11 staging / Windows CI).

// Adlandırılmış nesneler: gözetmen tekilliği (varlık anlamı, T-4) ve durum.json oku-değiştir-yaz kilidi (sahiplik anlamı).
// DACL yalnız SY (sahip belirtilmez: oluşturanın varsayılanı); oluşturan süreç tutamacı yine alır (DACL yalnız sonraki
// açmalarda denetlenir).
const (
	supervisorMutexName = `Global\NoktaDestekServisUpdate`
	stateMutexName      = `Global\NoktaDestekServisDurum`
	updateMutexSDDL     = "D:P(A;;GA;;;SY)"
	stateLockWait       = 10 * time.Second
)

// UpdateDir `%ProgramData%\NoktaDestek Servis\Guncelleme`.
func UpdateDir(dataDir string) string { return filepath.Join(dataDir, UpdateDirName) }

// newUpdater servis güncelleyicisini kurar; sürüm ayrıştırılamazsa nil (güncelleme kapalı).
func newUpdater(cfg config.Config, exe, dataDir string, client *DeviceClient, core *Core, events EventSink) *Updater {
	running, err := update.ParseVersion(cfg.Version)
	if err != nil {
		return nil
	}
	dir := UpdateDir(dataDir)
	return &Updater{Trust: cfg.Update, Running: running, HTTP: api.New(cfg.ServerURL, cfg.Version).HTTPClient(),
		Origin: cfg.ServerURL, UserAgent: "NoktaDestek/" + cfg.Version, Store: newStateStore(dir),
		Sys: &winUpdateSys{dataDir: dataDir, dir: dir, exe: exe}, Events: events, Link: client, Session: core}
}

func newStateStore(dir string) *StateStore {
	return &StateStore{Dir: dir, Lock: lockState, Replace: replaceWriteThrough, Open: openShareDelete}
}

// openShareDelete okuma tutamacı FILE_SHARE_DELETE ile (os.Open vermez; açık okuyucu MoveFileEx değiştirmesini engellerdi).
func openShareDelete(path string) (*os.File, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|
		windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), path), nil
}

// replaceWriteThrough atomik değiştirme (MoveFileEx REPLACE_EXISTING|WRITE_THROUGH).
func replaceWriteThrough(from, to string) error {
	return moveFile(from, to, windows.MOVEFILE_REPLACE_EXISTING)
}

func moveFile(from, to string, flags uint32) error {
	f, err1 := windows.UTF16PtrFromString(from)
	t, err2 := windows.UTF16PtrFromString(to)
	if err := errors.Join(err1, err2); err != nil {
		return err
	}
	return windows.MoveFileEx(f, t, flags|windows.MOVEFILE_WRITE_THROUGH)
}

func mutexAttrs() (*windows.SecurityAttributes, error) {
	sd, err := windows.SecurityDescriptorFromString(updateMutexSDDL)
	if err != nil {
		return nil, err
	}
	return &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}, nil
}

// acquireNamed varlık anlamı: nesneyi biz oluşturursak sahibiz; zaten varsa ya da her hata → alınamadı.
func acquireNamed(name string) (func(), bool) {
	sa, err := mutexAttrs()
	if err != nil {
		return nil, false
	}
	n, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, false
	}
	h, err := windows.CreateMutex(sa, false, n)
	if err != nil {
		if h != 0 {
			_ = windows.CloseHandle(h)
		}
		return nil, false
	}
	return func() { _ = windows.CloseHandle(h) }, true
}

// supervisorAlive nesneyi oluşturmadan var mı diye bakar (erişim reddi de "var" sayılır).
func supervisorAlive() bool {
	n, err := windows.UTF16PtrFromString(supervisorMutexName)
	if err != nil {
		return true
	}
	h, err := windows.OpenMutex(windows.SYNCHRONIZE, false, n)
	if err == nil {
		_ = windows.CloseHandle(h)
		return true
	}
	return !errors.Is(err, windows.ERROR_FILE_NOT_FOUND)
}

// lockState durum.json kilidi: sahiplik anlamlı mutex (iş parçacığına bağlı → OS iş parçacığı kilitlenir).
func lockState() (func(), error) {
	sa, err := mutexAttrs()
	if err != nil {
		return nil, err
	}
	n, err := windows.UTF16PtrFromString(stateMutexName)
	if err != nil {
		return nil, err
	}
	runtime.LockOSThread()
	h, err := windows.CreateMutex(sa, false, n)
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		runtime.UnlockOSThread()
		return nil, err
	}
	r, err := windows.WaitForSingleObject(h, uint32(stateLockWait.Milliseconds()))
	if err != nil || (r != windows.WAIT_OBJECT_0 && r != windows.WAIT_ABANDONED) {
		_ = windows.CloseHandle(h)
		runtime.UnlockOSThread()
		return nil, fmt.Errorf("servis: durum kilidi alınamadı: %w", errors.Join(err, windows.ERROR_TIMEOUT))
	}
	return func() {
		_ = windows.ReleaseMutex(h)
		_ = windows.CloseHandle(h)
		runtime.UnlockOSThread()
	}, nil
}

// prepareUpdateDir `Guncelleme\`: yoksa createSecureDir(DataDirSDDL); varsa VerifyDir (T-6): reparse değil, sahip SY/BA,
// DACL korumalı ve yalnız SY/BA ACE. Değilse silinir ve yeniden oluşturulur (recreated → olay 1012).
func prepareUpdateDir(dataDir string) (bool, error) {
	dir := UpdateDir(dataDir)
	if _, err := os.Lstat(dir); errors.Is(err, os.ErrNotExist) {
		return false, createSecureDir(dir, DataDirSDDL)
	} else if err != nil {
		return false, err
	}
	if verifyUpdateDir(dir) == nil {
		return false, nil
	}
	if err := removeUnsafeDir(dir); err != nil {
		return true, err
	}
	return true, createSecureDir(dir, DataDirSDDL)
}

func verifyUpdateDir(dir string) error {
	attrs, err := reparseAttrs(dir)
	if err != nil {
		return err
	}
	if attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || attrs&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		return fmt.Errorf("%w: bağlantı noktası ya da klasör değil", ErrFolderUnsafe)
	}
	d, err := diag.OpenDir(dir, false) // üst klasör + klasör sabitlenir, reparse reddedilir
	if err != nil {
		return fmt.Errorf("%w: %w", ErrFolderUnsafe, err)
	}
	d.Close()
	return verifyDir(dir, DataDirSDDL)
}

// reparseAttrs yolu bağlantıyı izlemeden açar (FILE_FLAG_OPEN_REPARSE_POINT) ve özniteliklerini döner.
func reparseAttrs(path string) (uint32, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	h, err := windows.CreateFile(p, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|
		windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING,
		windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return 0, err
	}
	defer func() { _ = windows.CloseHandle(h) }()
	var fi windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(h, &fi); err != nil {
		return 0, err
	}
	return fi.FileAttributes, nil
}

// removeUnsafeDir bağlantı noktasıysa yalnız bağlantıyı (hedefi değil), değilse klasörü içeriğiyle siler.
func removeUnsafeDir(dir string) error {
	if attrs, err := reparseAttrs(dir); err == nil && attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		p, err := windows.UTF16PtrFromString(dir)
		if err != nil {
			return err
		}
		if attrs&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
			return windows.RemoveDirectory(p)
		}
		return windows.DeleteFile(p)
	}
	return os.RemoveAll(dir)
}

// createExclusive CREATE_NEW + paylaşımsız (share=0) yazma tutamacı; bağlantı izlenmez.
func createExclusive(path string) (*os.File, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_WRITE, 0, nil, windows.CREATE_NEW,
		windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), path), nil
}

func removeIfExists(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

// ---- UpdateSys ----

type winUpdateSys struct {
	dataDir, dir, exe string
}

func (w *winUpdateSys) PrepareDir() (bool, error) { return prepareUpdateDir(w.dataDir) }

type stagedFile struct{ f *os.File }

func (s *stagedFile) Write(p []byte) (int, error) { return s.f.Write(p) }
func (s *stagedFile) Commit() error               { return errors.Join(s.f.Sync(), s.f.Close()) }
func (s *stagedFile) Abort() {
	_ = s.f.Close()
	_ = os.Remove(s.f.Name())
}

func (w *winUpdateSys) CreateStaged() (StagedFile, error) {
	path := filepath.Join(w.dir, stagedFileName)
	if err := removeIfExists(path); err != nil { // önceki denemenin artığı (T-6)
		return nil, err
	}
	f, err := createExclusive(path)
	if err != nil {
		return nil, err
	}
	return &stagedFile{f: f}, nil
}

func (w *winUpdateSys) RemoveStaged() { removeStaged(w.dir) }

func removeStaged(dir string) {
	_ = removeIfExists(filepath.Join(dir, stagedFileName))
	_ = removeIfExists(filepath.Join(dir, nonceFileName))
}

func (w *winUpdateSys) WriteNonce(nonce string) error {
	tmp := filepath.Join(w.dir, nonceFileName+".yeni")
	if err := os.WriteFile(tmp, []byte(nonce), 0o600); err != nil {
		return err
	}
	return replaceWriteThrough(tmp, filepath.Join(w.dir, nonceFileName))
}

func (w *winUpdateSys) PlatformSignature() error {
	return platformSignature(w.exe, filepath.Join(w.dir, stagedFileName))
}

func (w *winUpdateSys) SupervisorAlive() bool { return supervisorAlive() }

// LaunchSupervisor kurulu ikiliyi `--update-apply` ile başlatır: pencere yok, ayrı süreç grubu, job dışı (servis bir
// job'daysa CREATE_BREAKAWAY_FROM_JOB; izin yoksa bayraksız yeniden denenir — K0s). Argüman yalnız kip; yol/adres yok.
func (w *winUpdateSys) LaunchSupervisor() (func(), error) {
	start := func(flags uint32) (*exec.Cmd, error) {
		cmd := exec.Command(w.exe, "--update-apply")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true,
			CreationFlags: windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP | flags}
		return cmd, cmd.Start()
	}
	cmd, err := start(windows.CREATE_BREAKAWAY_FROM_JOB)
	if err != nil {
		cmd, err = start(0)
	}
	if err != nil {
		return nil, err
	}
	return func() { _ = cmd.Wait() }, nil
}

func (w *winUpdateSys) RestoreFailureActions(b *RecoveryBackup) error { return restoreRecovery(b) }

func (w *winUpdateSys) Cleanup() error {
	var errs []error
	for _, s := range []string{exeOldSuffix, exeBrokenSuffix, exeNewSuffix} {
		errs = append(errs, removeIfExists(w.exe+s))
	}
	return errors.Join(errs...)
}

func (w *winUpdateSys) SetDisplayVersion(v string) { setDisplayVersion(v) }

// setDisplayVersion Uninstall `DisplayVersion` farklıysa yazar (AC-481 öz-onarım; anahtar yoksa dokunulmaz).
func setDisplayVersion(v string) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, UninstallKey, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return
	}
	defer func() { _ = k.Close() }()
	if cur, _, err := k.GetStringValue("DisplayVersion"); err == nil && cur == v {
		return
	}
	_ = k.SetStringValue("DisplayVersion", v)
}

// ---- SCM kurtarma eylemleri (§14.3 m.3, R2-1) ----

// defaultRecoveryActions kurulum varsayılanı: 3×10 sn yeniden başlat, sayaç 24 sa'te sıfırlanır.
func defaultRecoveryActions() ([]mgr.RecoveryAction, uint32) {
	return []mgr.RecoveryAction{{Type: mgr.ServiceRestart, Delay: recoveryDelay},
			{Type: mgr.ServiceRestart, Delay: recoveryDelay}, {Type: mgr.ServiceRestart, Delay: recoveryDelay}},
		uint32((24 * time.Hour).Seconds())
}

// recoverCommand `"<kurulu yol>.eski" --update-recover`.
func recoverCommand(exe string) (string, error) { return quoted(exe+exeOldSuffix, "--update-recover") }

func queryRecovery() (RecoveryBackup, error) {
	var b RecoveryBackup
	err := withService(func(s *mgr.Service) error {
		acts, err1 := s.RecoveryActions()
		reset, err2 := s.ResetPeriod()
		cmd, err3 := s.RecoveryCommand()
		nonCrash, err4 := s.RecoveryActionsOnNonCrashFailures()
		if err := errors.Join(err1, err2, err3, err4); err != nil {
			return err
		}
		if len(acts) > recoveryStepMax || len(cmd) > recoveryCmdMax {
			return errors.New("servis: kurtarma ayarı beklenenden büyük")
		}
		b = RecoveryBackup{ResetSec: reset, Command: cmd, NonCrash: nonCrash, Actions: []RecoveryStep{}}
		for _, a := range acts {
			b.Actions = append(b.Actions, RecoveryStep{Type: a.Type, DelayMs: uint32(a.Delay.Milliseconds())})
		}
		return nil
	})
	return b, err
}

// setRecoverActions tüm yuvalar RUN_COMMAND (hata sayacı 0 değilken de kanca çalışsın) + çökme dışı hatalar da sayılır.
func setRecoverActions(exe string) error {
	cmd, err := recoverCommand(exe)
	if err != nil {
		return err
	}
	return withService(func(s *mgr.Service) error {
		if err := s.SetRecoveryCommand(cmd); err != nil {
			return err
		}
		acts := []mgr.RecoveryAction{{Type: mgr.RunCommand, Delay: time.Second},
			{Type: mgr.RunCommand, Delay: recoveryDelay}, {Type: mgr.RunCommand, Delay: recoveryDelay}}
		if err := s.SetRecoveryActions(acts, uint32((24 * time.Hour).Seconds())); err != nil {
			return err
		}
		return s.SetRecoveryActionsOnNonCrashFailures(true)
	})
}

// restoreRecovery yedeği geri yükler; yedek yoksa kayıtlı komut bizimse kurulum varsayılanına döner, değilse dokunmaz.
func restoreRecovery(b *RecoveryBackup) error {
	return withService(func(s *mgr.Service) error {
		if b == nil {
			cur, err := s.RecoveryCommand()
			if err != nil || !strings.Contains(cur, "--update-recover") {
				return err
			}
			acts, reset := defaultRecoveryActions()
			return errors.Join(s.SetRecoveryActions(acts, reset), s.SetRecoveryCommand(""),
				s.SetRecoveryActionsOnNonCrashFailures(false))
		}
		var err error
		if len(b.Actions) == 0 {
			err = s.ResetRecoveryActions()
		} else {
			acts := make([]mgr.RecoveryAction, 0, len(b.Actions))
			for _, a := range b.Actions {
				acts = append(acts, mgr.RecoveryAction{Type: a.Type, Delay: time.Duration(a.DelayMs) * time.Millisecond})
			}
			err = s.SetRecoveryActions(acts, b.ResetSec)
		}
		return errors.Join(err, s.SetRecoveryCommand(b.Command), s.SetRecoveryActionsOnNonCrashFailures(b.NonCrash))
	})
}

// ---- Yer değiştirme (§14.3 m.4) ----

// swapExe exe.yeni → exe. Önce exe.eski sabit bağlantısı (eski baytlar kalır; gözetmen ve kurtarma komutu ona bakar) +
// FileRenameInfoEx(REPLACE_IF_EXISTS|POSIX_SEMANTICS) tek adım; olmazsa iki MoveFileEx (WRITE_THROUGH), ikincisi
// başarısızsa ilki geri alınır. Hata dönerse exe eski ikilidir.
func swapExe(exe string) error {
	old, nw := exe+exeOldSuffix, exe+exeNewSuffix
	if err := removeIfExists(old); err != nil { // önceki güncellemenin silinemeyen artığı → bu deneme INSTALL
		return err
	}
	if err := createHardLink(old, exe); err == nil {
		if err := renamePOSIX(nw, exe); err == nil {
			return nil
		}
		if err := os.Remove(old); err != nil {
			return err
		}
	}
	if err := moveFile(exe, old, 0); err != nil {
		return err
	}
	if err := moveFile(nw, exe, 0); err != nil {
		if uerr := moveFile(old, exe, 0); uerr != nil {
			return errors.Join(err, uerr)
		}
		return err
	}
	return nil
}

func createHardLink(link, target string) error {
	l, err1 := windows.UTF16PtrFromString(link)
	t, err2 := windows.UTF16PtrFromString(target)
	if err := errors.Join(err1, err2); err != nil {
		return err
	}
	return windows.CreateHardLink(l, t, 0)
}

// fileRenameInfo FILE_RENAME_INFO (Flags birliği; FileName değişken uzunluklu).
type fileRenameInfo struct {
	Flags          uint32
	RootDirectory  windows.Handle
	FileNameLength uint32
	FileName       [1]uint16
}

// renamePOSIX SetFileInformationByHandle(FileRenameInfoEx, REPLACE_IF_EXISTS|POSIX_SEMANTICS).
func renamePOSIX(from, to string) error {
	p, err := windows.UTF16PtrFromString(from)
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(p, windows.DELETE|windows.SYNCHRONIZE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|
		windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(h) }()
	name, err := windows.UTF16FromString(to)
	if err != nil {
		return err
	}
	nameBytes := (len(name) - 1) * 2
	size := int(unsafe.Offsetof(fileRenameInfo{}.FileName)) + len(name)*2
	buf := make([]byte, size)
	info := (*fileRenameInfo)(unsafe.Pointer(&buf[0]))
	info.Flags = windows.FILE_RENAME_REPLACE_IF_EXISTS | windows.FILE_RENAME_POSIX_SEMANTICS
	info.FileNameLength = uint32(nameBytes)
	copy(unsafe.Slice(&info.FileName[0], len(name)), name)
	return windows.SetFileInformationByHandle(h, windows.FileRenameInfoEx, &buf[0], uint32(size))
}

// rollbackExe dosyaya bakar: exe.eski varsa exe → exe.bozuk (varsa), exe.eski → exe.
func rollbackExe(exe string) error {
	old := exe + exeOldSuffix
	if !exists(old) {
		return nil
	}
	if exists(exe) {
		if err := moveFile(exe, exe+exeBrokenSuffix, windows.MOVEFILE_REPLACE_EXISTING); err != nil {
			return err
		}
	}
	return moveFile(old, exe, 0)
}

// copyStaged yeni.bin'i FILE_SHARE_READ ile açar; aynı tutamaçtan SHA, sonra exe.yeni'ye (CREATE_NEW, paylaşımsız)
// kopya + kopyalanan akışın SHA'sı.
func copyStaged(dir, exe, sha string) error {
	src := filepath.Join(dir, stagedFileName)
	p, err := windows.UTF16PtrFromString(src)
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING,
		windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_SEQUENTIAL_SCAN, 0)
	if err != nil {
		return err
	}
	in := os.NewFile(uintptr(h), src)
	defer in.Close()
	var fi windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(h, &fi); err != nil {
		return err
	}
	if fi.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return ErrStagedHash
	}
	if got, err := hashReader(in, nil); err != nil || got != sha {
		return errors.Join(ErrStagedHash, err)
	}
	if _, err := in.Seek(0, io.SeekStart); err != nil {
		return err
	}
	dst := exe + exeNewSuffix
	if err := removeIfExists(dst); err != nil { // önceki denemenin artığı (T-6)
		return err
	}
	out, err := createExclusive(dst)
	if err != nil {
		return err
	}
	got, cerr := hashReader(in, out)
	if err := errors.Join(cerr, out.Sync(), out.Close()); err != nil || got != sha {
		_ = os.Remove(dst)
		if err == nil {
			err = ErrStagedHash
		}
		return err
	}
	return nil
}
