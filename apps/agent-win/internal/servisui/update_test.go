package servisui

import "testing"

// K-P29-21: tepsi yalnız servis sürümü kendi sürümünden farklı ve kurulu sürümle (DisplayVersion) aynıyken yeniden başlar.
func TestKP2921TrayRestart(t *testing.T) {
	base := Snapshot{Pipe: PipeOK, SelfVersion: "0.22.0", ServiceVersion: "0.22.1", InstalledVersion: "0.22.1"}
	if !TrayRestart(base) {
		t.Fatal("yeni servis sonrası yeniden başlamadı")
	}
	cases := map[string]Snapshot{
		"eski servis (sürüm yok)": {Pipe: PipeOK, SelfVersion: "0.22.0", InstalledVersion: "0.22.0"},
		"aynı sürüm":              {Pipe: PipeOK, SelfVersion: "0.22.1", ServiceVersion: "0.22.1", InstalledVersion: "0.22.1"},
		"kurulu sürüm farklı":     {Pipe: PipeOK, SelfVersion: "0.22.0", ServiceVersion: "0.22.1", InstalledVersion: "0.22.0"},
		"boru yok":                {Pipe: PipeDown, SelfVersion: "0.22.0", ServiceVersion: "0.22.1", InstalledVersion: "0.22.1"},
	}
	for name, s := range cases {
		if TrayRestart(s) {
			t.Errorf("%s: yeniden başlatma döngüsü riski", name)
		}
	}
}
