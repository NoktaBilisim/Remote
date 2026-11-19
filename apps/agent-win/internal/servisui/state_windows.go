//go:build windows

package servisui

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"remote-support/agent-win/internal/servis"
)

// Durum okuma ve eylemler (mimari-p27 §5.4). Okumalar standart kullanıcı yetkisiyle yapılır: HKLM kaydı ve
// `LocalEnabled` (Users okuma), Uninstall `DisplayVersion`, boru `status` (SQOS IDENTIFICATION + sunucu PID = SCM servis
// PID'i; servis.CallPipe). Açma, kurma, güncelleme ve kaldırma yalnız UAC ile yeniden başlatılan aynı ikilidedir;
// standart kullanıcının tek doğrudan eylemi boru `disable`'dır.

// readSnapshot anlık durumu okur (UI iş parçacığında çağrılmaz: boru çağrısı bekleyebilir).
func readSnapshot(version string) Snapshot {
	s := Snapshot{SelfVersion: version, SelfIsInstalled: selfIsInstalled()}
	reg, err := servis.ReadRegistration()
	if err != nil {
		return s
	}
	s.Installed = true
	s.DeviceID, s.TenantName, s.CustomerName = reg.DeviceID, reg.TenantName, reg.CustomerName
	s.Enabled, _ = servis.RegSwitch{}.Enabled() // okunamazsa false: kapalı (fail-closed)
	s.InstalledVersion = installedVersion()
	resp, err := servis.CallPipe(servis.CmdStatus)
	s.Pipe = pipeResult(resp, err)
	if s.Pipe == PipeOK {
		s.State, s.TechName, s.ServiceVersion = resp.State, resp.TechName, resp.Version
	}
	return s
}

func pipeResult(resp servis.PipeResponse, err error) PipeResult {
	switch {
	case errors.Is(err, servis.ErrServiceUnverified):
		return PipeUnverified
	case errors.Is(err, windows.ERROR_FILE_NOT_FOUND):
		return PipeDown
	case err != nil || !resp.OK:
		return PipeBusy
	}
	return PipeOK
}

// disableLocal boru `disable`; başarıda "", aksi halde kullanıcıya gösterilecek metin.
func disableLocal() string {
	resp, err := servis.CallPipe(servis.CmdDisable)
	switch pipeResult(resp, err) {
	case PipeOK:
		return ""
	case PipeUnverified:
		return TextUnverified
	case PipeDown:
		return ErrPipeDownText
	}
	return ErrDisableText
}

// waitOnline kurulum sonrası servisin sunucuya bağlanmasını en çok n deneme bekler (her biri ~500 ms).
func waitOnline(n int) bool {
	for i := 0; i < n; i++ {
		if resp, err := servis.CallPipe(servis.CmdStatus); err == nil && resp.OK && resp.State == servis.StateOnline {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

func installedVersion() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, servis.UninstallKey, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer func() { _ = k.Close() }()
	v, _, err := k.GetStringValue("DisplayVersion")
	if err != nil {
		return ""
	}
	return v
}

func selfIsInstalled() bool {
	self, err1 := os.Executable()
	dst, err2 := servis.InstalledExe()
	if errors.Join(err1, err2) != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(self), filepath.Clean(dst))
}

// elevate aynı ikiliyi UAC ile verilen kipte başlatır (`--install`, `--enable`, `--uninstall`). Kullanıcı UAC'yi
// reddederse hata değildir (false, nil).
func elevate(owner uintptr, arg string) (bool, error) {
	self, err := os.Executable()
	if err != nil {
		return false, err
	}
	verb, err1 := windows.UTF16PtrFromString("runas")
	file, err2 := windows.UTF16PtrFromString(self)
	args, err3 := windows.UTF16PtrFromString(arg)
	if err := errors.Join(err1, err2, err3); err != nil {
		return false, err
	}
	err = windows.ShellExecute(windows.Handle(owner), verb, file, args, nil, windows.SW_SHOWNORMAL)
	if errors.Is(err, windows.ERROR_CANCELLED) {
		return false, nil
	}
	return err == nil, err
}

// startTray kurulumdan hemen sonra geçerli kullanıcı için tepsiyi başlatır (sonraki oturumlarda HKLM Run başlatır).
// Kurulu kopya çalıştırılır; yükseltme istenmez (asInvoker).
func startTray() {
	exe, err := servis.InstalledExe()
	if err != nil {
		return
	}
	cmd := exec.Command(exe, "--tray")
	if cmd.Start() == nil {
		_ = cmd.Process.Release()
	}
}
