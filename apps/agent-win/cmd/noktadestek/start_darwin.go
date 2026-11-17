//go:build darwin

package main

import (
	"context"
	"os"
	"time"

	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/macperm"
	"remote-support/agent-win/internal/ui/mac"
)

// startCode P28f K4 (mimari-p28f §2 launch/code_darwin.go, §5.3, AC-391/AC-97): kod sırası (1) yalnız `--restart
// <belirteç>` ile açıldıysa eşleşen yeniden başlatma dosyası, (2–3) bundle'ın üst klasör / bundle adı, (4) boş → akış kod
// alanını açar. Belirteçsiz açılışta bekleyen dosyalar okunmadan silinir. Ardından Ekran Kaydı yoklaması (resolve'dan
// önce): izin yoksa rehber; "Yeniden başlat" kodu belirteçli dosyaya yazar, `open -n` ile yeni örneği açar ve bu süreç
// çıkar (ok=false). "Vazgeç" de ok=false.
func startCode(ctx context.Context, u *mac.UI) (string, bool) {
	dir, derr := macperm.TempDir()
	code := ""
	tok, restarted := macperm.RestartToken(os.Args[1:])
	switch {
	case derr != nil:
	case restarted:
		code, _ = macperm.ReadRestart(dir, tok, time.Now())
	default:
		macperm.PurgeRestart(dir)
	}
	if code == "" {
		code = launch.BundleCode()
	}
	if macperm.ScreenCaptureGranted() {
		return code, true
	}
	if !restarted {
		macperm.RequestScreenCapture() // ilk açılışta bir kez: sistem uygulamayı listeye ekler
	}
	if u.PermGuide(ctx) != mac.PermRestart {
		return "", false
	}
	next, err := macperm.NewToken()
	if err != nil {
		return "", false
	}
	if code != "" && derr == nil {
		if macperm.WriteRestart(dir, next, code) != nil {
			code = ""
		}
	}
	if macperm.Relaunch(launch.BundlePath(), next) != nil && derr == nil {
		macperm.RemoveRestart(dir, next)
	}
	return "", false
}
