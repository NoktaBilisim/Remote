//go:build windows

package helper

import (
	"errors"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// `Gelen` klasörü (mimari-p27 §5.6 r2, Y-P27-2 m.3; AC-340): her dosya yazımından önce klasör reparse denetimiyle
// (bağlantı izlenmeden) açılır, kendisi reparse noktası olmamalı ve GetFinalPathNameByHandle sonucu beklenen tam yol
// (`%ProgramData%\NoktaDestek Servis\Gelen`) olmalıdır — ara bileşendeki junction/symlink de gerçek yolu değiştirdiği
// için reddedilir. Oturum boyunca klasör FILE_SHARE_DELETE verilmeden açık tutulur (yeniden adlandırılamaz/değiştirilemez).

const (
	dirAccess  = windows.FILE_LIST_DIRECTORY | windows.FILE_READ_ATTRIBUTES | windows.SYNCHRONIZE
	shareNoDel = windows.FILE_SHARE_READ | windows.FILE_SHARE_WRITE
	openFlags  = windows.FILE_FLAG_OPEN_REPARSE_POINT | windows.FILE_FLAG_BACKUP_SEMANTICS
)

var errRedirected = errors.New("helper: Gelen klasörü yönlendirilmiş")

type attrTagInfo struct {
	Attributes uint32
	ReparseTag uint32
}

// incoming sabitlenmiş `Gelen` klasörü.
type incoming struct {
	dir  string
	hold windows.Handle
}

// openIncoming klasörü doğrular ve oturum boyunca sabitler; hata → dosya teklifleri otomatik reddedilir.
func openIncoming() (*incoming, error) {
	base, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, 0)
	if err != nil {
		return nil, err
	}
	in := &incoming{dir: filepath.Join(base, dataDirName, incomingDirName)}
	h, err := in.open()
	if err != nil {
		return nil, err
	}
	in.hold = h
	return in, nil
}

// Check her yazımdan önceki denetim (transfer.Deps.CheckDir).
func (in *incoming) Check() error {
	h, err := in.open()
	if err != nil {
		return err
	}
	return windows.CloseHandle(h)
}

func (in *incoming) open() (windows.Handle, error) {
	p, err := windows.UTF16PtrFromString(in.dir)
	if err != nil {
		return windows.InvalidHandle, err
	}
	h, err := windows.CreateFile(p, dirAccess, shareNoDel, nil, windows.OPEN_EXISTING, openFlags, 0)
	if err != nil {
		return windows.InvalidHandle, err
	}
	if err := in.verify(h); err != nil {
		_ = windows.CloseHandle(h)
		return windows.InvalidHandle, err
	}
	return h, nil
}

func (in *incoming) verify(h windows.Handle) error {
	var ti attrTagInfo
	if err := windows.GetFileInformationByHandleEx(h, windows.FileAttributeTagInfo, (*byte)(unsafe.Pointer(&ti)),
		uint32(unsafe.Sizeof(ti))); err != nil {
		return err
	}
	if ti.Attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || ti.Attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		return errRedirected
	}
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n, err := windows.GetFinalPathNameByHandle(h, &buf[0], uint32(len(buf)), 0)
	if err != nil {
		return err
	}
	if int(n) >= len(buf) || !samePath(windows.UTF16ToString(buf[:n]), in.dir) {
		return errRedirected
	}
	return nil
}

// Close sabitlemeyi bırakır (nil güvenli).
func (in *incoming) Close() {
	if in != nil && in.hold != windows.InvalidHandle && in.hold != 0 {
		_ = windows.CloseHandle(in.hold)
		in.hold = 0
	}
}
