//go:build windows

package autorun

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// sysProber gerçek süreç belirteci ve dosya sistemi. Her bileşen handle ile açılır (FILE_FLAG_OPEN_REPARSE_POINT:
// bağlantı izlenmez, kendisi açılır); sahip ve DACL GetSecurityInfo(handle) ile okunur (mimari-e11 §8d.3 r3).
type sysProber struct{}

const (
	shareAll    = windows.FILE_SHARE_READ | windows.FILE_SHARE_WRITE | windows.FILE_SHARE_DELETE
	noFollow    = windows.FILE_FLAG_OPEN_REPARSE_POINT | windows.FILE_FLAG_BACKUP_SEMANTICS
	follow      = windows.FILE_FLAG_BACKUP_SEMANTICS
	aceAllowCB  = 9  // ACCESS_ALLOWED_CALLBACK_ACE_TYPE
	aceDenyObj  = 6  // ACCESS_DENIED_OBJECT_ACE_TYPE
	aceDenyCB   = 10 // ACCESS_DENIED_CALLBACK_ACE_TYPE
	aceDenyCBOb = 12 // ACCESS_DENIED_CALLBACK_OBJECT_ACE_TYPE
)

func (sysProber) Elevated() bool { return windows.GetCurrentProcessToken().IsElevated() }

func (sysProber) Self() (string, error) { return os.Executable() }

func openPath(p string, access, flags uint32) (windows.Handle, error) {
	u, err := windows.UTF16PtrFromString(p)
	if err != nil {
		return windows.InvalidHandle, ErrBadPath
	}
	h, err := windows.CreateFile(u, access, shareAll, nil, windows.OPEN_EXISTING, flags, 0)
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PATH_NOT_FOUND) {
		return windows.InvalidHandle, os.ErrNotExist
	}
	return h, err
}

type attrTagInfo struct {
	Attributes uint32
	ReparseTag uint32
}

func isReparse(h windows.Handle) (bool, error) {
	var ti attrTagInfo
	if err := windows.GetFileInformationByHandleEx(h, windows.FileAttributeTagInfo, (*byte)(unsafe.Pointer(&ti)),
		uint32(unsafe.Sizeof(ti))); err != nil {
		return false, err
	}
	return ti.Attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0, nil
}

// finalPath GetFinalPathNameByHandleW(FILE_NAME_NORMALIZED | VOLUME_NAME_DOS).
func finalPath(h windows.Handle) (string, error) {
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n, err := windows.GetFinalPathNameByHandle(h, &buf[0], uint32(len(buf)), 0)
	if err != nil {
		return "", err
	}
	if int(n) >= len(buf) {
		return "", ErrBadPath
	}
	return windows.UTF16ToString(buf[:n]), nil
}

// canonical yolu izleyerek açar ve kanonik DOS yolunu döndürür.
func canonical(p string) (string, error) {
	h, err := openPath(p, windows.FILE_READ_ATTRIBUTES, follow)
	if err != nil {
		return "", err
	}
	defer func() { _ = windows.CloseHandle(h) }()
	fp, err := finalPath(h)
	if err != nil {
		return "", err
	}
	return NormalizePath(fp)
}

func (sysProber) Inspect(p string) (Target, error) {
	var t Target
	for _, c := range Components(p) {
		h, err := openPath(c, windows.FILE_READ_ATTRIBUTES, noFollow)
		if err != nil {
			return t, err
		}
		rp, err := isReparse(h)
		_ = windows.CloseHandle(h)
		if err != nil {
			return t, err
		}
		t.ViaReparse = t.ViaReparse || rp
	}
	cp, err := canonical(p)
	if err != nil {
		return t, err
	}
	t.Path = cp
	root, err := windows.UTF16PtrFromString(cp[:3])
	if err != nil {
		return t, ErrBadPath
	}
	t.DriveFixed = windows.GetDriveType(root) == windows.DRIVE_FIXED
	for _, c := range Components(cp) {
		o, err := readObject(c)
		if err != nil {
			return t, err
		}
		t.Chain = append(t.Chain, o)
	}
	return t, nil
}

func readObject(p string) (Object, error) {
	o := Object{Path: p}
	h, err := openPath(p, windows.READ_CONTROL|windows.FILE_READ_ATTRIBUTES, noFollow)
	if err != nil {
		return o, err
	}
	defer func() { _ = windows.CloseHandle(h) }()
	if o.Reparse, err = isReparse(h); err != nil {
		return o, err
	}
	sd, err := windows.GetSecurityInfo(h, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return o, err
	}
	owner, _, err := sd.Owner()
	if err != nil {
		return o, err
	}
	if owner != nil {
		o.Owner = owner.String()
	}
	dacl, _, err := sd.DACL()
	if errors.Is(err, windows.ERROR_OBJECT_NOT_FOUND) || (err == nil && dacl == nil) {
		o.NullDACL = true
		return o, nil
	}
	if err != nil {
		return o, err
	}
	for i := uint32(0); i < uint32(dacl.AceCount); i++ {
		var a *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, i, &a); err != nil {
			return o, err
		}
		o.ACEs = append(o.ACEs, convertACE(a))
	}
	return o, nil
}

// convertACE izin veren (ve callback) türlerde SID aynı konumdadır; ret türleri değerlendirilmez; diğerleri tanınmaz.
func convertACE(a *windows.ACCESS_ALLOWED_ACE) ACE {
	out := ACE{Flags: a.Header.AceFlags, Mask: uint32(a.Mask)}
	switch a.Header.AceType {
	case windows.ACCESS_ALLOWED_ACE_TYPE, aceAllowCB:
		out.Type = AceAllow
		out.SID = (*windows.SID)(unsafe.Pointer(&a.SidStart)).String()
	case windows.ACCESS_DENIED_ACE_TYPE, aceDenyObj, aceDenyCB, aceDenyCBOb:
		out.Type = AceDeny
	default:
		out.Type = AceUnknown
	}
	return out
}

func (sysProber) Env() (Env, error) {
	var env Env
	tu, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return env, err
	}
	env.User = tu.User.Sid.String()
	seen := map[string]bool{}
	addTemp := func(p string) {
		if p == "" {
			return
		}
		for _, q := range []string{strings.TrimPrefix(filepath.Clean(p), `\\?\`), canonOr(p)} {
			if q != "" && !seen[strings.ToLower(q)] {
				seen[strings.ToLower(q)] = true
				env.Temp = append(env.Temp, q)
			}
		}
	}
	addTemp(os.TempDir())
	addTemp(os.Getenv("TMP"))
	addTemp(os.Getenv("TEMP"))
	if la := os.Getenv("LOCALAPPDATA"); la != "" {
		addTemp(filepath.Join(la, "Temp"))
	}
	if sr := os.Getenv("SystemRoot"); sr != "" {
		addTemp(filepath.Join(sr, "Temp"))
		addTemp(filepath.Join(sr, "SystemTemp"))
	}
	env.ProgramData = knownFolder(windows.FOLDERID_ProgramData, "ProgramData")
	env.Public = knownFolder(windows.FOLDERID_Public, "PUBLIC")
	if env.ProgramData == "" || env.Public == "" {
		return env, errors.New("autorun: paylaşılan klasörler bulunamadı")
	}
	return env, nil
}

// canonOr kanonik yol; açılamazsa boş.
func canonOr(p string) string {
	c, err := canonical(p)
	if err != nil {
		return ""
	}
	return c
}

func knownFolder(id *windows.KNOWNFOLDERID, envName string) string {
	p, err := windows.KnownFolderPath(id, 0)
	if err != nil || p == "" {
		p = os.Getenv(envName)
	}
	if p == "" {
		return ""
	}
	if c := canonOr(p); c != "" {
		return c
	}
	return filepath.Clean(p)
}
