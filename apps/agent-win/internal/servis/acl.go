package servis

import "fmt"

// ACL doğrulamasının platformsuz karşılaştırması (mimari-p27 §5.3 r2 m.d, AC-340). Windows tarafı (acl_windows.go)
// gerçek güvenlik tanımlayıcısından ve beklenen SDDL'den ACE listesini çıkarır; burada yalnız küme karşılaştırılır.

// ACE tek erişim girdisi: tür (0 izin, 1 ret), bayraklar (miras hariç), maske, SID dizesi.
type ACE struct {
	Type      uint8
	Flags     uint8
	Mask      uint32
	SID       string
	Inherited bool
}

// Sahip olabilecek SID'ler: SYSTEM ve BUILTIN\Administrators.
const (
	SIDSystem = "S-1-5-18"
	SIDAdmins = "S-1-5-32-544"
)

// OwnerOK sahip SYSTEM ya da Administrators mı.
func OwnerOK(owner string) bool { return owner == SIDSystem || owner == SIDAdmins }

// DirACLOK klasör: DACL korumalı, miras alınmış ACE yok ve ACE kümesi beklenenle birebir aynı (sıra önemsiz).
func DirACLOK(protected bool, got, want []ACE) error {
	if !protected {
		return fmt.Errorf("servis: DACL korumalı değil")
	}
	if len(got) != len(want) {
		return fmt.Errorf("servis: ACE sayısı %d, beklenen %d", len(got), len(want))
	}
	seen := map[ACE]bool{}
	for _, a := range want {
		seen[a] = true
	}
	for _, a := range got {
		if a.Inherited || !seen[a] {
			return fmt.Errorf("servis: beklenmeyen ACE (%s)", a.SID)
		}
	}
	return nil
}

// FileACLOK dosya (device.key): yalnız SYSTEM/Administrators'a izin; ret ACE'leri sorun değil.
func FileACLOK(got []ACE) error {
	for _, a := range got {
		if a.Type == 0 && !OwnerOK(a.SID) {
			return fmt.Errorf("servis: dosyada fazladan erişim (%s)", a.SID)
		}
	}
	return nil
}
