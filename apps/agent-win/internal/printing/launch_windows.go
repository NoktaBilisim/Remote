//go:build windows

package printing

import (
	"errors"
	"os"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/proclimit"
)

// İşleyici başlatma (mimari-p28 §5.2, r2 O-P28a-3/(4)): kendi jetonumuzun kısıtlı kopyası (+ düşük bütünlük), job
// (tek süreç, kill-on-close, 512 MB, işlenmeyen istisnada ölüm, UI kısıtları), HANDLE_LIST = yalnız iki boru ucu, alt
// süreç yasağı, mitigation. Ortak kod internal/proclimit (servis yardımcısıyla aynı).

// Isolation işleyici yalıtım seçenekleri. Kısıtlı jeton, job, HANDLE_LIST, alt süreç yasağı ve görüntü yükleme
// mitigasyonları her zaman uygulanır.
type Isolation struct {
	LowIntegrity  bool // düşük bütünlük düzeyi (S-1-16-4096)
	MicrosoftOnly bool // yalnız Microsoft imzalı DLL
	NoDynamicCode bool // dinamik kod yasak
	// SkipUILimits job UI kısıtlarını kaldırır; yalnız CI ölçümü içindir (K4: açılış hatasının kaynağını ayırmak),
	// üretim ayarı (DefaultIsolation) bunu kullanmaz.
	SkipUILimits bool
}

// FullIsolation tasarım hedefi (mimari-p28 §5.2 r2).
var FullIsolation = Isolation{LowIntegrity: true, MicrosoftOnly: true, NoDynamicCode: true}

// DefaultIsolation üretim ayarı (New). Varsayılan tasarım hedefidir; K0 CI ölçümü (PR #11) bir bayrağın WinRT
// render'ı bozduğunu gösterirse koordinatör kararıyla yalnız burada kapatılır (K-P28a-4).
var DefaultIsolation = FullIsolation

const (
	workerMemLimit = 512 << 20
	workerKilled   = 0xC0DE
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
	mitigation := proclimit.MitigationImageLoad
	if iso.MicrosoftOnly {
		mitigation |= proclimit.MitigationMicrosoftOnly
	}
	if iso.NoDynamicCode {
		mitigation |= proclimit.MitigationNoDynamicCode
	}
	h, job, err := proclimit.Spawn(proclimit.Spec{
		Token: tok, Exe: exe, CmdLine: windows.EscapeArg(exe) + " " + WorkerArg,
		Stdin: childIn, Stdout: childOut, Handles: []windows.Handle{childIn, childOut},
		Desktop:    proclimit.CurrentDesktop(),
		Mitigation: mitigation, MemLimit: workerMemLimit, UILimits: !iso.SkipUILimits, Detached: true, KillCode: workerKilled,
	})
	closeHandles(childIn, childOut)
	if err != nil {
		closeHandles(parentIn, parentOut)
		return nil, errors.Join(ErrWorker, err)
	}
	p := &workerProc{h: h, job: job}
	pid, _ := windows.GetProcessId(h)
	return newWorker(os.NewFile(uintptr(parentIn), "pdf-isleyici-in"), os.NewFile(uintptr(parentOut), "pdf-isleyici-out"),
		p.waitOrKill, pid), nil
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
	return proclimit.Restrict(self, low)
}

// waitOrKill süreç grace içinde çıkmazsa sonlandırır; çıkış kodunu döner, job'u kapatır (kalan her şey ölür).
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
