//go:build windows

package servis

import (
	"bytes"
	"encoding/json"
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Boru istemcisi (mimari-p27 §5.4 r2, K-P27-19; AC-338): `--uninstall` ve ayar penceresi/tepsi (K7) kullanır. Boru
// `SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION` ile açılır (sunucu istemci adına işlem yapamaz) ve
// `GetNamedPipeServerProcessId` SCM'nin bildirdiği servis PID'iyle karşılaştırılır; eşleşmezse bağlantı kesilir
// (ErrServiceUnverified → "Servis doğrulanamadı"). Erişim yalnız okuma/yazma verisidir (GENERIC_WRITE istenmez:
// FILE_APPEND_DATA boru DACL'ında INTERACTIVE'e verilmez).

// ErrServiceUnverified boru sunucusu kurulu servis süreci değil.
var ErrServiceUnverified = errors.New("servis: servis doğrulanamadı")

// ServiceUnverifiedText kullanıcıya gösterilen metin.
const ServiceUnverifiedText = "Servis doğrulanamadı"

const pipeClientAccess = windows.FILE_READ_DATA | windows.FILE_WRITE_DATA | windows.FILE_READ_ATTRIBUTES | windows.SYNCHRONIZE

// CallPipe tek komut gönderir ve yanıtı döner.
func CallPipe(cmd string) (PipeResponse, error) {
	name, err := windows.UTF16PtrFromString(PipeName)
	if err != nil {
		return PipeResponse{}, err
	}
	h, err := windows.CreateFile(name, pipeClientAccess, 0, nil, windows.OPEN_EXISTING,
		windows.SECURITY_SQOS_PRESENT|windows.SECURITY_IDENTIFICATION, 0)
	if err != nil {
		return PipeResponse{}, err
	}
	defer func() { _ = windows.CloseHandle(h) }()
	if err := verifyPipeServer(h); err != nil {
		return PipeResponse{}, err
	}
	req, err := json.Marshal(PipeRequest{Cmd: cmd})
	if err != nil {
		return PipeResponse{}, err
	}
	var n uint32
	if err := windows.WriteFile(h, append(req, '\n'), &n, nil); err != nil {
		return PipeResponse{}, err
	}
	buf := make([]byte, MaxPipeLine)
	if err := windows.ReadFile(h, buf, &n, nil); err != nil {
		return PipeResponse{}, err
	}
	var resp PipeResponse
	if err := json.Unmarshal(bytes.TrimSpace(buf[:n]), &resp); err != nil {
		return PipeResponse{}, ErrPipeFormat
	}
	return resp, nil
}

// verifyPipeServer sunucu PID'i = SCM servis PID'i.
func verifyPipeServer(h windows.Handle) error {
	var pid uint32
	if err := windows.GetNamedPipeServerProcessId(h, &pid); err != nil {
		return ErrServiceUnverified
	}
	svcPID, err := ServicePID()
	if err != nil || svcPID == 0 || svcPID != pid {
		return ErrServiceUnverified
	}
	return nil
}

// ServicePID çalışan servisin PID'i (yalnız SC_MANAGER_CONNECT + SERVICE_QUERY_STATUS — standart kullanıcı okuyabilir).
func ServicePID() (uint32, error) {
	m, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return 0, err
	}
	defer func() { _ = windows.CloseServiceHandle(m) }()
	name, err := windows.UTF16PtrFromString(ServiceName)
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
		return 0, ErrServiceUnverified
	}
	return st.ProcessId, nil
}
