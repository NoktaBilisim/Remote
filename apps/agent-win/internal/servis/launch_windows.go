//go:build windows

package servis

import (
	"errors"
	"io"
	"os"
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
// mitigasyonları ve HANDLE_LIST = girdi borusunun okuma ucu + durum borusunun yazma ucu (P28u §7.4, ADR-0033). Girdi
// (bilet dahil) yalnız giriş borusundan geçer: ilk satır Input, sonraki satırlar komut; boru oturum boyunca açık kalır.
// Durum borusu (yardımcının stdout'u) tek yöndür; servis Core.readStatus ile süzer.

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
	inR, inW, err := inheritPipe(true)
	if err != nil {
		return nil, err
	}
	stR, stW, err := inheritPipe(false)
	if err != nil {
		_ = windows.CloseHandle(inR)
		_ = windows.CloseHandle(inW)
		return nil, err
	}
	p, err := l.start(tok, inR, stW)
	_ = windows.CloseHandle(inR)
	_ = windows.CloseHandle(stW) // tek yazar yardımcı: çıkınca okuyucu EOF alır
	if err != nil {
		_ = windows.CloseHandle(inW)
		_ = windows.CloseHandle(stR)
		return nil, err
	}
	p.in, p.status, p.session = inW, os.NewFile(uintptr(stR), "helper-status"), session
	if err := p.write(append(data, '\n')); err != nil {
		_ = p.Kill()
		p.Wait()
		_ = p.status.Close()
		return nil, errors.Join(errors.New("servis: yardımcı girdisi yazılamadı"), err)
	}
	return p, nil
}

// inheritPipe anonim boru; yalnız çocuğa geçecek uç devralınabilir (childReads: okuma ucu çocuğun).
func inheritPipe(childReads bool) (r, w windows.Handle, err error) {
	sa := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), InheritHandle: 1}
	if err := windows.CreatePipe(&r, &w, &sa, helperPipeSize); err != nil {
		return 0, 0, err
	}
	own := w
	if !childReads {
		own = r
	}
	_ = windows.SetHandleInformation(own, windows.HANDLE_FLAG_INHERIT, 0)
	return r, w, nil
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

// start süreci proclimit.Spawn ile askıda oluşturur, job'a atar ve devam ettirir. HANDLE_LIST = girdi okuma ucu +
// durum yazma ucu (iki tanıtıcı); mitigation yalnız görüntü yükleme üçlüsü (P27 davranışı).
func (l WinLauncher) start(tok windows.Token, stdin, status windows.Handle) (*winProcess, error) {
	cmd, err := quoted(l.Exe, "--helper")
	if err != nil {
		return nil, err
	}
	h, job, err := proclimit.Spawn(proclimit.Spec{
		Token: tok, Exe: l.Exe, CmdLine: cmd, Desktop: helperDesktop, Stdin: stdin, Stdout: status,
		Handles: []windows.Handle{stdin, status}, Mitigation: proclimit.MitigationImageLoad,
		KillCode: helperio.ExitKilledByService,
	})
	if err != nil {
		return nil, err
	}
	return &winProcess{h: h, job: job}, nil
}

// winProcess job'lı yardımcı süreç. in: giriş borusunun yazma ucu (komutlar); status: durum borusunun okuma ucu.
type winProcess struct {
	mu      sync.Mutex
	h, job  windows.Handle
	in      windows.Handle
	status  *os.File
	session uint32
	closed  bool
}

// WinSession yardımcının başlatıldığı konsol oturumu (D-P28u-3 hedefi).
func (p *winProcess) WinSession() uint32 { return p.session }

// StatusPipe durum borusu okuma ucu.
func (p *winProcess) StatusPipe() io.Reader { return p.status }

// Command giriş borusuna tek komut satırı.
func (p *winProcess) Command(cmd helperio.Command) error {
	b, err := helperio.EncodeCommand(cmd)
	if err != nil {
		return err
	}
	return p.write(b)
}

func (p *winProcess) write(b []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || p.in == 0 {
		return errors.New("servis: yardımcı bitti")
	}
	var n uint32
	if err := windows.WriteFile(p.in, b, &n, nil); err != nil {
		return err
	}
	if int(n) != len(b) {
		return errors.New("servis: boruya kısa yazım")
	}
	return nil
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
		if p.in != 0 {
			_ = windows.CloseHandle(p.in)
		}
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
