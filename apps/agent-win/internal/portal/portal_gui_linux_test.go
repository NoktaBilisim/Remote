//go:build linux && linuxgui

package portal

import (
	"os"
	"testing"
)

// K8a zorunlu adı (sahte D-Bus durum makinesi): kabul, ret/iptal, devices=0, Closed, yabancı gönderen — sahte Bus ile
// (portal onay diyaloğu CI'da otomatik onaylanmaz, §12.1). Ek olarak imajın gerçek oturum veri yolunda godbus
// uyarlayıcısı bağlanır; portal Settings'i olmayan veri yolunda kilit koruması fail-closed, libgio yedeği gerçek
// GSettings şemalarından okur (S-P28g-1 m.2).
func TestP28gK2GUIPortalFakeDBusStates(t *testing.T) {
	if os.Getenv("P28G_GUI") == "" {
		t.Skip("SKIP: P28G_GUI (test-linux-gui imajı) gerekir")
	}
	for name, fn := range map[string]func(*testing.T){
		"kabul": TestAC399P28gPortalAcceptControl, "devices=0": TestAC399P28gPortalDevicesZeroIsViewOnly,
		"yalnız görüntü": TestAC399P28gPortalViewOnlyNoRemoteDesktop, "iptal ve ret": TestAC399P28gPortalCancelAndDeny,
		"sınırlar": TestAC399P28gPortalProtocolBounds, "yabancı gönderen": TestAC399P28gPortalForeignSenderIgnored,
		"portal yok": TestAC399P28gPortalUnavailable, "Closed": TestAC102P28gPortalClosedSignal,
		"kilit izleyici": TestAC399P28gLockWatcher,
	} {
		t.Run(name, fn)
	}
	b, err := Connect(os.Getenv("DBUS_SESSION_BUS_ADDRESS"))
	if err != nil {
		t.Fatalf("oturum veri yolu: %v", err)
	}
	defer b.Close()
	if b.Unique() == "" {
		t.Fatal("benzersiz ad yok")
	}
	if g := ReadLockGuard(b); g.Known {
		t.Fatalf("portalsız veri yolunda koruma bilinen sayıldı: %+v", g)
	}
	if st := WatchLock(t.Context(), b, nil).State(); st.Known {
		t.Fatalf("ScreenSaver yokken kilit bilinen sayıldı: %+v", st)
	}
	direct := GIOReader(func(f func()) error { f(); return nil })
	g := ReadLockGuardWith(Fallback(PortalReader(b), direct))
	a := ReadA11y(direct)
	t.Logf("libgio yedeği: koruma %+v, a11y %+v", g, a)
	if !g.Known || !a.Known {
		t.Fatal("libgio yedeği GSettings şemalarını okuyamadı")
	}
}
