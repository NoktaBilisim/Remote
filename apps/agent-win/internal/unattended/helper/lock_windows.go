//go:build windows

package helper

import (
	"errors"
	"runtime"
	"time"

	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/win"
)

// AC-443 / mimari-p28u §7.5: kilit yardımcıda, Default masaüstüne bağlı kısa ömürlü bir iş parçacığında LockWorkStation.
// K6s soru 1 (kısıtlı SYSTEM jetonu) elle ölçülene dek açık: K-P28u-5b gerekirse kilit servise taşınır ve bu yol
// kullanılmaz (Locker arayüzü; servis `lock` komutunu yardımcıya hiç göndermez).

var errNotDefault = errors.New("helper: giriş masaüstü Default değil")

// lockWait §7.5 / AC-443: kilit ≤ 2 sn içinde görülmeli.
const lockWait = 2 * time.Second

func newWinLocker() Locker {
	return stationLocker{lock: lockOnDefault, desktop: desktop.InputName, wait: lockWait}
}

func lockOnDefault() error {
	res := make(chan error, 1)
	go func() {
		runtime.LockOSThread() // bilerek açılmaz: iş parçacığı masaüstü bağıyla biter
		name, release, err := desktop.Attach()
		if err != nil {
			res <- err
			return
		}
		defer release()
		switch name {
		case "Winlogon":
			res <- nil // zaten kilitli: doğrulama (Winlogon) sonucu verir
			return
		case "Default":
		default:
			res <- errNotDefault // UAC/ekran koruyucu: kilitlenmedi sayılır
			return
		}
		res <- win.LockWorkStation()
	}()
	return <-res
}
