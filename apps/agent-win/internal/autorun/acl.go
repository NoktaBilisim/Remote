package autorun

import "strings"

// Saf ACL ve konum kuralı (G-P20-1 + G-P20-14, mimari-e11 §8d.3 r3; ADR-0004 r6 eki). Windows'ta inspect_windows.go
// gerçek güvenlik tanımlayıcılarını bu veri modeline çevirir; Linux birim testleri gerçek `C:\` izin fikstürleriyle
// aynı fonksiyonu sınar.

// AceType DACL girdisinin türü.
type AceType uint8

const (
	// AceAllow ACCESS_ALLOWED_ACE (ve callback eşi).
	AceAllow AceType = iota + 1
	// AceDeny ACCESS_DENIED_* (değerlendirmeye girmez; yalnız izin verenler sayılır).
	AceDeny
	// AceUnknown tanınmayan tür: denetlenemez, hedef reddedilir.
	AceUnknown
)

// ACE DACL girdisi (SID metin biçiminde, ör. "S-1-5-32-545").
type ACE struct {
	Type  AceType
	Flags uint8
	Mask  uint32
	SID   string
}

// Object yol bileşeni (birim kökü, klasör veya exe).
type Object struct {
	Path     string
	Owner    string
	Reparse  bool
	NullDACL bool // DACL yok: herkese tam erişim
	ACEs     []ACE
}

// Target incelenen exe hedefi.
type Target struct {
	// Path kanonik DOS yolu (GetFinalPathNameByHandleW + NormalizePath).
	Path string
	// DriveFixed birim GetDriveTypeW == DRIVE_FIXED.
	DriveFixed bool
	// ViaReparse incelemeye verilen (başlatma) yolunun bir bileşeni reparse noktası.
	ViaReparse bool
	// Chain kökten exe'ye: Chain[0] birim kökü, son öğe exe (Components(Path) ile aynı sırada).
	Chain []Object
}

// Env konum ve SID kuralları için ortam.
type Env struct {
	// User geçerli kullanıcının SID'i.
	User string
	// Temp geçici klasörler (kanonik); altı ret.
	Temp []string
	// ProgramData ve Public paylaşılan klasörler (kanonik); altı ret.
	ProgramData string
	Public      string
}

// İyi bilinen SID'ler ve erişim bitleri (winnt.h).
const (
	SIDSystem           = "S-1-5-18"
	SIDAdministrators   = "S-1-5-32-544"
	SIDTrustedInstaller = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"

	aceInheritOnly = 0x08

	fileWriteData   = 0x0002 // klasörde FILE_ADD_FILE
	fileAppendData  = 0x0004 // klasörde FILE_ADD_SUBDIRECTORY
	fileDeleteChild = 0x0040
	accessDelete    = 0x00010000
	writeDAC        = 0x00040000
	writeOwner      = 0x00080000

	genericRead    = 0x80000000
	genericWrite   = 0x40000000
	genericExecute = 0x20000000
	genericAll     = 0x10000000

	fileGenericRead    = 0x00120089
	fileGenericWrite   = 0x00120116
	fileGenericExecute = 0x001200A0
	fileAllAccess      = 0x001F01FF
)

// Katmanlı ret maskeleri (G-P20-14): (a) exe, (b) doğrudan üst klasör, (c) daha üstteki atalar. Atalarda
// FILE_ADD_FILE/FILE_ADD_SUBDIRECTORY ret nedeni değildir (varsayılan `C:\` Authenticated Users:(AD) var olan bileşeni
// değiştirmez); bileşenin kendisini silme/yeniden adlandırma (DELETE), çocuk silme ve izin/sahip değiştirme ret.
const (
	denyExe      = fileWriteData | fileAppendData | accessDelete | writeDAC | writeOwner
	denyParent   = denyExe | fileDeleteChild
	denyAncestor = fileDeleteChild | accessDelete | writeDAC | writeOwner
)

// mapGeneric GENERIC_* bitlerini dosya eşlemesine çevirir.
func mapGeneric(m uint32) uint32 {
	out := m &^ (genericRead | genericWrite | genericExecute | genericAll)
	if m&genericRead != 0 {
		out |= fileGenericRead
	}
	if m&genericWrite != 0 {
		out |= fileGenericWrite
	}
	if m&genericExecute != 0 {
		out |= fileGenericExecute
	}
	if m&genericAll != 0 {
		out |= fileAllAccess
	}
	return out
}

// trusted izinli SID'ler: geçerli kullanıcı, SYSTEM, Administrators, TrustedInstaller.
func trusted(sid, user string) bool {
	return sid == user || sid == SIDSystem || sid == SIDAdministrators || sid == SIDTrustedInstaller
}

// Evaluate saf karar: biçim → sürücü → geçici konum → paylaşılan konum → reparse → sahip/ACL.
func Evaluate(t Target, env Env) Reason {
	if np, err := NormalizePath(t.Path); err != nil || np != t.Path {
		return ReasonBadPath
	}
	if !t.DriveFixed {
		return ReasonNotFixed
	}
	if tempLocation(t.Path, env.Temp) {
		return ReasonTempLocation
	}
	if under(t.Path, env.ProgramData) || under(t.Path, env.Public) {
		return ReasonSharedLocation
	}
	comps := Components(t.Path)
	if env.User == "" || len(t.Chain) != len(comps) {
		return ReasonCheckFailed
	}
	if t.ViaReparse {
		return ReasonReparse
	}
	for i, o := range t.Chain {
		if !strings.EqualFold(o.Path, comps[i]) {
			return ReasonCheckFailed
		}
		if o.Reparse {
			return ReasonReparse
		}
	}
	last := len(t.Chain) - 1
	for i, o := range t.Chain {
		deny := uint32(denyAncestor)
		switch i {
		case last:
			deny = denyExe
		case last - 1:
			deny = denyParent
		}
		if r := evalObject(o, deny, env.User); r != ReasonOK {
			return r
		}
	}
	return ReasonOK
}

// evalObject sahip her bileşende izinli olmalı; yalnız o nesnede etkili (INHERIT_ONLY olmayan) izin veren ACE'ler,
// başka SID'e deny maskesinden bir hak veriyorsa ret.
func evalObject(o Object, deny uint32, user string) Reason {
	if o.Owner == "" {
		return ReasonCheckFailed
	}
	if !trusted(o.Owner, user) || o.NullDACL {
		return ReasonWeakACL
	}
	for _, a := range o.ACEs {
		switch {
		case a.Type == AceDeny || a.Flags&aceInheritOnly != 0:
			continue
		case a.Type != AceAllow || a.SID == "":
			return ReasonCheckFailed
		case !trusted(a.SID, user) && mapGeneric(a.Mask)&deny != 0:
			return ReasonWeakACL
		}
	}
	return ReasonOK
}

// under p, dir'in kendisi veya altındaysa (büyük/küçük harf duyarsız).
func under(p, dir string) bool {
	dir = strings.TrimSuffix(dir, `\`)
	if dir == "" {
		return false
	}
	return strings.EqualFold(p, dir) || (len(p) > len(dir) && p[len(dir)] == '\\' && strings.EqualFold(p[:len(dir)], dir))
}

// tempLocation %TEMP% altı, INetCache / Temporary Internet Files bileşeni veya `*.zip` adlı klasör bileşeni (Gezgin'in
// zip içinden çalıştırırken açtığı geçici klasör: `Temp1_x.zip`).
func tempLocation(p string, temps []string) bool {
	for _, d := range temps {
		if under(p, d) {
			return true
		}
	}
	parts := strings.Split(p, `\`)
	for _, c := range parts[1 : len(parts)-1] {
		lc := strings.ToLower(c)
		if lc == "inetcache" || lc == "temporary internet files" || strings.HasSuffix(lc, ".zip") {
			return true
		}
	}
	return false
}
