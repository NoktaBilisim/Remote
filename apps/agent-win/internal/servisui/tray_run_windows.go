//go:build windows

package servisui

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/servis"
	"remote-support/agent-win/internal/ui"
)

// Tepsi döngüsü (`--tray`; HKLM Run her oturum açan kullanıcı için başlatır). Kurulu değilse sessizce çıkar; kaldırma
// sırasında HKLM kaydı silinince çıkar (kurulu ikiliyi kilitlemez). Durum 3 sn'de bir ve `LocalEnabled` her
// değiştiğinde (RegNotifyChangeKeyValue) okunur → yerel kapatma ipucuna anında yansır (AC-295).

const (
	trayPoll         = 3 * time.Second
	trayMutexPrefix  = `Local\NoktaDestekServis.Tray.`
	trayMutexHashLen = 16
)

func runTray(version string) int {
	if _, err := servis.ReadRegistration(); err != nil {
		return 0
	}
	lock, ok := acquireTrayLock()
	if !ok {
		return 0 // aynı kullanıcının tepsisi zaten çalışıyor
	}
	restart := false
	defer func() {
		_ = windows.CloseHandle(lock)
		if restart { // K-P29-21: tek örnek kilidi bırakıldıktan SONRA kurulu yoldan yeni tepsi
			startTray()
		}
	}()
	last := Merge(Snapshot{}, readSnapshot(version))
	ic, err := startIcon(ui.SystemLogo(), Compute(last))
	if err != nil {
		return 1
	}
	defer ic.close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	changed := make(chan struct{}, 1)
	go watchLocal(ctx, changed)
	t := time.NewTicker(trayPoll)
	defer t.Stop()
	var settings *window
	for last.Installed {
		ic.setView(Compute(last))
		select {
		case <-t.C:
		case <-changed:
		case c := <-ic.cmds:
			settings = trayCommand(c, settings, version)
		}
		last = Merge(last, readSnapshot(version))
		if TrayRestart(last) {
			restart = true
			break
		}
	}
	if settings != nil {
		settings.p.Close()
	}
	return 0
}

// watchLocal HKLM değişiminde changed'e sinyal verir; izleme biterse (anahtar silindi) bir kez daha sinyal.
func watchLocal(ctx context.Context, changed chan<- struct{}) {
	ping := func() {
		select {
		case changed <- struct{}{}:
		default:
		}
	}
	_ = servis.WatchLocal(ctx, ping)
	ping()
}

// trayCommand menü/simge komutu. Ayar penceresi süreçte tektir (açıksa öne gelir); bekleyebilecek işler goroutine'de.
func trayCommand(c trayCmd, settings *window, version string) *window {
	switch c {
	case cmdSettings:
		if settings != nil && !closed(settings) {
			settings.p.Raise()
			return settings
		}
		w, err := openWindow(version, false)
		if err != nil {
			return nil
		}
		return w
	case cmdDisable:
		go func() {
			if msg := disableLocal(); msg != "" {
				ui.ShowError(msg)
			}
		}()
	case cmdEnable:
		go func() {
			if _, err := elevate(0, "--enable"); err != nil {
				ui.ShowError(ErrElevateText)
			}
		}()
	}
	return settings
}

func closed(w *window) bool {
	select {
	case <-w.p.Done():
		return true
	default:
		return false
	}
}

// acquireTrayLock kullanıcı başına tek tepsi: `Local\NoktaDestekServis.Tray.<SID SHA-256 ilk 16 hane>` (P20 tepsisinden
// ayrı ad). Var olan mutex'in sahibi geçerli kullanıcı değilse (başkasının önceden aldığı ad) tek örnek kuralı yok
// sayılır ve tepsi yine başlar (gözetim şeffaflığı engellenemez; P20 G-P20-16 kalıbı).
func acquireTrayLock() (windows.Handle, bool) {
	tu, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return 0, true
	}
	user := tu.User.Sid
	sum := sha256.Sum256([]byte(user.String()))
	name, err1 := windows.UTF16PtrFromString(trayMutexPrefix + hex.EncodeToString(sum[:])[:trayMutexHashLen])
	sd, err2 := windows.SecurityDescriptorFromString("O:" + user.String())
	if errors.Join(err1, err2) != nil {
		return 0, true
	}
	sa := windows.SecurityAttributes{SecurityDescriptor: sd}
	sa.Length = uint32(unsafe.Sizeof(sa))
	h, err := windows.CreateMutex(&sa, false, name)
	if err == nil || h == 0 || !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return h, true
	}
	owned := ownedBy(h, user)
	if owned {
		_ = windows.CloseHandle(h)
		return 0, false
	}
	return h, true
}

func ownedBy(h windows.Handle, user *windows.SID) bool {
	sd, err := windows.GetSecurityInfo(h, windows.SE_KERNEL_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return false
	}
	owner, _, err := sd.Owner()
	return err == nil && owner != nil && owner.Equals(user)
}
