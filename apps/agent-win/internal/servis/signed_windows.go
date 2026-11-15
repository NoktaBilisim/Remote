//go:build windows

package servis

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// SelfSigned ikilinin Authenticode imzası geçerli mi (WinVerifyTrust, UI yok, iptal denetimi yok). Beyan yalnız
// kullanılabilirlik kapısıdır (AC-297), kimlik doğrulama değildir.
func SelfSigned(exe string) bool {
	p, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return false
	}
	fi := windows.WinTrustFileInfo{Size: uint32(unsafe.Sizeof(windows.WinTrustFileInfo{})), FilePath: p}
	data := &windows.WinTrustData{
		Size:                            uint32(unsafe.Sizeof(windows.WinTrustData{})),
		UIChoice:                        windows.WTD_UI_NONE,
		RevocationChecks:                windows.WTD_REVOKE_NONE,
		UnionChoice:                     windows.WTD_CHOICE_FILE,
		StateAction:                     windows.WTD_STATEACTION_VERIFY,
		FileOrCatalogOrBlobOrSgnrOrCert: unsafe.Pointer(&fi),
	}
	verr := windows.WinVerifyTrustEx(windows.InvalidHWND, &windows.WINTRUST_ACTION_GENERIC_VERIFY_V2, data)
	data.StateAction = windows.WTD_STATEACTION_CLOSE
	_ = windows.WinVerifyTrustEx(windows.InvalidHWND, &windows.WINTRUST_ACTION_GENERIC_VERIFY_V2, data)
	return verr == nil
}
