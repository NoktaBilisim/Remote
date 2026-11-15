package servis

import "testing"

func TestAC340DirACLExactSet(t *testing.T) {
	want := []ACE{{Flags: 3, Mask: 0x1F01FF, SID: SIDSystem}, {Flags: 3, Mask: 0x1F01FF, SID: SIDAdmins}}
	if err := DirACLOK(true, []ACE{want[1], want[0]}, want); err != nil {
		t.Fatalf("doğru küme reddedildi: %v", err)
	}
	if DirACLOK(false, want, want) == nil {
		t.Fatal("korumasız DACL kabul edildi")
	}
	users := ACE{Flags: 3, Mask: 0x1F01FF, SID: "S-1-5-32-545"}
	if DirACLOK(true, []ACE{want[0], users}, want) == nil {
		t.Fatal("Users tam erişimi kabul edildi")
	}
	inh := want[0]
	inh.Inherited = true
	if DirACLOK(true, []ACE{inh, want[1]}, want) == nil {
		t.Fatal("miras ACE kabul edildi")
	}
	if DirACLOK(true, want[:1], want) == nil {
		t.Fatal("eksik küme kabul edildi")
	}
}

func TestAC340FileACLAndOwner(t *testing.T) {
	if FileACLOK([]ACE{{Mask: 0x1F01FF, SID: SIDSystem, Inherited: true}, {Type: 1, SID: "S-1-1-0"}}) != nil {
		t.Fatal("SYSTEM + ret ACE reddedildi")
	}
	if FileACLOK([]ACE{{Mask: 0x1200a9, SID: "S-1-5-11"}}) == nil {
		t.Fatal("Authenticated Users okuması anahtarda kabul edildi")
	}
	if !OwnerOK(SIDAdmins) || !OwnerOK(SIDSystem) || OwnerOK("S-1-5-21-1-2-3-1001") {
		t.Fatal("sahip denetimi")
	}
}
