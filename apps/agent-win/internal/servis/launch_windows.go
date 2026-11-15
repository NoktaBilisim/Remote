//go:build windows

package servis

import (
	"errors"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/proclimit"
	"remote-support/agent-win/internal/servis/helperio"
)

// Yardımcı başlatma (mimari-p27 §5.2, r2 Y-P27-3/K-P27-16; AC-341): servisin SYSTEM jetonunun kopyası
// `CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)` ile kısıtlanır (yalnız SeChangeNotify kalır), oturumu etkin konsol
// oturumuna ayarlanır ve `winsta0\default`'ta `CREATE_SUSPENDED` başlatılır; süreç job'a (tek süreç, kill-on-close,
// işlenmeyen istisnada ölüm) atandıktan sonra devam ettirilir. Öznitelik listesi: çocuk süreç yasağı, görüntü yükleme
// mitigasyonları ve HANDLE_LIST = yalnız girdi borusunun okuma ucu. Girdi (bilet dahil) yalnız bu borudan geçer.

const (
	noConsoleSession = 0xFFFFFFFF
	helperDesktop    = `winsta0\default`
	helperPipeSize   = 8192
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
	restricted, err := proclimit.Restrict(dup, false)
	if err != nil {
		return 0, err
	}
	if err := windows.SetTokenInformation(restricted, windows.TokenSessionId, (*byte)(unsafe.Pointer(&session)),
		uint32(unsafe.Sizeof(session))); err != nil {
		restricted.Close()
		return 0, err
	}
	return restricted, nil
}

// start süreci proclimit.Spawn ile askıda oluşturur, job'a atar ve devam ettirir. HANDLE_LIST = yalnız girdi borusunun
// okuma ucu; mitigation yalnız görüntü yükleme üçlüsü (P27 davranışı).
func (l WinLauncher) start(tok windows.Token, stdin windows.Handle) (*winProcess, error) {
	cmd, err := quoted(l.Exe, "--helper")
	if err != nil {
		return nil, err
	}
	h, job, err := proclimit.Spawn(proclimit.Spec{
		Token: tok, Exe: l.Exe, CmdLine: cmd, Desktop: helperDesktop, Stdin: stdin,
		Handles: []windows.Handle{stdin}, Mitigation: proclimit.MitigationImageLoad,
		KillCode: helperio.ExitKilledByService,
	})
	if err != nil {
		return nil, err
	}
	return &winProcess{h: h, job: job}, nil
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
