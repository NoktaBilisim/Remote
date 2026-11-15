//go:build windows

package proclimit

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Mitigation bayrakları (PROCESS_CREATION_MITIGATION_POLICY_*_ALWAYS_ON).
const (
	// MitigationImageLoad IMAGE_LOAD_{NO_REMOTE,NO_LOW_LABEL,PREFER_SYSTEM32}: her çağıranda uygulanır.
	MitigationImageLoad = uint64(1)<<52 | uint64(1)<<56 | uint64(1)<<60
	// MitigationNoDynamicCode PROHIBIT_DYNAMIC_CODE.
	MitigationNoDynamicCode = uint64(1) << 36
	// MitigationMicrosoftOnly BLOCK_NON_MICROSOFT_BINARIES (yalnız Microsoft imzalı DLL).
	MitigationMicrosoftOnly = uint64(1) << 44
)

const (
	attrChildProcessPolicy = 0x0002000E // PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY
	childProcessRestricted = 0x01       // PROCESS_CREATION_CHILD_PROCESS_RESTRICTED
	disableMaxPrivilege    = 0x1        // DISABLE_MAX_PRIVILEGE
	jobUIRestrictionsClass = 4          // JobObjectBasicUIRestrictions
	// JOB_OBJECT_UILIMIT_{HANDLES,READCLIPBOARD,WRITECLIPBOARD,SYSTEMPARAMETERS,DISPLAYSETTINGS,GLOBALATOMS,DESKTOP,EXITWINDOWS}
	jobUILimitAll = 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x40 | 0x80
)

// Doğrudan proc çağrıları: işaretçi dönüşümü yalnız Call argümanında kalır (S6-1, internal/win unsafeptr testi).
var (
	procCreateRestrictedToken   = windows.NewLazySystemDLL("advapi32.dll").NewProc("CreateRestrictedToken")
	procSetInformationJobObject = windows.NewLazySystemDLL("kernel32.dll").NewProc("SetInformationJobObject")
	user32                      = windows.NewLazySystemDLL("user32.dll")
	procGetProcessWindowStation = user32.NewProc("GetProcessWindowStation")
	procGetThreadDesktop        = user32.NewProc("GetThreadDesktop")
	procGetUserObjectInfo       = user32.NewProc("GetUserObjectInformationW")
)

const uoiName = 2 // UOI_NAME

// CurrentDesktop çağıranın pencere istasyonu ve masaüstü adı ("winsta0\default" biçiminde); STARTUPINFO.lpDesktop'a
// açıkça verilir (devralma belirsizliği yok). Okunamazsa boş döner (üst sürecinki devralınır).
func CurrentDesktop() string {
	ws, _, _ := procGetProcessWindowStation.Call()
	desk, _, _ := procGetThreadDesktop.Call(uintptr(windows.GetCurrentThreadId()))
	a, b := objectName(ws), objectName(desk)
	if a == "" || b == "" {
		return ""
	}
	return a + `\` + b
}

func objectName(h uintptr) string {
	if h == 0 {
		return ""
	}
	var buf [256]uint16
	var need uint32
	if r, _, _ := procGetUserObjectInfo.Call(h, uoiName, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)*2),
		uintptr(unsafe.Pointer(&need))); r == 0 {
		return ""
	}
	return windows.UTF16ToString(buf[:])
}

// Restrict base jetonunun DISABLE_MAX_PRIVILEGE kısıtlı birincil kopyası (yalnız SeChangeNotify kalır); low ise
// bütünlük düzeyi düşük (S-1-16-4096). base TOKEN_DUPLICATE ile açılmış olmalıdır.
func Restrict(base windows.Token, low bool) (windows.Token, error) {
	var restricted windows.Token
	r1, _, e1 := procCreateRestrictedToken.Call(uintptr(base), disableMaxPrivilege, 0, 0, 0, 0, 0, 0,
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

// Spec başlatılacak sürecin tanımı.
type Spec struct {
	Token   windows.Token // birincil, kısıtlı jeton (Restrict)
	Exe     string        // uygulama yolu
	CmdLine string        // tam komut satırı (çağıran tırnaklar)
	Desktop string        // boşsa üst sürecinki
	Stdin   windows.Handle
	Stdout  windows.Handle // 0 olabilir
	// Handles HANDLE_LIST: devralınacak tek tanıtıcılar (Stdin/Stdout bunların içinde olmalı).
	Handles    []windows.Handle
	Mitigation uint64 // MitigationImageLoad | …
	MemLimit   uintptr
	UILimits   bool // job UI kısıtları (masaüstü, pano, sistem parametreleri, global atom, USER tanıtıcıları …)
	// Detached DETACHED_PROCESS: konsol ayrılmaz. Konsol alt sistemli ikilide (test ikilisi) CREATE_NO_WINDOW bile
	// conhost.exe açar; ACTIVE_PROCESS=1 + alt süreç yasağı altında bu açılış 0xC0000142 (STATUS_DLL_INIT_FAILED) ile
	// düşer (K0 CI, PR #11). Borular STARTF_USESTDHANDLES ile yine devralınır.
	Detached bool
	KillCode uint32 // başlatma yarıda kalırsa TerminateProcess kodu
}

// Spawn süreci CREATE_SUSPENDED oluşturur, job'a atar ve devam ettirir. Dönen job KILL_ON_JOB_CLOSE'dur: job
// tanıtıcısını kapatmak kalan her şeyi öldürür. Çağıran proc ve job'u kapatır.
func Spawn(s Spec) (proc, job windows.Handle, err error) {
	if len(s.Handles) == 0 {
		return 0, 0, errors.New("proclimit: HANDLE_LIST boş")
	}
	job, err = newJob(s.MemLimit, s.UILimits)
	if err != nil {
		return 0, 0, err
	}
	attrs, err := newAttrs(s.Handles, s.Mitigation)
	if err != nil {
		_ = windows.CloseHandle(job)
		return 0, 0, err
	}
	defer attrs.Delete()
	pi, err := create(s, attrs)
	if err != nil {
		_ = windows.CloseHandle(job)
		return 0, 0, err
	}
	defer func() { _ = windows.CloseHandle(pi.Thread) }()
	if err := windows.AssignProcessToJobObject(job, pi.Process); err != nil {
		_ = windows.TerminateProcess(pi.Process, s.KillCode)
		_ = windows.CloseHandle(pi.Process)
		_ = windows.CloseHandle(job)
		return 0, 0, err
	}
	if _, err := windows.ResumeThread(pi.Thread); err != nil {
		_ = windows.CloseHandle(job) // kill-on-close
		_ = windows.CloseHandle(pi.Process)
		return 0, 0, err
	}
	return pi.Process, job, nil
}

func create(s Spec, attrs *windows.ProcThreadAttributeListContainer) (*windows.ProcessInformation, error) {
	app, err1 := windows.UTF16PtrFromString(s.Exe)
	cl, err2 := windows.UTF16PtrFromString(s.CmdLine)
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
	if s.Desktop != "" {
		desk, err := windows.UTF16PtrFromString(s.Desktop)
		if err != nil {
			return nil, err
		}
		si.Desktop = desk
	}
	si.Flags = windows.STARTF_USESTDHANDLES
	si.StdInput = s.Stdin
	si.StdOutput = s.Stdout
	flags := uint32(windows.CREATE_SUSPENDED | windows.EXTENDED_STARTUPINFO_PRESENT)
	if s.Detached {
		flags |= windows.DETACHED_PROCESS
	}
	var pi windows.ProcessInformation
	if err := windows.CreateProcessAsUser(s.Token, app, cl, nil, nil, true, flags, nil, cwd, &si.StartupInfo, &pi); err != nil {
		return nil, err
	}
	return &pi, nil
}

// newAttrs öznitelik listesi: HANDLE_LIST + alt süreç yasağı + mitigation (değerleri Update kapsayıcıda canlı tutar).
func newAttrs(handles []windows.Handle, mitigation uint64) (*windows.ProcThreadAttributeListContainer, error) {
	attrs, err := windows.NewProcThreadAttributeList(3)
	if err != nil {
		return nil, err
	}
	hs := append([]windows.Handle(nil), handles...)
	child := uint32(childProcessRestricted)
	m := mitigation | MitigationImageLoad
	err = errors.Join(
		attrs.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&hs[0]), uintptr(len(hs))*unsafe.Sizeof(hs[0])),
		attrs.Update(attrChildProcessPolicy, unsafe.Pointer(&child), unsafe.Sizeof(child)),
		attrs.Update(windows.PROC_THREAD_ATTRIBUTE_MITIGATION_POLICY, unsafe.Pointer(&m), unsafe.Sizeof(m)),
	)
	if err != nil {
		attrs.Delete()
		return nil, err
	}
	return attrs, nil
}

// newJob tek süreç, kill-on-close, işlenmeyen istisnada ölüm; mem > 0 ise süreç bellek sınırı; ui ise UI kısıtları.
func newJob(mem uintptr, ui bool) (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, err
	}
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_ACTIVE_PROCESS |
		windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | windows.JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
	info.BasicLimitInformation.ActiveProcessLimit = 1
	if mem > 0 {
		info.BasicLimitInformation.LimitFlags |= windows.JOB_OBJECT_LIMIT_PROCESS_MEMORY
		info.ProcessMemoryLimit = mem
	}
	r1, _, e1 := procSetInformationJobObject.Call(uintptr(job), windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))
	if r1 == 0 {
		_ = windows.CloseHandle(job)
		return 0, e1
	}
	if ui {
		lim := uint32(jobUILimitAll)
		r1, _, e1 = procSetInformationJobObject.Call(uintptr(job), jobUIRestrictionsClass, uintptr(unsafe.Pointer(&lim)),
			unsafe.Sizeof(lim))
		if r1 == 0 {
			_ = windows.CloseHandle(job)
			return 0, e1
		}
	}
	return job, nil
}
