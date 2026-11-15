package helper

import (
	"testing"

	"remote-support/agent-win/internal/servis"
)

func TestNamesMatchServis(t *testing.T) {
	if serviceName != servis.ServiceName || dataDirName != servis.InstallDirName || incomingDirName != servis.IncomingDirName {
		t.Fatal("ad sabitleri internal/servis ile ayrışmış")
	}
}

// AC-341: jetonda izin listesi dışında ayrıcalık → helper_failed.
func TestAC341OnlyAllowedPrivileges(t *testing.T) {
	allowed := []string{"SeChangeNotifyPrivilege"}
	if !onlyAllowed([]string{"SeChangeNotifyPrivilege"}, allowed) || !onlyAllowed(nil, allowed) {
		t.Fatal("izinli küme reddedildi")
	}
	for _, p := range []string{"SeDebugPrivilege", "SeTcbPrivilege", "SeImpersonatePrivilege", "SeBackupPrivilege"} {
		if onlyAllowed([]string{"SeChangeNotifyPrivilege", p}, allowed) {
			t.Fatalf("%s kabul edildi", p)
		}
	}
	if len(allowedPrivileges) != 1 || allowedPrivileges[0] != "SeChangeNotifyPrivilege" {
		t.Fatal("izin listesi genişlemiş (K6b ölçümü + gerekçe gerekir)")
	}
}

// AC-340: Gelen gerçek yolu beklenen yol olmalı (junction/UNC/birim GUID reddi).
func TestAC340IncomingFinalPath(t *testing.T) {
	want := `C:\ProgramData\NoktaDestek Servis\Gelen`
	ok := []string{`\\?\C:\ProgramData\NoktaDestek Servis\Gelen`, `\\?\c:\programdata\noktadestek servis\gelen\`}
	bad := []string{`\\?\D:\Evil\Gelen`, `\\?\UNC\srv\share\Gelen`, `\\?\Volume{1}\ProgramData\NoktaDestek Servis\Gelen`,
		`C:\ProgramData\NoktaDestek Servis\Gelen`, `\\?\C:\ProgramData\NoktaDestek Servis\Gelen2`, ``}
	for _, f := range ok {
		if !samePath(f, want) {
			t.Errorf("reddedildi: %s", f)
		}
	}
	for _, f := range bad {
		if samePath(f, want) {
			t.Errorf("kabul edildi: %s", f)
		}
	}
}

func fullLayout(mons []rect) []shown {
	var ws []shown
	for i, m := range mons {
		bars, lbl := layout(m, 5, 460, 32)
		for _, b := range bars {
			ws = append(ws, shown{Monitor: i, Exists: true, Visible: true, Rect: b})
		}
		ws = append(ws, shown{Monitor: i, Label: true, Exists: true, Visible: true, Rect: lbl})
	}
	return ws
}

// AC-294 (§5.5): her monitörde pencere oluşturuldu ∧ görünür ∧ konum monitör sınırında → ready.
func TestAC294VerifyLayout(t *testing.T) {
	mons := []rect{{0, 0, 1920, 1080}, {1920, -200, 3200, 824}}
	ws := fullLayout(mons)
	if !verifyLayout(mons, ws) {
		t.Fatal("tam düzen doğrulanmadı")
	}
	if verifyLayout(nil, nil) || verifyLayout(mons, ws[:5]) {
		t.Fatal("monitör yok / ikinci monitör eksik kabul edildi")
	}
	for name, mut := range map[string]func(*shown){
		"görünmez": func(s *shown) { s.Visible = false },
		"yok":      func(s *shown) { s.Exists = false },
		"taşan":    func(s *shown) { s.Rect.Right = 5000 },
		"boş":      func(s *shown) { s.Rect = rect{} },
	} {
		w := fullLayout(mons)
		mut(&w[len(w)-1])
		if verifyLayout(mons, w) {
			t.Errorf("%s etiket kabul edildi", name)
		}
	}
}

func TestLayoutLabelFitsNarrowMonitor(t *testing.T) {
	_, lbl := layout(rect{0, 0, 300, 200}, 5, labelWidth("TEST — imzasız · Uzaktan bağlantı: uzun bir ad — firma", 144), 32)
	if !lbl.within(rect{0, 0, 300, 200}) {
		t.Fatalf("etiket taştı: %+v", lbl)
	}
	if labelWidth("a", 96) != 460 {
		t.Fatal("en az genişlik")
	}
}
