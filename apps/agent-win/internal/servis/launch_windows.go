//go:build windows

package servis

import (
	"errors"
	"path/filepath"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/servis/helperio"
)

// Yardımcı başlatma (mimari-p27 §5.2, r2 Y-P27-3/K-P27-16; AC-341): servisin SYSTEM jetonunun kopyası
// `CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)` ile kısıtlanır (yalnız SeChangeNotify kalır), oturumu etkin konsol
// oturumuna ayarlanır ve `winsta0\default`'ta `CREATE_SUSPENDED` başlatılır; süreç job'a (tek süreç, kill-on-close,
// işlenmeyen istisnada ölüm) atandıktan sonra devam ettirilir. Öznitelik listesi: çocuk süreç yasağı, görüntü yükleme
// mitigasyonları ve HANDLE_LIST = yalnız girdi borusunun okuma ucu. Girdi (bilet dahil) yalnız bu borudan geçer.

const (
	attrChildProcessPolicy = 0x0002000E // PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY
	childProcessRestricted = 0x01       // PROCESS_CREATION_CHILD_PROCESS_RESTRICTED
	// PROCESS_CREATION_MITIGATION_POLICY_IMAGE_LOAD_{NO_REMOTE,NO_LOW_LABEL,PREFER_SYSTEM32}_ALWAYS_ON
	mitigationImageLoad = uint64(1)<<52 | uint64(1)<<56 | uint64(1)<<60
	disableMaxPrivilege = 0x1 // DISABLE_MAX_PRIVILEGE
	noConsoleSession    = 0xFFFFFFFF
	helperDesktop       = `winsta0\default`
	helperPipeSize      = 8192
)

// Doğrudan proc çağrıları: işaretçi dönüşümü yalnız Call argümanında kalır (S6-1, internal/win unsafeptr testi).
var (
	procCreateRestrictedToken   = windows.NewLazySystemDLL("advapi32.dll").NewProc("CreateRestrictedToken")
	procSetInformationJobObject = windows.NewLazySystemDLL("kernel32.dll").NewProc("SetInformationJobObject")
)

// WinLauncher Launcher'ın Windows uygulaması; Exe kurulu ikilinin yoludur.
type WinLauncher struct{ Exe string }

// Launch yardımcıyı başlatır ve girdiyi borudan yazar.
func (l WinLauncher) Launch(in helperio.Input) (Process, error) {
	data, err := helperio.Encode(in)
	if err != nil {
		return nil, err
	}
	session := windows.WTSGetActiveConsoleSessionId()
	if session == noConsoleSession {
		return nil, ErrNoConsole
	}
	tok, err := helperToken(session)
	if err != nil {
		return nil, err
	}
	defer tok.Close()
	var r, w windows.Handle
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), InheritHandle: 1}
	if err := windows.CreatePipe(&r, &w, &sa, helperPipeSize); err != nil {
		return nil, err
	}
	defer func() { _ = windows.CloseHandle(w) }()
	_ = windows.SetHandleInformation(w, windows.HANDLE_FLAG_INHERIT, 0)
	p, err := l.start(tok, r)
	_ = windows.CloseHandle(r)
	if err != nil {
		return nil, err
	}
	var n uint32
	if err := windows.WriteFile(w, data, &n, nil); err != nil || int(n) != len(data) {
		_ = p.Kill()
		p.Wait()
		return nil, errors.Join(errors.New("servis: yardımcı girdisi yazılamadı"), err)
	}
	return p, nil
}

// helperToken SYSTEM jetonunun kısıtlı, konsol oturumuna ayarlanmış birincil kopyası.
func helperToken(session uint32) (windows.Token, error) {
	var self windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_DUPLICATE|windows.TOKEN_QUERY, &self); err != nil {
		return 0, err
	}
	defer self.Close()
	var dup windows.Token
	if err := windows.DuplicateTokenEx(self, windows.TOKEN_ALL_ACCESS, nil, windows.SecurityImpersonation,
		windows.TokenPrimary, &dup); err != nil {
		return 0, err
	}
	defer dup.Close()
	var restricted windows.Token
	r1, _, e1 := procCreateRestrictedToken.Call(uintptr(dup), disableMaxPrivilege, 0, 0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&restricted)))
	if r1 == 0 {
		return 0, e1
	}
	if err := windows.SetTokenInformation(restricted, windows.TokenSessionId, (*byte)(unsafe.Pointer(&session)),
		uint32(unsafe.Sizeof(session))); err != nil {
		restricted.Close()
		return 0, err
	}
	return restricted, nil
}

// start süreci askıda oluşturur, job'a atar ve devam ettirir.
func (l WinLauncher) start(tok windows.Token, stdin windows.Handle) (*winProcess, error) {
	job, err := helperJob()
	if err != nil {
		return nil, err
	}
	attrs, err := helperAttrs(stdin)
	if err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	defer attrs.Delete()
	pi, err := l.create(tok, stdin, attrs)
	if err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	defer func() { _ = windows.CloseHandle(pi.Thread) }()
	if err := windows.AssignProcessToJobObject(job, pi.Process); err != nil {
		_ = windows.TerminateProcess(pi.Process, helperio.ExitKilledByService)
		_ = windows.CloseHandle(pi.Process)
		_ = windows.CloseHandle(job)
		return nil, err
	}
	if _, err := windows.ResumeThread(pi.Thread); err != nil {
		_ = windows.CloseHandle(job) // kill-on-close
		_ = windows.CloseHandle(pi.Process)
		return nil, err
	}
	return &winProcess{h: pi.Process, job: job}, nil
}

func (l WinLauncher) create(tok windows.Token, stdin windows.Handle, attrs *windows.ProcThreadAttributeListContainer) (*windows.ProcessInformation, error) {
	cmd, err := quoted(l.Exe, "--helper")
	if err != nil {
		return nil, err
	}
	app, err1 := windows.UTF16PtrFromString(l.Exe)
	cl, err2 := windows.UTF16PtrFromString(cmd)
	desk, err3 := windows.UTF16PtrFromString(helperDesktop)
	sys, err4 := windows.GetSystemDirectory()
	if err := errors.Join(err1, err2, err3, err4); err != nil {
		return nil, err
	}
	cwd, err := windows.UTF16PtrFromString(filepath.Clean(sys))
	if err != nil {
		return nil, err
	}
	si := windows.StartupInfoEx{ProcThreadAttributeList: attrs.List()}
	si.Cb = uint32(unsafe.Sizeof(si))
	si.Desktop = desk
	si.Flags = windows.STARTF_USESTDHANDLES
	si.StdInput = stdin
	var pi windows.ProcessInformation
	flags := uint32(windows.CREATE_SUSPENDED | windows.EXTENDED_STARTUPINFO_PRESENT)
	if err := windows.CreateProcessAsUser(tok, app, cl, nil, nil, true, flags, nil, cwd, &si.StartupInfo, &pi); err != nil {
		return nil, err
	}
	return &pi, nil
}

// helperAttrs öznitelik listesi (değerleri Update kapsayıcıda canlı tutar).
func helperAttrs(stdin windows.Handle) (*windows.ProcThreadAttributeListContainer, error) {
	attrs, err := windows.NewProcThreadAttributeList(3)
	if err != nil {
		return nil, err
	}
	handles := []windows.Handle{stdin}
	child := uint32(childProcessRestricted)
	mitigation := mitigationImageLoad
	err = errors.Join(
		attrs.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&handles[0]), unsafe.Sizeof(handles[0])),
		attrs.Update(attrChildProcessPolicy, unsafe.Pointer(&child), unsafe.Sizeof(child)),
		attrs.Update(windows.PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY, unsafe.Pointer(&mitigation), unsafe.Sizeof(mitigation)),
	)
	if err != nil {
		attrs.Delete()
		return nil, err
	}
	return attrs, nil
}

// helperJob tek süreç, kill-on-close, işlenmeyen istisnada ölüm.
func helperJob() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, err
	}
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_ACTIVE_PROCESS |
		windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | windows.JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
	info.BasicLimitInformation.ActiveProcessLimit = 1
	r1, _, e1 := procSetInformationJobObject.Call(uintptr(job), windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))
	if r1 == 0 {
		_ = windows.CloseHandle(job)
		return 0, e1
	}
	return job, nil
}

// winProcess job'lı yardımcı süreç.
type winProcess struct {
	mu     sync.Mutex
	h, job windows.Handle
	closed bool
}

// Wait süreç bitene kadar bekler, çıkış kodunu döner ve handle'ları kapatır (job kapanınca kalan her şey ölür).
func (p *winProcess) Wait() uint32 {
	_, _ = windows.WaitForSingleObject(p.h, windows.INFINITE)
	code := helperio.ExitHelperFailed
	var c uint32
	if windows.GetExitCodeProcess(p.h, &c) == nil {
		code = c
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.closed {
		p.closed = true
		_ = windows.CloseHandle(p.h)
		_ = windows.CloseHandle(p.job)
	}
	return code
}

// Kill TerminateProcess (idempotent; bitmiş süreçte etkisiz).
func (p *winProcess) Kill() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	return windows.TerminateProcess(p.h, helperio.ExitKilledByService)
}
