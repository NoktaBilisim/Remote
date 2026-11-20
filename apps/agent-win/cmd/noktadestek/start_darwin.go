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

// startSource P28f K4 + P31 K-P31-9 (mimari-p28f §5.3, mimari-p31 §15.2; AC-391/AC-97/AC-512/AC-518): kaynak sırası
// (1) yalnız `--restart <belirteç>` ile açıldıysa eşleşen yeniden başlatma dosyasındaki KOD, (2) bundle'ın
// (translocation çözülmüş) üst klasör adı → kod ya da firma ref'i, bundle adı → yalnız kod, (3) yok → ana ekran (AC-190).
// Belirteçsiz açılışta bekleyen dosyalar okunmadan silinir. Ardından Ekran Kaydı yoklaması (ağdan ve ana ekrandan önce):
// izin yoksa rehber; "Yeniden başlat" yalnız KODU belirteçli dosyaya yazar (ref hiçbir dosyaya yazılmaz — yeni örnek
// aynı klasör adını yeniden okur; macperm.WriteRestart ref biçimini zaten reddeder), `open -n <özgün bundle yolu>` ile yeni
// örneği açar ve bu süreç çıkar (ok=false). "Vazgeç" de ok=false.
func startSource(ctx context.Context, u *mac.UI) (launch.Source, bool) {
	dir, derr := macperm.TempDir()
	var src launch.Source
	tok, restarted := macperm.RestartToken(os.Args[1:])
	switch {
	case derr != nil:
	case restarted:
		src.Code, _ = macperm.ReadRestart(dir, tok, time.Now())
	default:
		macperm.PurgeRestart(dir)
	}
	if src.Code == "" {
		src = launch.BundleSource()
	}
	if macperm.ScreenCaptureGranted() {
		return src, true
	}
	if !restarted {
		macperm.RequestScreenCapture() // ilk açılışta bir kez: sistem uygulamayı listeye ekler
	}
	if u.PermGuide(ctx) != mac.PermRestart {
		return launch.Source{}, false
	}
	next, err := macperm.NewToken()
	if err != nil {
		return launch.Source{}, false
	}
	written := false
	if src.Code != "" && derr == nil {
		written = macperm.WriteRestart(dir, next, src.Code) == nil
	}
	// BundlePath translocation çözülmüş özgün yoldur (K-P31-9): yeni örnek translocate olsa da özgün klasör adını okur.
	if macperm.Relaunch(launch.BundlePath(), next) != nil && written {
		macperm.RemoveRestart(dir, next)
	}
	return launch.Source{}, false
}
