//go:build windows

package servis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/config"
)

// SCM servisi (`--service`, LocalSystem, oturum 0; mimari-p27 §5.1–5.2). Açılış sırası fail-closed: klasör/anahtar
// ACL doğrulaması (AC-340) → HKLM kaydı → cihaz anahtarı (gerekirse SYSTEM DPAPI'ye taşıma) → `/ws/device` + kayıt
// defteri izleyicisi. Denetim başarısızsa olay 1004 yazılır, sunucuya bağlanılmaz ve yardımcı başlatılamaz; boru
// yalnız `status`/`disable` için çalışmayı sürdürür (servis durmaz → SCM yeniden başlatma döngüsü yok).

const (
	// StateUnsafe açılış denetimi başarısız (klasör/anahtar/kayıt).
	StateUnsafe = "unsafe"
	stopWait    = 5 * time.Second
)

// RunService SCM'ye bağlanır; dönüş süreç çıkış kodudur.
func RunService(cfg config.Config) int {
	exe, err := os.Executable()
	if err != nil {
		return 1
	}
	if err := svc.Run(ServiceName, &handler{cfg: cfg, exe: exe}); err != nil {
		return 1
	}
	return 0
}

type handler struct {
	cfg config.Config
	exe string
}

// Execute svc.Handler.
func (h *handler) Execute(_ []string, req <-chan svc.ChangeRequest, st chan<- svc.Status) (bool, uint32) {
	st <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	events := OpenEventLog()
	defer events.Close()
	core, wg := h.start(ctx, events)
	st <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown | svc.AcceptSessionChange}
	for c := range req {
		switch c.Cmd {
		case svc.Interrogate:
			st <- c.CurrentStatus
		case svc.SessionChange:
			// Olay yalnız tetikleyici (EventData okunmaz): konsol geçişi K-P27-12, device.user (r3: logon bitirmez).
			core.SessionEvent(c.EventType)
		case svc.Stop, svc.Shutdown:
			st <- svc.Status{State: svc.StopPending}
			core.Kill(KillServiceStop)
			cancel()
			waitGroup(wg, stopWait)
			return false, 0
		}
	}
	cancel()
	return false, 0
}

// start çekirdeği kurar ve arka plan işlerini başlatır.
func (h *handler) start(ctx context.Context, events *EventLog) (*Core, *sync.WaitGroup) {
	core := &Core{Switch: RegSwitch{}, Launch: WinLauncher{Exe: h.exe}, Events: events, Send: func(any) {},
		Sessions: winSessions{}}
	core.State = func() string { return StateUnsafe }
	wg := &sync.WaitGroup{}
	pipe := &PipeServer{Handler: core, Events: events}
	wg.Go(func() { _ = pipe.Serve(ctx) })
	id, err := h.identity()
	if err != nil {
		events.Write(EvReject(failReason(err), ""))
		return core, wg
	}
	client := NewDeviceClient(api.New(h.cfg.ServerURL, h.cfg.Version).HTTPClient(), h.cfg.ServerURL, id, core, events)
	core.Send, core.State, core.OnUnregister = client.Send, client.State, client.Unregister
	core.Consent1, core.Record1 = client.Consent1, client.Record1
	core.Init()
	wg.Go(func() { _ = WatchLocal(ctx, core.LocalChanged) })
	wg.Go(func() { _ = client.Run(ctx) })
	return core, wg
}

type startError struct {
	reason string
	err    error
}

func (e *startError) Error() string { return e.reason + ": " + e.err.Error() }

func failReason(err error) string {
	if se, ok := err.(*startError); ok {
		return se.reason
	}
	return ReasonKey
}

// identity açılış denetimleri ve `device.auth` alanları.
func (h *handler) identity() (Identity, error) {
	dataDir, err := DataDir()
	if err == nil {
		err = VerifyDataDir(dataDir)
	}
	if err != nil {
		return Identity{}, &startError{ReasonFolderACL, err}
	}
	reg, err := ReadRegistration()
	if err != nil {
		return Identity{}, &startError{ReasonKey, err}
	}
	files, closeFiles, err := OpenKeyFiles(dataDir)
	if err != nil {
		return Identity{}, &startError{ReasonFolderACL, err}
	}
	key, err := LoadKey(files, MachineDPAPI, UserDPAPI)
	closeFiles()
	if err != nil {
		return Identity{}, &startError{ReasonKey, err}
	}
	sum, err := fileSHA256(h.exe)
	if err != nil {
		return Identity{}, &startError{ReasonKey, err}
	}
	return Identity{DeviceID: reg.DeviceID, Key: key, Origin: Origin(h.cfg.ServerURL), Version: h.cfg.Version,
		SHA256: sum, OSVersion: OSVersion(), Signed: SelfSigned(h.exe)}, nil
}

// OSVersion "Windows 10.0.<yapı>" (cihazın beyanı; ≤ 64 karakter).
func OSVersion() string {
	v := windows.RtlGetVersion()
	return fmt.Sprintf("Windows %d.%d.%d", v.MajorVersion, v.MinorVersion, v.BuildNumber)
}

// fileSHA256 ikilinin tam SHA-256'sı (küçük hex).
func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func waitGroup(wg *sync.WaitGroup, d time.Duration) {
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(d):
	}
}
