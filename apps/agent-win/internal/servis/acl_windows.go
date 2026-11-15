//go:build windows

package servis

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/diag"
)

// Klasör güvenliği (mimari-p27 §5.3 r2, K-P27-15, D-P27-r2-1; AC-340).

const inheritedACE = 0x10 // INHERITED_ACE

// ErrFolderUnsafe klasör güvenli değil (kurulum durur / servis bağlanmaz).
var ErrFolderUnsafe = errors.New("servis: klasör güvenli değil")

// createSecureDir klasörü TEK çağrıda sahip + korumalı DACL ile oluşturur. Klasör zaten varsa (yeniden adlandırma
// ile oluşturma arasındaki yarış dahil) hata döner; yeniden denenmez (D-P27-r2-1).
func createSecureDir(path, sddl string) error {
	sd, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return err
	}
	sa := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	if err := windows.CreateDirectory(p, sa); err != nil {
		if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
			return fmt.Errorf("%w: klasör beklenmedik biçimde var", ErrFolderUnsafe)
		}
		return err
	}
	return nil
}

// PrepareDataDir kurulum: varsa eski klasörü `<ad>.eski-<zaman>` olarak kenara alır (içinde başkasının bıraktığı
// dosya/bağlantı kullanılmaz), sonra `%ProgramData%\NoktaDestek Servis` ve `Gelen\` klasörlerini güvenli oluşturur.
// moved: eski klasör yeniden adlandırıldı (olay 1004 `folder_renamed`).
func PrepareDataDir(dataDir string) (moved bool, err error) {
	if _, err := os.Lstat(dataDir); err == nil {
		old := fmt.Sprintf("%s.eski-%s", dataDir, time.Now().UTC().Format("20060102T150405Z"))
		if err := os.Rename(dataDir, old); err != nil {
			return false, fmt.Errorf("%w: eski klasör kenara alınamadı", ErrFolderUnsafe)
		}
		moved = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	if err := createSecureDir(dataDir, DataDirSDDL); err != nil {
		return moved, err
	}
	return moved, createSecureDir(filepath.Join(dataDir, IncomingDirName), IncomingDirSDDL)
}

// VerifyDataDir servis açılışı (fail-closed): veri klasörü ve `Gelen\` reparse değil, sahibi SY/BA, DACL korumalı ve
// beklenen ACE kümesiyle birebir; `device.key` (varsa) reparse değil, sahibi SY/BA, yalnız SY/BA'ya izin.
func VerifyDataDir(dataDir string) error {
	d, err := diag.OpenDir(dataDir, false) // üst klasör + klasör sabitlenir, reparse reddedilir
	if err != nil {
		return fmt.Errorf("%w: %w", ErrFolderUnsafe, err)
	}
	defer d.Close()
	in, err := diag.OpenDir(filepath.Join(dataDir, IncomingDirName), false)
	if err != nil {
		return fmt.Errorf("%w: Gelen: %w", ErrFolderUnsafe, err)
	}
	defer in.Close()
	if err := verifyDir(dataDir, DataDirSDDL); err != nil {
		return err
	}
	if err := verifyDir(filepath.Join(dataDir, IncomingDirName), IncomingDirSDDL); err != nil {
		return err
	}
	return verifyKeyFile(d)
}

func verifyDir(path, sddl string) error {
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	want, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return err
	}
	owner, got, protected, err := describe(sd)
	if err != nil {
		return err
	}
	_, wantACEs, _, err := describe(want)
	if err != nil {
		return err
	}
	if !OwnerOK(owner) {
		return fmt.Errorf("%w: sahip %s", ErrFolderUnsafe, owner)
	}
	if err := DirACLOK(protected, got, wantACEs); err != nil {
		return fmt.Errorf("%w: %w", ErrFolderUnsafe, err)
	}
	return nil
}

func verifyKeyFile(d *diag.Dir) error {
	f, err := d.Open(KeyFile, diag.ModeRead)
	if errors.Is(err, os.ErrNotExist) {
		return nil // ilk açılış: geçici anahtar henüz taşınmadı
	}
	if err != nil {
		return fmt.Errorf("%w: %s: %w", ErrFolderUnsafe, KeyFile, err)
	}
	defer f.Close()
	sd, err := windows.GetSecurityInfo(windows.Handle(f.Fd()), windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	owner, aces, _, err := describe(sd)
	if err != nil {
		return err
	}
	if !OwnerOK(owner) {
		return fmt.Errorf("%w: %s sahibi %s", ErrFolderUnsafe, KeyFile, owner)
	}
	if err := FileACLOK(aces); err != nil {
		return fmt.Errorf("%w: %w", ErrFolderUnsafe, err)
	}
	return nil
}

// describe sahip SID'i, DACL ACE'leri ve korumalı bayrağını çıkarır.
func describe(sd *windows.SECURITY_DESCRIPTOR) (string, []ACE, bool, error) {
	owner := ""
	if o, _, err := sd.Owner(); err == nil && o != nil {
		owner = o.String()
	}
	ctrl, _, err := sd.Control()
	if err != nil {
		return "", nil, false, err
	}
	dacl, _, err := sd.DACL()
	if err != nil || dacl == nil {
		return "", nil, false, fmt.Errorf("%w: DACL yok", ErrFolderUnsafe)
	}
	aces := make([]ACE, 0, dacl.AceCount)
	for i := uint32(0); i < uint32(dacl.AceCount); i++ {
		var a *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, i, &a); err != nil {
			return "", nil, false, err
		}
		if a.Header.AceType > 1 { // yalnız ACCESS_ALLOWED / ACCESS_DENIED beklenir
			return "", nil, false, fmt.Errorf("%w: ACE türü %d", ErrFolderUnsafe, a.Header.AceType)
		}
		sid := (*windows.SID)(unsafe.Pointer(&a.SidStart))
		aces = append(aces, ACE{Type: a.Header.AceType, Flags: a.Header.AceFlags &^ inheritedACE, Mask: uint32(a.Mask),
			SID: sid.String(), Inherited: a.Header.AceFlags&inheritedACE != 0})
	}
	return owner, aces, ctrl&windows.SE_DACL_PROTECTED != 0, nil
}
