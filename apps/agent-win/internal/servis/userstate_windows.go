//go:build windows

package servis

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

// WTS erişimi (mimari-p28u §7.2, §7.5; K6s spike'tan taşındı). `WTSQuerySessionInformationW(WTSSessionInfoEx)` →
// WTSINFOEX_LEVEL1_W: SessionFlags (LOCK/UNLOCK) ve UserName (yalnız dolu/boş kullanılır; loga yazılmaz).
// `WTSLogoffSession` x/sys'te olmadığından wtsapi32'den yüklenir.

const (
	wtsSessionInfoEx = 25 // WTS_INFO_CLASS WTSSessionInfoEx
	wtsStateLock     = 0  // WTS_SESSIONSTATE_LOCK
	wtsStateUnlock   = 1  // WTS_SESSIONSTATE_UNLOCK
)

var (
	wtsapi32                = windows.NewLazySystemDLL("wtsapi32.dll")
	procWTSQuerySessionInfo = wtsapi32.NewProc("WTSQuerySessionInformationW")
	procWTSLogoffSession    = wtsapi32.NewProc("WTSLogoffSession")
	procWTSFreeMemory       = wtsapi32.NewProc("WTSFreeMemory")
)

// wtsInfoEx WTSINFOEXW'nin başı: Level, (8 bayt hizalı birleşim) WTSINFOEX_LEVEL1_W alanları.
type wtsInfoEx struct {
	Level     uint32
	_         uint32
	SessionID uint32
	State     int32
	Flags     int32
	Station   [33]uint16
	User      [21]uint16
	Domain    [18]uint16
}

// winSessions Sessions'ın Windows uygulaması (servis Session 0, LocalSystem).
type winSessions struct{}

func (winSessions) Console() (uint32, bool) {
	id := windows.WTSGetActiveConsoleSessionId()
	return id, id != noConsoleSession
}

func (winSessions) Info(id uint32) (SessionInfo, error) {
	var buf *wtsInfoEx
	var n uint32
	r, _, e := procWTSQuerySessionInfo.Call(0, uintptr(id), wtsSessionInfoEx, uintptr(unsafe.Pointer(&buf)),
		uintptr(unsafe.Pointer(&n)))
	if r == 0 {
		return SessionInfo{}, e
	}
	short := uintptr(n) < unsafe.Sizeof(wtsInfoEx{})
	var info wtsInfoEx
	if !short {
		info = *buf
	}
	_, _, _ = procWTSFreeMemory.Call(uintptr(unsafe.Pointer(buf))) // S6-1: dönüşüm yalnız Call argümanında
	if short || info.Level != 1 || info.SessionID != id {
		return SessionInfo{}, errors.New("servis: WTSINFOEXW beklenmeyen düzen")
	}
	// Yalnız açık LOCK kilitli sayılır (UNKNOWN değil; K6s soru 3 sonucu ters çıkarsa yedek kural §7.5).
	return SessionInfo{User: info.User[0] != 0, Locked: info.Flags == wtsStateLock}, nil
}

// Logoff WTSLogoffSession(WTS_CURRENT_SERVER_HANDLE, id, bWait=FALSE).
func (winSessions) Logoff(id uint32) error {
	if r, _, e := procWTSLogoffSession.Call(0, uintptr(id), 0); r == 0 {
		return e
	}
	return nil
}
