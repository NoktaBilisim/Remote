package autorun

import "testing"

// G-P20-14 fikstürleri: Windows 10/11 varsayılan `C:\` ve kullanıcı profili izinleri (icacls çıktısından). Bayraklar:
// OI=0x01, CI=0x02, IO=0x08, I(devralınmış)=0x10.

const (
	user     = "S-1-5-21-1-2-3-1001"
	other    = "S-1-5-21-1-2-3-1002"
	sidUsers = "S-1-5-32-545"
	sidAuth  = "S-1-5-11"
	sidEvery = "S-1-1-0"
	sidCOwn  = "S-1-3-0"

	maskF  = fileAllAccess
	maskM  = 0x001301BF
	maskRX = 0x001200A9
	maskAD = fileAppendData

	fOICI   = 0x03
	fOICIIO = 0x0B
	fI      = 0x10
)

func allow(sid string, mask uint32, flags uint8) ACE {
	return ACE{Type: AceAllow, SID: sid, Mask: mask, Flags: flags}
}

var testEnv = Env{
	User:        user,
	Temp:        []string{`C:\Users\u\AppData\Local\Temp`, `C:\Windows\Temp`},
	ProgramData: `C:\ProgramData`,
	Public:      `C:\Users\Public`,
}

// C:\ — sahip TrustedInstaller; Authenticated Users:(OI)(CI)(IO)(M) ve (AD), Users:(OI)(CI)(RX).
func rootC() Object {
	return Object{Path: `C:\`, Owner: SIDTrustedInstaller, ACEs: []ACE{
		allow(SIDAdministrators, maskF, fOICI),
		allow(SIDSystem, maskF, fOICI),
		allow(sidUsers, maskRX, fOICI),
		allow(sidAuth, maskM, fOICIIO),
		allow(sidAuth, maskAD, 0),
		allow(sidCOwn, genericAll, fOICIIO),
	}}
}

// C:\Users — korumalı DACL; Everyone:(RX) ve Everyone:(OI)(CI)(IO)(GR,GE).
func usersDir() Object {
	return Object{Path: `C:\Users`, Owner: SIDSystem, ACEs: []ACE{
		allow(SIDSystem, maskF, fOICI),
		allow(SIDAdministrators, maskF, fOICI),
		allow(sidUsers, maskRX, 0),
		allow(sidUsers, genericRead|genericExecute, fOICIIO),
		allow(sidEvery, maskRX, 0),
		allow(sidEvery, genericRead|genericExecute, fOICIIO),
	}}
}

func profile() Object {
	return Object{Path: `C:\Users\u`, Owner: SIDSystem, ACEs: []ACE{
		allow(SIDSystem, maskF, fOICI), allow(SIDAdministrators, maskF, fOICI), allow(user, maskF, fOICI),
	}}
}

func inheritedProfile(path string) Object {
	return Object{Path: path, Owner: user, ACEs: []ACE{
		allow(SIDSystem, maskF, fOICI|fI), allow(SIDAdministrators, maskF, fOICI|fI), allow(user, maskF, fOICI|fI),
	}}
}

func downloadsTarget() Target {
	return Target{Path: `C:\Users\u\Downloads\x.exe`, DriveFixed: true, Chain: []Object{
		rootC(), usersDir(), profile(),
		inheritedProfile(`C:\Users\u\Downloads`),
		{Path: `C:\Users\u\Downloads\x.exe`, Owner: user, ACEs: []ACE{
			allow(SIDSystem, maskF, fI), allow(SIDAdministrators, maskF, fI), allow(user, maskF, fI),
		}},
	}}
}

// C:\Araclar — yönetici oluşturdu; C:\'den devralınan Authenticated Users:(I)(OI)(CI)(M) etkili.
func araclarTarget() Target {
	return Target{Path: `C:\Araclar\x.exe`, DriveFixed: true, Chain: []Object{
		rootC(),
		{Path: `C:\Araclar`, Owner: SIDAdministrators, ACEs: []ACE{
			allow(SIDAdministrators, maskF, fOICI|fI),
			allow(SIDSystem, maskF, fOICI|fI),
			allow(sidUsers, maskRX, fOICI|fI),
			allow(sidAuth, maskM, fOICI|fI),
			allow(sidCOwn, genericAll, fOICIIO|fI),
		}},
		{Path: `C:\Araclar\x.exe`, Owner: SIDAdministrators, ACEs: []ACE{
			allow(SIDAdministrators, maskF, fI), allow(SIDSystem, maskF, fI),
			allow(sidUsers, maskRX, fI), allow(sidAuth, maskM, fI),
		}},
	}}
}

func TestAC253RealCDriveFixtures(t *testing.T) {
	if r := Evaluate(downloadsTarget(), testEnv); r != ReasonOK {
		t.Fatalf("İndirilenler kabul edilmeli, sonuç %v", r)
	}
	if r := Evaluate(araclarTarget(), testEnv); r != ReasonWeakACL {
		t.Fatalf(`C:\Araclar reddedilmeli (WeakACL), sonuç %v`, r)
	}
	pub := Target{Path: `C:\Users\Public\x.exe`, DriveFixed: true, Chain: []Object{
		rootC(), usersDir(),
		{Path: `C:\Users\Public`, Owner: SIDSystem, ACEs: []ACE{allow(sidUsers, maskRX, fOICI)}},
		{Path: `C:\Users\Public\x.exe`, Owner: user, ACEs: []ACE{allow(user, maskF, fI)}},
	}}
	if r := Evaluate(pub, testEnv); r != ReasonSharedLocation {
		t.Fatalf(`C:\Users\Public reddedilmeli, sonuç %v`, r)
	}
}

// Katmanlı haklar: aynı ACE exe'de, doğrudan üstte ve atada farklı sonuç verir.
func TestAC253LayeredRights(t *testing.T) {
	const exe, parent, ancestor = 4, 3, 2
	cases := []struct {
		name  string
		layer int
		ace   ACE
		want  Reason
	}{
		{"exe FILE_WRITE_DATA", exe, allow(sidUsers, fileWriteData, 0), ReasonWeakACL},
		{"exe FILE_APPEND_DATA", exe, allow(sidUsers, fileAppendData, 0), ReasonWeakACL},
		{"exe DELETE", exe, allow(sidUsers, accessDelete, 0), ReasonWeakACL},
		{"exe WRITE_DAC", exe, allow(sidEvery, writeDAC, 0), ReasonWeakACL},
		{"exe WRITE_OWNER", exe, allow(sidAuth, writeOwner, 0), ReasonWeakACL},
		{"exe GENERIC_WRITE", exe, allow(sidUsers, genericWrite, 0), ReasonWeakACL},
		{"exe GENERIC_ALL", exe, allow(other, genericAll, 0), ReasonWeakACL},
		{"exe RX", exe, allow(sidUsers, maskRX, 0), ReasonOK},
		{"exe FILE_DELETE_CHILD anlamsız", exe, allow(sidUsers, fileDeleteChild, 0), ReasonOK},
		{"üst FILE_ADD_FILE", parent, allow(sidUsers, fileWriteData, 0), ReasonWeakACL},
		{"üst FILE_ADD_SUBDIRECTORY", parent, allow(sidUsers, fileAppendData, 0), ReasonWeakACL},
		{"üst FILE_DELETE_CHILD", parent, allow(sidUsers, fileDeleteChild, 0), ReasonWeakACL},
		{"üst Users:M (icacls)", parent, allow(sidUsers, maskM, 0), ReasonWeakACL},
		{"üst GENERIC_WRITE", parent, allow(sidUsers, genericWrite, 0), ReasonWeakACL},
		{"üst RX", parent, allow(sidUsers, maskRX, 0), ReasonOK},
		{"ata FILE_ADD_FILE", ancestor, allow(sidUsers, fileWriteData, 0), ReasonOK},
		{"ata FILE_ADD_SUBDIRECTORY", ancestor, allow(sidUsers, fileAppendData, 0), ReasonOK},
		{"ata GENERIC_WRITE", ancestor, allow(sidUsers, genericWrite, 0), ReasonOK},
		{"ata FILE_DELETE_CHILD", ancestor, allow(sidUsers, fileDeleteChild, 0), ReasonWeakACL},
		{"ata DELETE", ancestor, allow(sidUsers, accessDelete, 0), ReasonWeakACL},
		{"ata WRITE_DAC", ancestor, allow(sidUsers, writeDAC, 0), ReasonWeakACL},
		{"ata WRITE_OWNER", ancestor, allow(sidUsers, writeOwner, 0), ReasonWeakACL},
		{"ata GENERIC_ALL", ancestor, allow(sidUsers, genericAll, 0), ReasonWeakACL},
		{"kök FILE_DELETE_CHILD", 0, allow(sidAuth, fileDeleteChild, 0), ReasonWeakACL},
		{"üst Users:M INHERIT_ONLY atlanır", parent, allow(sidUsers, maskM, fOICIIO), ReasonOK},
		{"exe tam yetki INHERIT_ONLY atlanır", exe, allow(sidEvery, maskF, aceInheritOnly), ReasonOK},
		{"üst devralınmış M etkili", parent, allow(sidUsers, maskM, fOICI|fI), ReasonWeakACL},
		{"ret ACE değerlendirilmez", parent, ACE{Type: AceDeny, SID: sidUsers, Mask: maskF}, ReasonOK},
		{"tanınmayan ACE türü", ancestor, ACE{Type: AceUnknown, Mask: maskRX}, ReasonCheckFailed},
		{"SYSTEM tam yetki", parent, allow(SIDSystem, maskF, 0), ReasonOK},
		{"TrustedInstaller tam yetki", exe, allow(SIDTrustedInstaller, maskF, 0), ReasonOK},
		{"başka kullanıcı M", parent, allow(other, maskM, 0), ReasonWeakACL},
		{"INTERACTIVE yazma", exe, allow("S-1-5-4", fileWriteData, 0), ReasonWeakACL},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tg := downloadsTarget()
			tg.Chain[c.layer].ACEs = append(tg.Chain[c.layer].ACEs, c.ace)
			if r := Evaluate(tg, testEnv); r != c.want {
				t.Fatalf("beklenen %v, sonuç %v", c.want, r)
			}
		})
	}
}

func TestAC253OwnerEveryComponent(t *testing.T) {
	for i := range downloadsTarget().Chain {
		tg := downloadsTarget()
		tg.Chain[i].Owner = other
		if r := Evaluate(tg, testEnv); r != ReasonWeakACL {
			t.Fatalf("bileşen %d sahibi başka kullanıcı: %v", i, r)
		}
		tg.Chain[i].Owner = ""
		if r := Evaluate(tg, testEnv); r != ReasonCheckFailed {
			t.Fatalf("bileşen %d sahibi okunamadı: %v", i, r)
		}
	}
	tg := downloadsTarget()
	tg.Chain[3].Owner = SIDAdministrators
	tg.Chain[4].Owner = SIDTrustedInstaller
	if r := Evaluate(tg, testEnv); r != ReasonOK {
		t.Fatalf("izinli sahipler: %v", r)
	}
}

func TestAC253NullDACLAndReparse(t *testing.T) {
	tg := downloadsTarget()
	tg.Chain[1].NullDACL = true
	if r := Evaluate(tg, testEnv); r != ReasonWeakACL {
		t.Fatalf("NULL DACL: %v", r)
	}
	tg = downloadsTarget()
	tg.Chain[3].Reparse = true
	if r := Evaluate(tg, testEnv); r != ReasonReparse {
		t.Fatalf("junction bileşen: %v", r)
	}
	tg = downloadsTarget()
	tg.ViaReparse = true
	if r := Evaluate(tg, testEnv); r != ReasonReparse {
		t.Fatalf("başlatma yolunda junction: %v", r)
	}
}

func TestAC253LocationRules(t *testing.T) {
	cases := map[string]Reason{
		`C:\Users\u\AppData\Local\Temp\x.exe`:                               ReasonTempLocation,
		`C:\users\U\appdata\local\temp\Temp1_destek.zip\x.exe`:              ReasonTempLocation,
		`C:\Windows\Temp\x.exe`:                                             ReasonTempLocation,
		`C:\Users\u\AppData\Local\Microsoft\Windows\INetCache\IE\ABC\x.exe`: ReasonTempLocation,
		`C:\Users\u\Belgeler\destek.zip\x.exe`:                              ReasonTempLocation,
		`C:\ProgramData\x.exe`:                                              ReasonSharedLocation,
		`C:\programdata\Nokta\x.exe`:                                        ReasonSharedLocation,
		`C:\Users\Public\Downloads\x.exe`:                                   ReasonSharedLocation,
		`C:\Users\u\AppData\Local\TempDir\x.exe`:                            ReasonCheckFailed, // Temp öneki değil, bileşen; zincir eksik
		`C:\Users\u\Downloads\Temp1_destek.zip.exe`:                         ReasonCheckFailed, // exe adı .zip ile bitmiyor
	}
	for p, want := range cases {
		if r := Evaluate(Target{Path: p, DriveFixed: true}, testEnv); r != want {
			t.Errorf("%s: beklenen %v, sonuç %v", p, want, r)
		}
	}
	tg := downloadsTarget()
	tg.DriveFixed = false
	if r := Evaluate(tg, testEnv); r != ReasonNotFixed {
		t.Fatalf("çıkarılabilir/ağ sürücüsü: %v", r)
	}
	tg = downloadsTarget()
	tg.Chain[2].Path = `C:\Users\v`
	if r := Evaluate(tg, testEnv); r != ReasonCheckFailed {
		t.Fatalf("zincir yolla uyuşmuyor: %v", r)
	}
	if r := Evaluate(downloadsTarget(), Env{Temp: testEnv.Temp}); r != ReasonCheckFailed {
		t.Fatalf("kullanıcı SID'i yok: %v", r)
	}
}

func TestMapGeneric(t *testing.T) {
	if got := mapGeneric(genericAll); got != fileAllAccess {
		t.Fatalf("GENERIC_ALL %#x", got)
	}
	if got := mapGeneric(genericWrite | accessDelete); got != fileGenericWrite|accessDelete {
		t.Fatalf("GENERIC_WRITE %#x", got)
	}
	if got := mapGeneric(genericRead | genericExecute); got&(fileWriteData|fileAppendData|accessDelete|writeDAC) != 0 {
		t.Fatalf("GR|GE yazma hakkı içermemeli %#x", got)
	}
}
