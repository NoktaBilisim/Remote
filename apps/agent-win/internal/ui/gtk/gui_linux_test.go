//go:build linux && linuxgui

package gtk

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/transfer"
)

// GUI duman testi (K8a sözleşmesi: `linuxgui` etiketi, X11 fazı, P28G_GUI=x11 + DISPLAY). GTK yalnız ana iş
// parçacığında çalışır: TestMain ana goroutine'i init'te kilitler, senaryoyu orada (gtk_main) koşturur ve sonucu
// TestP28gK4GUIWindowOpens denetler. NOKTA_GTK_SHOTS=<dizin> verilirse her adımda ekran görüntüsü alınır (gst-launch
// ximagesrc → pngenc; görsel kanıt), NOKTA_GTK_DARK=1 koyu paleti zorlar (CSS/palet kanıtı, algılama değil),
// NOKTA_GTK_WAYLAND=1 Wayland kipinin metin/konum dallarını XWayland olmadan gösterir.

func init() { runtime.LockOSThread() }

var guiErrs []string // nil: senaryo koşmadı; boş: geçti

func TestMain(m *testing.M) {
	if os.Getenv("P28G_GUI") == "x11" && os.Getenv("DISPLAY") != "" {
		guiErrs = runScenario()
	}
	os.Exit(m.Run())
}

// AC-398 / AC-99 / AC-103 / S-P28g-8: gerçek GTK ile karşılama, lobi, oturum penceresi, onay diyaloğu (1,5 sn kilit:
// açılışta izin düğmesi devre dışı, "Reddet" odakta), dosya teklifi, portal ekranı ve bitti ekranı açılır; roster çizimi
// geri okunarak doğrulanır.
func TestP28gK4GUIWindowOpens(t *testing.T) {
	if os.Getenv("P28G_GUI") == "" {
		t.Skip("P28G_GUI boş (yalnız test-linux-gui imajında)")
	}
	if guiErrs == nil {
		t.Fatal("GUI senaryosu koşmadı (P28G_GUI=x11 ve DISPLAY gerekir)")
	}
	for _, e := range guiErrs {
		t.Error(e)
	}
}

type okGuard struct{}

func (okGuard) LocalClick(_, _ ButtonEvent) bool { return true }
func (okGuard) A11yChanged() bool                { return false }

func shot(name string) {
	dir := os.Getenv("NOKTA_GTK_SHOTS")
	if dir == "" {
		return
	}
	_ = exec.Command("gst-launch-1.0", "-q", "ximagesrc", "num-buffers=1", "use-damage=false", "!", "videoconvert", "!",
		"pngenc", "!", "filesink", "location="+filepath.Join(dir, name+".png")).Run()
}

// onMain fn'i ana döngüde çalıştırıp bekler.
func onMain(u *UI, fn func()) {
	done := make(chan struct{})
	u.do(func() { fn(); close(done) })
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
}

func runScenario() []string {
	errs := []string{}
	fail := func(f string, a ...any) { errs = append(errs, fmt.Sprintf(f, a...)) }
	dark := os.Getenv("NOKTA_GTK_DARK") == "1"
	wayland := os.Getenv("NOKTA_GTK_WAYLAND") == "1"
	u, _, err := New(Options{Host: "stg.remote.noktabilisim.net", Version: "0.20.0", Fingerprint: "ab12cd34",
		ServerURL: "https://stg.remote.noktabilisim.net", Wayland: wayland, Guard: okGuard{}})
	if err != nil {
		return []string{"New: " + err.Error()}
	}
	if dark {
		u.dark = true
		setBoolProp(gtkSettingsGetDefault(), "gtk-application-prefer-dark-theme", true)
		_ = u.loadCSS()
	}
	sfx := map[bool]string{false: "-acik", true: "-koyu"}[dark]
	if wayland {
		sfx += "-wayland"
	}
	mapped := func(what string, want int) {
		n := 0
		onMain(u, func() {
			for f := range u.forms {
				if !f.closed && gtkWidgetGetMapped(f.win) {
					n++
				}
			}
		})
		if n < want {
			fail("%s: eşlenmiş pencere %d < %d", what, n, want)
		}
	}
	go func() {
		defer u.Quit()
		wait := func(name string) { time.Sleep(1200 * time.Millisecond); shot(name + sfx) }
		ctx, cancel := context.WithCancel(context.Background())
		go u.WelcomeRec(ctx, flow.Welcome{Host: "stg.remote.noktabilisim.net", Tenant: "Nokta Bilişim",
			TechName: "Ayşe Yılmaz", TechVerifyCode: "4821", ConsentVersion: 3,
			ConsentBody: "Kişisel verileriniz 6698 sayılı KVKK kapsamında işlenir; çğıöşüİ.",
			AbuseEmail:  "abuse@noktabilisim.net", RecOffered: true, ChatRetentionDays: 90})
		wait("1-karsilama")
		mapped("karşılama", 1)
		cancel()
		onMain(u, func() {
			for f := range u.forms {
				f.destroy()
			}
		})
		u.Lobby("K7Q2", "Ayşe Yılmaz")
		wait("2-lobi")
		mapped("lobi", 1)
		u.Active("Ayşe Yılmaz", signal.Monitor{ID: 0, Name: "DP-1", W: 1920, H: 1080, Primary: true})
		u.SetHotkey("Ctrl+Shift+F12")
		u.ClipSwitch(flow.ClipSwitchState{Visible: true, Enabled: true})
		u.Status("Ekranınız paylaşılıyor.")
		// P22-G: sohbet bölümü flow.ChatView ile; düz metin — `<b>` literal görünür (markup yok).
		chatText := "[10:00] Teknisyen Ayşe Yılmaz:\n    Merhaba, ekranınızı görüyorum. <b>kalın değil</b>\n"
		u.SessionChat(flow.ChatView{Text: chatText, Rev: 1, Enabled: true, Status: "<b>durum</b>"})
		onMain(u, func() {
			s := u.sess
			switch {
			case s == nil:
				fail("oturum penceresi yok")
			case textViewText(s.history) != chatText:
				fail("sohbet geçmişi düz metin değil: %q", textViewText(s.history))
			case labelText(s.chatNote) != "<b>durum</b>":
				fail("sohbet durum satırı markup yorumladı: %q", labelText(s.chatNote))
			case !gtkWidgetGetSensitive(s.input) || !gtkWidgetGetSensitive(s.sendBtn):
				fail("chat.state{true} görünümünde giriş etkin olmalı")
			}
		})
		u.RecState(flow.RecView{On: true})
		u.VoiceBar(flow.VoiceView{On: true, Talkers: []string{"Ayşe Yılmaz"}})
		if !u.ShowRoster(flow.RosterView{Controller: "Ayşe Yılmaz", Techs: []flow.RosterTech{
			{TID: "t1", Name: "Ayşe Yılmaz", Role: "Teknisyen", Owner: true, Connected: true},
			{TID: "t2", Name: "Mehmet Kaya", Role: "Teknisyen", Connected: true, Removable: true}}}) {
			fail("roster çizimi doğrulanamadı")
		}
		wait("3-oturum")
		mapped("oturum", 1)
		broken := false
		onMain(u, func() { broken = u.ind == nil || u.ind.broken })
		if broken { // bileştiricisiz Xvfb (CI): gösterge kurulamaz → 3 tikte kapı kapanmalı (fail-closed)
			time.Sleep(3500 * time.Millisecond)
			onMain(u, func() {
				if !u.health.Failed {
					fail("bileştirici yokken gösterge sağlığı fail-closed olmalı")
				}
			})
		}
		u.ControlRequest(flow.ControlPrompt{TechName: "Ayşe Yılmaz", Hotkey: "Ctrl+Shift+F12"})
		time.Sleep(300 * time.Millisecond)
		onMain(u, func() {
			d := u.ctlDlg
			if broken {
				return // diyalog açılır ama izin guard'da reddedilir (health.Failed); kilit denetimi aynı
			}
			switch {
			case d == nil:
				fail("kontrol diyaloğu açılmadı")
			case gtkWidgetGetSensitive(d.grant):
				fail("izin düğmesi 1,5 sn kilitli açılmalı")
			case u.protectedOpen != 1:
				fail("korunan diyalog sayacı %d", u.protectedOpen)
			}
		})
		time.Sleep(500 * time.Millisecond) // 0,3 + 1,2 + 0,5 sn > control.ArmDelay (1,5 sn)
		wait("4-kontrol-istegi")
		onMain(u, func() {
			if d := u.ctlDlg; d != nil && !gtkWidgetGetSensitive(d.grant) {
				fail("izin düğmesi 1,5 sn sonra etkinleşmeli")
			}
		})
		u.ControlPromptClosed()
		u.FileOffer(transfer.Prompt{FID: "f1", Name: "kurulum.desktop", Size: 2048, Warning: files.WarnDangerous})
		wait("5-dosya-teklifi")
		u.FileOfferWithdrawn("f1")
		go u.PortalFailed(context.Background(), false)
		wait("6-portal-basarisiz")
		u.PortalDone()
		u.Ended(flow.Message{Title: "Oturumu sonlandırdınız", Body: "Teknisyen artık ekranınızı göremez."})
		wait("7-bitti")
		onMain(u, func() {
			if s := u.sess; s == nil || !s.finished || !strings.Contains(labelText(s.watch), "sonlandırdınız") {
				fail("bitti ekranı oturum penceresine yazılmadı")
			}
		})
	}()
	u.Run()
	return errs
}
