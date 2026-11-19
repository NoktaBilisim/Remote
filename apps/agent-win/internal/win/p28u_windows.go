//go:build windows

package win

// P28u (mimari-p28u §7.5): müdahale kilidi (LockWorkStation). r3 (§r3.7): onay diyaloğunun örtülme taraması
// (GW_HWNDPREV zinciri, WindowFromPoint) diyalogla birlikte kaldırıldı.

var pLockWorkStation = user32.NewProc("LockWorkStation")

// LockWorkStation iş istasyonunu kilitler (çağıran iş parçacığı giriş masaüstünde olmalı); başarısızsa hata.
func LockWorkStation() error {
	if r, _, err := pLockWorkStation.Call(); r == 0 {
		return err
	}
	return nil
}
