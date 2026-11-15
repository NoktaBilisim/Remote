//go:build windows

package helper

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/servis/helperio"
)

// Açılış kimlik denetimi (mimari-p27 §5.1 "`--helper` yalnız LocalSystem jetonu + ebeveyn servis", §5.2 r2 m.1; AC-341):
// jeton kullanıcısı LocalSystem, jetonda izin listesi dışında ayrıcalık yok, ebeveyn süreç SCM'nin bildirdiği servis
// süreci ve süreç etkin konsol oturumunda. Bilet okunmadan önce yapılır (taklit eden süreç girdiyi tüketemez).

const noConsoleSession = 0xFFFFFFFF

var errIdentity = errors.New("helper: süreç kimliği doğrulanamadı")

// verifyProcess 0 (geçti) ya da çıkış kodu döner.
func verifyProcess() uint32 {
	tok := windows.GetCurrentProcessToken()
	if err := errors.Join(checkSystem(tok), checkPrivileges(tok), checkParent()); err != nil {
		return helperio.ExitHelperFailed
	}
	var own uint32
	if err := windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &own); err != nil {
		return helperio.ExitHelperFailed
	}
	if active := windows.WTSGetActiveConsoleSessionId(); active == noConsoleSession || active != own {
		return helperio.ExitNoConsole
	}
	return 0
}

func checkSystem(tok windows.Token) error {
	u, err := tok.GetTokenUser()
	if err != nil {
		return err
	}
	if !u.User.Sid.IsWellKnown(windows.WinLocalSystemSid) {
		return errIdentity
	}
	return nil
}

// checkPrivileges jetondaki (etkin ya da devre dışı) her ayrıcalık allowedPrivileges içinde olmalı: devre dışı bir
// ayrıcalık süreç tarafından AdjustTokenPrivileges ile açılabileceğinden varlık denetlenir.
func checkPrivileges(tok windows.Token) error {
	var n uint32
	_ = windows.GetTokenInformation(tok, windows.TokenPrivileges, nil, 0, &n)
	if n == 0 {
		return errIdentity
	}
	buf := make([]byte, n)
	if err := windows.GetTokenInformation(tok, windows.TokenPrivileges, &buf[0], n, &n); err != nil {
		return err
	}
	tp := (*windows.Tokenprivileges)(unsafe.Pointer(&buf[0]))
	allowed := make([]windows.LUID, 0, len(allowedPrivileges))
	for _, name := range allowedPrivileges {
		var l windows.LUID
		p, err := windows.UTF16PtrFromString(name)
		if err != nil {
			return err
		}
		if err := windows.LookupPrivilegeValue(nil, p, &l); err != nil {
			return err
		}
		allowed = append(allowed, l)
	}
	present := make([]windows.LUID, 0, tp.PrivilegeCount)
	for _, la := range tp.AllPrivileges() {
		present = append(present, la.Luid)
	}
	if !onlyAllowed(present, allowed) {
		return errIdentity
	}
	return nil
}

// checkParent ebeveyn süreç kimliği = SCM'nin bildirdiği çalışan servis süreci.
func checkParent() error {
	var pbi windows.PROCESS_BASIC_INFORMATION
	if err := windows.NtQueryInformationProcess(windows.CurrentProcess(), windows.ProcessBasicInformation,
		unsafe.Pointer(&pbi), uint32(unsafe.Sizeof(pbi)), nil); err != nil {
		return err
	}
	pid, err := servicePID()
	if err != nil {
		return err
	}
	if pid == 0 || uint32(pbi.InheritedFromUniqueProcessId) != pid {
		return errIdentity
	}
	return nil
}

// servicePID çalışan servisin süreç kimliği (internal/servis.ServicePID eşi; o paket içe aktarılmaz — checks.go).
func servicePID() (uint32, error) {
	m, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return 0, err
	}
	defer func() { _ = windows.CloseServiceHandle(m) }()
	name, err := windows.UTF16PtrFromString(serviceName)
	if err != nil {
		return 0, err
	}
	s, err := windows.OpenService(m, name, windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return 0, err
	}
	defer func() { _ = windows.CloseServiceHandle(s) }()
	var st windows.SERVICE_STATUS_PROCESS
	var need uint32
	if err := windows.QueryServiceStatusEx(s, windows.SC_STATUS_PROCESS_INFO, (*byte)(unsafe.Pointer(&st)),
		uint32(unsafe.Sizeof(st)), &need); err != nil {
		return 0, err
	}
	if st.CurrentState != windows.SERVICE_RUNNING {
		return 0, errIdentity
	}
	return st.ProcessId, nil
}
