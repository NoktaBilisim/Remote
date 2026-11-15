//go:build windows && (amd64 || arm64)

package diag

import (
	"errors"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// renameInfo FILE_RENAME_INFORMATION (yalnız 64 bit düzen, S-P17-5; 32 bit Windows: reparse_unsupported_windows.go;
// amd64/arm64: ReplaceIfExists@0, RootDirectory@8, FileNameLength@16 (bayt),
// FileName@20). Ad yalnız dosya adıdır (ayırıcı yok) ve RootDirectory boştur: NtSetInformationFile bunu aynı klasör
// içinde yeniden adlandırma olarak işler, yol çözümlemesi yapılmaz. kernel32 SetFileInformationByHandle(FileRenameInfo)
// KULLANILMAZ: göreli adı geçerli çalışma klasörüne göre DOS yoluna çevirir (CI'da D:\ → ERROR_NOT_SAME_DEVICE).
type renameInfo struct {
	Flags   uint32 // ReplaceIfExists (BOOLEAN, ilk bayt) = 1
	_       uint32
	Root    windows.Handle
	NameLen uint32
	Name    [256]uint16
}

// Rename klasör içinde from → to (handle üzerinden NtSetInformationFile(FileRenameInformation), var olan hedefin
// üzerine; klasör sabit olduğundan hedef aynı klasördür). Kaynak veya hedef
// reparse noktasıysa ErrReparse.
func (d *Dir) Rename(from, to string) error {
	src, err := d.child(from)
	if err != nil {
		return err
	}
	dst, err := d.child(to)
	if err != nil {
		return err
	}
	name, err := windows.UTF16FromString(to)
	if err != nil || len(name) > len(renameInfo{}.Name) {
		return errors.New("diag: geçersiz dosya adı")
	}
	h, err := openChecked(src, windows.DELETE|windows.FILE_READ_ATTRIBUTES|windows.SYNCHRONIZE, 0, windows.OPEN_EXISTING, false)
	if err != nil {
		return err
	}
	defer func() { _ = windows.CloseHandle(h) }()
	if t, terr := openChecked(dst, windows.FILE_READ_ATTRIBUTES, shareAll, windows.OPEN_EXISTING, false); terr == nil {
		_ = windows.CloseHandle(t)
	} else if !notExist(terr) {
		return terr
	}
	ri := renameInfo{Flags: 1, NameLen: uint32((len(name) - 1) * 2)}
	copy(ri.Name[:], name)
	var iosb windows.IO_STATUS_BLOCK
	// Uzunluk en az sizeof(FILE_RENAME_INFORMATION) (amd64'te 24) olmalı; offset+NameLen kısa adlarda bunun altında
	// kalır ve STATUS_INFO_LENGTH_MISMATCH döner. Tüm yapı boyutu verilir; çekirdek FileNameLength'i kullanır.
	size := uint32(unsafe.Sizeof(ri))
	if st := windows.NtSetInformationFile(h, &iosb, (*byte)(unsafe.Pointer(&ri)), size, windows.FileRenameInformation); st != nil {
		return &os.LinkError{Op: "rename", Old: from, New: to, Err: st}
	}
	return nil
}
