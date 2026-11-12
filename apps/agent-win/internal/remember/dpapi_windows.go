//go:build windows

package remember

import (
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// entropy ADR-0004 r3: sabit ek entropi (gizli değil; başka uygulamanın DPAPI çıktısıyla karışmayı önler).
var entropy = []byte("NoktaDestek.remember.v1")

func blob(b []byte) *windows.DataBlob {
	if len(b) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
}

func takeBlob(out *windows.DataBlob) []byte {
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...)
}

// Protect DPAPI CurrentUser (CRYPTPROTECT_LOCAL_MACHINE yok), UI yasak. crypt32.dll x/sys/windows'ta
// NewLazySystemDLL ile yüklenir (G-08).
func Protect(plain []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptProtectData(blob(plain), nil, blob(entropy), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	return takeBlob(&out), nil
}

// Unprotect başka kullanıcının/bozuk dosyada hata döner (çağıran dosyayı siler).
func Unprotect(sealed []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(blob(sealed), nil, blob(entropy), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	return takeBlob(&out), nil
}

// DefaultStore `%LOCALAPPDATA%\NoktaDestek` (Roaming değil; SHGetKnownFolderPath FOLDERID_LocalAppData).
func DefaultStore() (*Store, error) {
	base, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return nil, err
	}
	return &Store{Dir: filepath.Join(base, "NoktaDestek"), Protect: Protect, Unprotect: Unprotect}, nil
}
