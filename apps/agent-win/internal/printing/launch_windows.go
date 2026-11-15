//go:build windows

package printing

import (
	"errors"
	"os"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// İşleyici başlatma (mimari-p28 §5.2, r2 O-P28a-3/(4)): kendi jetonumuzun CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)
// kopyası (+ isteğe bağlı düşük bütünlük S-1-16-4096), CREATE_SUSPENDED → job (tek süreç, kill-on-close, 512 MB,
// işlenmeyen istisnada ölüm, UI kısıtları) → ResumeThread. Öznitelikler: HANDLE_LIST = yalnız iki boru ucu, alt süreç
// yasağı, mitigation (görüntü yükleme + isteğe bağlı yalnız Microsoft imzalı / dinamik kod yasağı).
//
// K0 TASLAĞI: job/öznitelik kalıbı internal/servis/launch_windows.go `helperJob`/`helperAttrs` ile aynıdır; ortak
// `internal/proclimit` paketine taşıma (iki çağıranın tek kodu) K4'ün işidir. Isolation alanları yalnız K0 ölçümü
// içindir (K-P28a-4); K4 sonuca göre sabitler.

// Isolation işleyici yalıtım seçenekleri. Kısıtlı jeton, job, HANDLE_LIST, alt süreç yasağı ve görüntü yükleme
// mitigasyonları her zaman uygulanır.
type Isolation struct {
	LowIntegrity  bool // düşük bütünlük düzeyi (S-1-16-4096)
	MicrosoftOnly bool // PROCESS_CREATION_MITIGATION_POLICY_BLOCK_NON_MICROSOFT_BINARIES_ALWAYS_ON
	NoDynamicCode bool // PROCESS_CREATION_MITIGATION_POLICY_PROHIBIT_DYNAMIC_CODE_ALWAYS_ON
}

// FullIsolation tasarım hedefi (mimari-p28 §5.2 r2).
var FullIsolation = Isolation{LowIntegrity: true, MicrosoftOnly: true, NoDynamicCode: true}

const (
	attrChildProcessPolicy = 0x0002000E // PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY
	childProcessRestricted = 0x01
	// IMAGE_LOAD_{NO_REMOTE,NO_LOW_LABEL,PREFER_SYSTEM32}_ALWAYS_ON (servis yardımcısıyla aynı)
	mitigationImageLoad     = uint64(1)<<52 | uint64(1)<<56 | uint64(1)<<60
	mitigationNoDynamicCode = uint64(1) << 36
	mitigationMicrosoftOnly = uint64(1) << 44
	disableMaxPrivilege     = 0x1
	jobUIRestrictionsClass  = 4 // JobObjectBasicUIRestrictions
	// JOB_OBJECT_UILIMIT_{HANDLES,READCLIPBOARD,WRITECLIPBOARD,SYSTEMPARAMETERS,DISPLAYSETTINGS,GLOBALATOMS,DESKTOP,EXITWINDOWS}
	jobUILimitAll  = 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x40 | 0x80
	workerMemLimit = 512 << 20
	workerKilled   = 0xC0DE
)

var (
	procCreateRestrictedToken   = windows.NewLazySystemDLL("advapi32.dll").NewProc("CreateRestrictedToken")
	procSetInformationJobObject = windows.NewLazySystemDLL("kernel32.dll").NewProc("SetInformationJobObject")
)

// workerProc job'lı işleyici süreç.
type workerProc struct{ h, job windows.Handle }

// StartWorker exe'yi (bu ikili) işleyici kipinde başlatır.
func StartWorker(exe string, iso Isolation) (*Worker, error) {
	tok, err := workerToken(iso.LowIntegrity)
	if err != nil {
		return nil, errors.Join(ErrWorker, err)
	}
	defer tok.Close()
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), InheritHandle: 1}
	var childIn, parentIn, parentOut, childOut windows.Handle
	if err := windows.CreatePipe(&childIn, &parentIn, &sa, 0); err != nil {
		return nil, errors.Join(ErrWorker, err)
	}
	if err := windows.CreatePipe(&parentOut, &childOut, &sa, 0); err != nil {
		closeHandles(childIn, parentIn)
		return nil, errors.Join(ErrWorker, err)
	}
	_ = windows.SetHandleInformation(parentIn, windows.HANDLE_FLAG_INHERIT, 0)
	_ = windows.SetHandleInformation(parentOut, windows.HANDLE_FLAG_INHERIT, 0)
	p, err := startSuspended(exe, tok, childIn, childOut, iso)
	closeHandles(childIn, childOut)
	if err != nil {
		closeHandles(parentIn, parentOut)
		return nil, errors.Join(ErrWorker, err)
	}
	return &Worker{p: p, in: os.NewFile(uintptr(parentIn), "pdf-isleyici-in"), out: os.NewFile(uintptr(parentOut), "pdf-isleyici-out")}, nil
}

func closeHandles(hs ...windows.Handle) {
	for _, h := range hs {
		_ = windows.CloseHandle(h)
	}
}

// workerToken kendi birincil jetonumuzun kısıtlı kopyası; low ise bütünlük düzeyi düşük.
func workerToken(low bool) (windows.Token, error) {
	var self windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(),
		windows.TOKEN_DUPLICATE|windows.TOKEN_QUERY|windows.TOKEN_ASSIGN_PRIMARY, &self); err != nil {
		return 0, err
	}
	defer self.Close()
	var restricted windows.Token
	r1, _, e1 := procCreateRestrictedToken.Call(uintptr(self), disableMaxPrivilege, 0, 0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&restricted)))
	if r1 == 0 {
		return 0, e1
	}
	if !low {
		return restricted, nil
	}
	sid, err := windows.CreateWellKnownSid(windows.WinLowLabelSid)
	if err != nil {
		restricted.Close()
		return 0, err
	}
	tml := windows.Tokenmandatorylabel{Label: windows.SIDAndAttributes{Sid: sid, Attributes: windows.SE_GROUP_INTEGRITY}}
	if err := windows.SetTokenInformation(restricted, windows.TokenIntegrityLevel, (*byte)(unsafe.Pointer(&tml)), tml.Size()); err != nil {
		restricted.Close()
		return 0, err
	}
	return restricted, nil
}

// startSuspended süreci askıda oluşturur, job'a atar, devam ettirir.
func startSuspended(exe string, tok windows.Token, stdin, stdout windows.Handle, iso Isolation) (*workerProc, error) {
	job, err := workerJob()
	if err != nil {
		return nil, err
	}
	attrs, err := workerAttrs([]windows.Handle{stdin, stdout}, iso)
	if err != nil {
		closeHandles(job)
		return nil, err
	}
	defer attrs.Delete()
	pi, err := createWorker(exe, tok, stdin, stdout, attrs)
	if err != nil {
		closeHandles(job)
		return nil, err
	}
	defer closeHandles(pi.Thread)
	if err := windows.AssignProcessToJobObject(job, pi.Process); err != nil {
		_ = windows.TerminateProcess(pi.Process, workerKilled)
		closeHandles(pi.Process, job)
		return nil, err
	}
	if _, err := windows.ResumeThread(pi.Thread); err != nil {
		closeHandles(job, pi.Process) // kill-on-close
		return nil, err
	}
	return &workerProc{h: pi.Process, job: job}, nil
}

func createWorker(exe string, tok windows.Token, stdin, stdout windows.Handle, attrs *windows.ProcThreadAttributeListContainer) (*windows.ProcessInformation, error) {
	app, err1 := windows.UTF16PtrFromString(exe)
	cl, err2 := windows.UTF16PtrFromString(windows.EscapeArg(exe) + " " + WorkerArg)
	sys, err3 := windows.GetSystemDirectory()
	if err := errors.Join(err1, err2, err3); err != nil {
		return nil, err
	}
	cwd, err := windows.UTF16PtrFromString(sys)
	if err != nil {
		return nil, err
	}
	si := windows.StartupInfoEx{ProcThreadAttributeList: attrs.List()}
	si.Cb = uint32(unsafe.Sizeof(si))
	si.Flags = windows.STARTF_USESTDHANDLES
	si.StdInput = stdin
	si.StdOutput = stdout
	var pi windows.ProcessInformation
	flags := uint32(windows.CREATE_SUSPENDED | windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_NO_WINDOW)
	if err := windows.CreateProcessAsUser(tok, app, cl, nil, nil, true, flags, nil, cwd, &si.StartupInfo, &pi); err != nil {
		return nil, err
	}
	return &pi, nil
}

// workerAttrs HANDLE_LIST (yalnız iki boru ucu) + alt süreç yasağı + mitigation.
func workerAttrs(handles []windows.Handle, iso Isolation) (*windows.ProcThreadAttributeListContainer, error) {
	attrs, err := windows.NewProcThreadAttributeList(3)
	if err != nil {
		return nil, err
	}
	child := uint32(childProcessRestricted)
	mitigation := mitigationImageLoad
	if iso.MicrosoftOnly {
		mitigation |= mitigationMicrosoftOnly
	}
	if iso.NoDynamicCode {
		mitigation |= mitigationNoDynamicCode
	}
	err = errors.Join(
		attrs.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&handles[0]), uintptr(len(handles))*unsafe.Sizeof(handles[0])),
		attrs.Update(attrChildProcessPolicy, unsafe.Pointer(&child), unsafe.Sizeof(child)),
		attrs.Update(windows.PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY, unsafe.Pointer(&mitigation), unsafe.Sizeof(mitigation)),
	)
	if err != nil {
		attrs.Delete()
		return nil, err
	}
	return attrs, nil
}

// workerJob tek süreç, kill-on-close, 512 MB, işlenmeyen istisnada ölüm, UI kısıtları.
func workerJob() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, err
	}
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_ACTIVE_PROCESS | windows.JOB_OBJECT_LIMIT_PROCESS_MEMORY |
		windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | windows.JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
	info.BasicLimitInformation.ActiveProcessLimit = 1
	info.ProcessMemoryLimit = workerMemLimit
	r1, _, e1 := procSetInformationJobObject.Call(uintptr(job), windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))
	if r1 == 0 {
		closeHandles(job)
		return 0, e1
	}
	ui := uint32(jobUILimitAll)
	r1, _, e1 = procSetInformationJobObject.Call(uintptr(job), jobUIRestrictionsClass, uintptr(unsafe.Pointer(&ui)),
		unsafe.Sizeof(ui))
	if r1 == 0 {
		closeHandles(job)
		return 0, e1
	}
	return job, nil
}

// waitOrKill süreç grace içinde çıkmazsa job'u kapatır (kill-on-close); çıkış kodunu döner, handle'ları kapatır.
func (p *workerProc) waitOrKill(grace time.Duration) uint32 {
	ev, _ := windows.WaitForSingleObject(p.h, uint32(grace/time.Millisecond))
	if ev != windows.WAIT_OBJECT_0 {
		_ = windows.TerminateProcess(p.h, workerKilled)
		_, _ = windows.WaitForSingleObject(p.h, uint32(grace/time.Millisecond))
	}
	code := uint32(workerKilled)
	var c uint32
	if windows.GetExitCodeProcess(p.h, &c) == nil {
		code = c
	}
	closeHandles(p.h, p.job)
	return code
}
