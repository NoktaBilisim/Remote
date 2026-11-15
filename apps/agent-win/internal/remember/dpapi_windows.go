//go:build windows

package remember

import (
	"errors"
	"fmt"
	"path/filepath"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Sabit ek entropi (gizli değil; başka uygulamanın DPAPI çıktısıyla karışmayı önler). `kayitlar.bin` v3 için yeni
// değer (alan ayrımı, ADR-0004 r6); `hatirla.bin` (v1/v2) eski değerle yalnız göçte çözülür.
var (
	entropy       = []byte("NoktaDestek.kayit.v3")
	legacyEntropy = []byte("NoktaDestek.remember.v1")
)

// HRESULT kodları (CryptUnprotectData GetLastError olarak döndürür).
const (
	nteBadData     = 0x80090005
	nteBadKeyState = 0x8009000B
)

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

// dpapiClass G-P20-3/18: ERROR_INVALID_DATA ve NTE_BAD_DATA kesin biçim hatası (sınıf 1, dosya silinir);
// NTE_BAD_KEY_STATE ve diğerleri geçici (sınıf 2, dokunulmaz).
func dpapiClass(err error) error {
	var en syscall.Errno
	if errors.As(err, &en) {
		switch uint32(en) {
		case uint32(windows.ERROR_INVALID_DATA), nteBadData:
			return fmt.Errorf("%w: %w", errCorrupt, err)
		case nteBadKeyState:
			return fmt.Errorf("%w: %w", errKeyState, err)
		}
	}
	return fmt.Errorf("%w: %w", errDPAPI, err)
}

func protect(plain, ent []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptProtectData(blob(plain), nil, blob(ent), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("%w: %w", errDPAPI, err)
	}
	return takeBlob(&out), nil
}

func unprotect(sealed, ent []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(blob(sealed), nil, blob(ent), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, dpapiClass(err)
	}
	return takeBlob(&out), nil
}

// Protect DPAPI CurrentUser (CRYPTPROTECT_LOCAL_MACHINE yok), UI yasak. crypt32.dll x/sys/windows'ta
// NewLazySystemDLL ile yüklenir (G-08).
func Protect(plain []byte) ([]byte, error) { return protect(plain, entropy) }

// Unprotect `kayitlar.bin`; hata sınıflandırılmış döner (dpapiClass).
func Unprotect(sealed []byte) ([]byte, error) { return unprotect(sealed, entropy) }

// UnprotectLegacy `hatirla.bin` (v1/v2, eski entropi); yalnız Migrate.
func UnprotectLegacy(sealed []byte) ([]byte, error) { return unprotect(sealed, legacyEntropy) }

// DefaultStore `%LOCALAPPDATA%\NoktaDestek` (Roaming değil; SHGetKnownFolderPath FOLDERID_LocalAppData).
func DefaultStore() (*Store, error) {
	base, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return nil, err
	}
	return &Store{Dir: filepath.Join(base, "NoktaDestek"), Protect: Protect, Unprotect: Unprotect,
		UnprotectLegacy: UnprotectLegacy}, nil
}
