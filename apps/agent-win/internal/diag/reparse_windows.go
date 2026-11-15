//go:build windows

package diag

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// AC-249 (mimari-e11 §8.1): `%LOCALAPPDATA%\NoktaDestek` ve içindeki dosyalar (hatirla.bin, tanılama logu) yalnız
// handle üzerinden açılır, taşınır ve silinir. Her açılış `FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS`
// ile yapılır (bağlantı izlenmez, bağlantının kendisi açılır) ve `GetFileInformationByHandleEx(FileAttributeTagInfo)`
// reparse özniteliği taşıyan her girdiyi (sembolik bağlantı, junction, mount point, bulut yer tutucu) reddeder.
// Klasör zinciri (üst klasör = %LOCALAPPDATA% ve NoktaDestek) FILE_SHARE_DELETE verilmeden açık tutulur: işlem
// süresince klasör yeniden adlandırılamaz/junction ile değiştirilemez (TOCTOU); NoktaDestek'in gerçek yolu üst
// klasörün gerçek yolu + ad olmalıdır (GetFinalPathNameByHandle). Yazma için açılan dosyanın tek bağı olmalıdır
// (sabit bağ/hard link ile başka dosyaya yazma reddi).

type attrTagInfo struct {
	Attributes uint32
	ReparseTag uint32
}

// renameInfo FILE_RENAME_INFORMATION (amd64: ReplaceIfExists@0, RootDirectory@8, FileNameLength@16 (bayt),
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

const (
	dirAccess  = windows.FILE_LIST_DIRECTORY | windows.FILE_READ_ATTRIBUTES | windows.SYNCHRONIZE
	shareNoDel = windows.FILE_SHARE_READ | windows.FILE_SHARE_WRITE
	shareAll   = shareNoDel | windows.FILE_SHARE_DELETE
	openFlags  = windows.FILE_FLAG_OPEN_REPARSE_POINT | windows.FILE_FLAG_BACKUP_SEMANTICS
)

// Dir sabitlenmiş klasör (Windows: üst klasör ve klasörün handle'ları açık).
type Dir struct {
	path   string
	parent windows.Handle
	h      windows.Handle
	delOK  bool // h DELETE erişimiyle açıldı (RemoveIfEmpty)
}

func open(path string, access, share, disposition uint32) (windows.Handle, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return windows.InvalidHandle, err
	}
	h, err := windows.CreateFile(p, access, share, nil, disposition, windows.FILE_ATTRIBUTE_NORMAL|openFlags, 0)
	if err != nil {
		return windows.InvalidHandle, &os.PathError{Op: "open", Path: filepath.Base(path), Err: err}
	}
	return h, nil
}

// checkHandle handle reparse noktasıysa (veya beklenen türde değilse) ErrReparse.
func checkHandle(h windows.Handle, wantDir bool) error {
	var ti attrTagInfo
	if err := windows.GetFileInformationByHandleEx(h, windows.FileAttributeTagInfo, (*byte)(unsafe.Pointer(&ti)),
		uint32(unsafe.Sizeof(ti))); err != nil {
		return err
	}
	if ti.Attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return ErrReparse
	}
	if (ti.Attributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0) != wantDir {
		return ErrReparse
	}
	return nil
}

// openChecked open + checkHandle; reddedilen handle kapatılır.
func openChecked(path string, access, share, disposition uint32, wantDir bool) (windows.Handle, error) {
	h, err := open(path, access, share, disposition)
	if err != nil {
		return h, err
	}
	if err := checkHandle(h, wantDir); err != nil {
		_ = windows.CloseHandle(h)
		return windows.InvalidHandle, err
	}
	return h, nil
}

func finalPath(h windows.Handle) (string, error) {
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n, err := windows.GetFinalPathNameByHandle(h, &buf[0], uint32(len(buf)), 0)
	if err != nil {
		return "", err
	}
	if int(n) >= len(buf) {
		return "", errors.New("diag: yol çok uzun")
	}
	return windows.UTF16ToString(buf[:n]), nil
}

func notExist(err error) bool {
	return errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PATH_NOT_FOUND)
}

// OpenDir klasörü (ve üst klasörünü) reparse denetimiyle açar ve işlem süresince sabitler. create true ise yalnız son
// bileşen oluşturulur (üst klasör var olmalı). Klasör yoksa ve create false ise os.ErrNotExist.
func OpenDir(path string, create bool) (*Dir, error) {
	path = filepath.Clean(path)
	parent, err := openChecked(filepath.Dir(path), dirAccess, shareNoDel, windows.OPEN_EXISTING, true)
	if err != nil {
		return nil, err
	}
	d := &Dir{path: path, parent: parent, h: windows.InvalidHandle}
	if create {
		p, perr := windows.UTF16PtrFromString(path)
		if perr != nil {
			d.Close()
			return nil, perr
		}
		if err := windows.CreateDirectory(p, nil); err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
			d.Close()
			return nil, err
		}
	}
	// DELETE erişimi yalnız RemoveIfEmpty için; başka bir süreç klasörü paylaşımsız tutuyorsa onsuz denenir.
	d.h, err = openChecked(path, dirAccess|windows.DELETE, shareNoDel, windows.OPEN_EXISTING, true)
	d.delOK = err == nil
	if errors.Is(err, windows.ERROR_SHARING_VIOLATION) || errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		d.h, err = openChecked(path, dirAccess, shareNoDel, windows.OPEN_EXISTING, true)
	}
	if err != nil {
		d.Close()
		if notExist(err) {
			return nil, os.ErrNotExist
		}
		return nil, err
	}
	pf, err1 := finalPath(parent)
	cf, err2 := finalPath(d.h)
	if err := errors.Join(err1, err2); err != nil {
		d.Close()
		return nil, err
	}
	if !strings.EqualFold(cf, strings.TrimSuffix(pf, `\`)+`\`+filepath.Base(path)) {
		d.Close()
		return nil, ErrReparse
	}
	return d, nil
}

// Close handle'ları bırakır (nil güvenli, birden çok kez çağrılabilir).
func (d *Dir) Close() {
	if d == nil {
		return
	}
	for _, h := range []*windows.Handle{&d.h, &d.parent} {
		if *h != windows.InvalidHandle && *h != 0 {
			_ = windows.CloseHandle(*h)
		}
		*h = windows.InvalidHandle
	}
}

func (d *Dir) child(name string) (string, error) {
	if name == "" || name != filepath.Base(name) || strings.ContainsAny(name, `\/:`) {
		return "", errors.New("diag: geçersiz dosya adı")
	}
	return filepath.Join(d.path, name), nil
}

// Open klasördeki dosyayı açar. Reparse noktası, klasör veya (yazma kiplerinde) birden çok bağlı dosya reddedilir.
func (d *Dir) Open(name string, m Mode) (*os.File, error) {
	path, err := d.child(name)
	if err != nil {
		return nil, err
	}
	var access, disp uint32
	switch m {
	case ModeRead:
		access, disp = windows.GENERIC_READ, windows.OPEN_EXISTING
	case ModeAppend:
		access, disp = windows.FILE_APPEND_DATA|windows.FILE_READ_ATTRIBUTES|windows.SYNCHRONIZE, windows.OPEN_ALWAYS
	case ModeCreate:
		access, disp = windows.GENERIC_WRITE|windows.FILE_READ_ATTRIBUTES, windows.CREATE_NEW
	default:
		return nil, errors.New("diag: geçersiz kip")
	}
	h, err := openChecked(path, access, windows.FILE_SHARE_READ, disp, false)
	if err != nil {
		if notExist(err) {
			return nil, os.ErrNotExist
		}
		if errors.Is(err, windows.ERROR_FILE_EXISTS) {
			return nil, os.ErrExist
		}
		return nil, err
	}
	if m != ModeRead {
		var bi windows.ByHandleFileInformation
		if err := windows.GetFileInformationByHandle(h, &bi); err != nil || bi.NumberOfLinks != 1 {
			_ = windows.CloseHandle(h)
			return nil, ErrReparse
		}
	}
	return os.NewFile(uintptr(h), name), nil
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

// dispose handle'ı silinmek üzere işaretler: FileDispositionInfoEx (POSIX semantiği, Windows 10 1709+); desteklenmezse
// klasik FileDispositionInfo (kapanışta silinir).
func dispose(h windows.Handle) error {
	flags := uint32(windows.FILE_DISPOSITION_DELETE | windows.FILE_DISPOSITION_POSIX_SEMANTICS)
	err := windows.SetFileInformationByHandle(h, windows.FileDispositionInfoEx, (*byte)(unsafe.Pointer(&flags)), 4)
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) || errors.Is(err, windows.ERROR_NOT_SUPPORTED) ||
		errors.Is(err, windows.ERROR_INVALID_FUNCTION) {
		del := byte(1)
		err = windows.SetFileInformationByHandle(h, windows.FileDispositionInfo, &del, 1)
	}
	return err
}

// Remove dosyayı handle üzerinden siler; yoksa os.ErrNotExist, reparse noktasıysa ErrReparse (bağlantı da hedef de
// silinmez).
func (d *Dir) Remove(name string) error {
	path, err := d.child(name)
	if err != nil {
		return err
	}
	h, err := openChecked(path, windows.DELETE|windows.FILE_READ_ATTRIBUTES|windows.SYNCHRONIZE, shareAll, windows.OPEN_EXISTING, false)
	if err != nil {
		if notExist(err) {
			return os.ErrNotExist
		}
		return err
	}
	err = dispose(h)
	return errors.Join(err, windows.CloseHandle(h))
}

// RemoveIfEmpty klasörü yalnız boşsa (handle üzerinden) siler ve Dir'i kapatır; dolu klasörde sessizce kalır.
func (d *Dir) RemoveIfEmpty() {
	if d.delOK && d.h != windows.InvalidHandle {
		_ = dispose(d.h) // dolu klasörde ERROR_DIR_NOT_EMPTY: silinmez
	}
	d.Close()
}
