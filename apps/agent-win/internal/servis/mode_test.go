package servis

import (
	"strings"
	"testing"
)

func TestModeFirstArgumentOnly(t *testing.T) {
	cases := map[string]Mode{
		"":                       ModeWindow,
		"--service":              ModeService,
		"--helper":               ModeHelper,
		"--tray":                 ModeTray,
		"--install":              ModeInstall,
		"--uninstall":            ModeUninstall,
		"--enable":               ModeEnable,
		"--SERVICE":              ModeWindow,
		"--service=1":            ModeWindow,
		"x --service":            ModeWindow,
		"https://evil.example/x": ModeWindow,
	}
	for arg, want := range cases {
		args := append([]string{"exe"}, strings.Fields(arg)...)
		if got := ParseMode(args); got != want {
			t.Errorf("%q → %v, beklenen %v", arg, got, want)
		}
	}
}

func TestAC340QuotedImagePath(t *testing.T) {
	exe := `C:\Program Files\NoktaDestek Servis\NoktaDestekServis.exe`
	p, err := ImagePath(exe)
	if err != nil || p != `"`+exe+`" --service` {
		t.Fatalf("ImagePath = %s, %v", p, err)
	}
	if r, _ := RunCommand(exe); !strings.HasPrefix(r, `"`) || !strings.HasSuffix(r, `" --tray`) {
		t.Fatalf("Run = %s", r)
	}
	if u, _ := UninstallCommand(exe); !strings.HasSuffix(u, `" --uninstall`) {
		t.Fatalf("Uninstall = %s", u)
	}
	if _, err := ImagePath(`C:\a" --x`); err == nil {
		t.Fatal("tırnaklı yol kabul edildi")
	}
}
