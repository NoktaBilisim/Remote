//go:build windows

// Command noktadestek müşteri bilgisayarında çalışan Hızlı Destek istemcisidir (P6): güvenli açılış (DLL arama sırası,
// gömülü yapılandırma, kimlik) → açılış kararı (internal/launch: kod / firma dosyası / bilgisayar kaydı, P8c) → kod akışı
// (internal/flow) veya ana ekran + talep (internal/request) → paylaşım → en geç 3 sn içinde çıkış (AC-107). Arayüz
// internal/ui. P20 K5: `--tray` açılışı ve tepsiye inme (internal/tray, yerleşik döngü resident.go); tepsi modunda
// oturum sonunda süreç tepside kalır (AC-107 istisnası, K-P20-7).
package main

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/autorun"
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/diag"
	"remote-support/agent-win/internal/dllsafe"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/pairing"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/tray"
	"remote-support/agent-win/internal/ui"
)

// Çıkış kodları.
const (
	exitOK = iota
	exitDLLHarden
	exitConfig
	exitIdentity
	exitUI
)

// Tanılama olayları (içerik yok): S17-1 `input.dropped{reason}`; P20 K2 okuma/göç (G-P20-3); K5 tepsi mutex'i (G-P20-16).
const (
	eventInputDropped     = "input_dropped"
	eventLoadFailed       = "load_failed"
	eventMigrateFailed    = "migrate_failed"
	eventTrayMutexForeign = "tray_mutex_foreign"
)

// exitGrace tepsiden "Çık": oturumun session.end ile kapanması için beklenen süre, sonra bağlam iptal edilir.
const exitGrace = 2 * time.Second

// closeDelay AC-107: son ekran gösterildikten sonra kapanış ("3 sn içinde" — pay bırakıldı).
const closeDelay = 2500 * time.Millisecond

func main() {
	os.Exit(run())
}

func run() int {
	// G-P20-6: `--tray` yalnız tek ve tam argüman; başka argümanlar yok sayılır (komut satırından URL/anahtar alınmaz).
	trayLaunch := tray.IsTrayLaunch(os.Args)
	// G-08: başka hiçbir DLL yüklenmeden önce.
	if err := dllsafe.Harden(); err != nil {
		return exitDLLHarden
	}
	cfg, err := config.Load()
	if err != nil {
		if trayLaunch { // oturum açılışında hata penceresi yok
			return exitConfig
		}
		ui.ShowError("Bu program hatalı derlenmiş (sunucu adresi yok). Teknisyeninizden yeni bir indirme bağlantısı isteyin.")
		return exitConfig
	}
	exe, fp, err := identity()
	if err != nil {
		if trayLaunch {
			return exitIdentity
		}
		ui.ShowError("Program dosyası okunamadı. Dosyayı yeniden indirip tekrar deneyin.")
		return exitIdentity
	}
	selfElevated := env.SelfElevated() // S7-9/K8: süreç ömrü boyunca sabit, açılışta bir kez ölçülür
	origin, _ := remember.CanonicalOrigin(cfg.ServerURL.String())

	store := rememberStore()
	// P20 K2: ilk okumadan önce bir kez göç (hatirla.bin → kayitlar.bin); sonuç açılışın okuma durumudur.
	var startup *remember.MigrateResult
	if store != nil {
		m := store.Migrate()
		startup = &m
	}
	// 0.10.2: tanılama logu yalnız yakalama sorununda ve yalnız kalıcı modda (kayıt veya "hatırla" var) yazılır; kod
	// modunda, LocalAppData yoksa veya süreç yükseltilmişse (CWE-59) kapalı. Neden kodu her durumda ekranda görünür.
	var diagLog *diag.Log
	if store != nil {
		diagLog = diag.NewLog(store.Dir, selfElevated, store.Persistent)
	}
	writeDiag := func(event, reason string) {
		if diagLog != nil {
			_ = diagLog.Write(diag.Report{Time: time.Now(), Event: event, Version: cfg.Version, Reason: reason})
		}
	}
	if startup != nil {
		if startup.Status == remember.StatusUnreadable {
			writeDiag(eventLoadFailed, startup.Class) // salt-okunur açılış (G-P20-3)
		}
		if startup.Failed {
			writeDiag(eventMigrateFailed, "")
		}
	}

	// `--tray` (mimari-e11 §8d.3): dosya adı değerlendirilmez, ağ isteği yok; yalnız tepsi.
	var trayIcon *tray.Icon
	trayBalloon := ""
	if trayLaunch {
		var st remember.LoadResult
		if startup != nil {
			st = startup.LoadResult
		}
		switch tray.DecideStart(st, origin, store != nil, selfElevated) {
		case tray.StartQuit:
			return exitOK
		case tray.StartDisable:
			_ = autorun.New().Disable()
			return exitOK
		}
		if c, _ := autorun.New().Verify(); c.Removed { // G-P20-15
			trayBalloon = tray.BalloonAutorunOff
		}
		icon, ok := acquireTray(writeDiag)
		if !ok {
			tray.SignalExisting() // ikinci örnek: ilkini öne getir ve çık
			return exitOK
		}
		trayIcon = icon
	}

	u, err := ui.New(cfg.DisplayHost(), cfg.Version, fp, nil)
	if err != nil {
		if trayIcon != nil {
			trayIcon.Close()
		}
		if !trayLaunch {
			ui.ShowError("Arayüz başlatılamadı.")
		}
		return exitUI
	}
	defer u.Close()
	u.SetElevated(selfElevated) // yerel kırmızı uyarı

	var current atomic.Pointer[tray.Icon] // tepsi simgesi (yoksa nil): K6 sohbet balonu
	if trayIcon != nil {
		current.Store(trayIcon)
	}
	u.SetRequestChatBalloon(func(text string) { // metin sabit (request.ChatBalloonText), gövde yok (K-P20-9)
		if ic := current.Load(); ic != nil {
			ic.Balloon(text)
		}
	})

	client := api.New(cfg.ServerURL, cfg.Version)
	opener := capture.Opener{Version: cfg.Version, Log: diagLog}
	firstStartup := startup
	scope := tray.Scope{
		// G-P20-5: kapatma kısayolu (Ctrl+Shift+F12, yedek Ctrl+Shift+F11) ve yalnız kapı açıkken kurulan yerel öncelik
		// kancaları (S7-7) yalnız pencere kapsamı süresince; tepside boştayken yok.
		Hotkey: func(gate *control.Gate) (string, func()) {
			host := input.Start(gate, u.HotkeyPressed)
			label := ""
			if host.HotkeyErr == nil {
				label = host.Hotkey.Label
			}
			return label, host.Stop
		},
		Reset: u.ResetScope,
		Run: func(ctx context.Context, first bool, gate *control.Gate, hotkey string, active func()) flow.Outcome {
			ld := launchDeps(cfg, fp, selfElevated, client, u, store, opener, diagLog, gate, hotkey, active)
			ld.Diag = writeDiag
			ld.Startup, firstStartup = firstStartup, nil // göç bilgileri yalnız ilk ana ekranda
			if first {
				ld.Exe = exe
			}
			// mimari-e10 §8.1: dosya adı + ağ yanıtı + bilgisayar kaydı → kod akışı / ana ekran (internal/launch).
			return launch.Run(ctx, ld)
		},
		Ended: func(out flow.Outcome) {
			if out.BindingChanged != "" {
				u.EndedNote(launch.ChangedText(out.BindingChanged)) // AC-187
			}
			u.Ended(out.Message)
		},
		CloseDelay: closeDelay,
		Idle:       client.HTTPClient().CloseIdleConnections,
	}
	_, isRef := pairing.RefFromFileName(exe)
	_, isCode := pairing.FromFileName(exe)
	res := tray.Resident{
		Scope:  scope,
		Origin: origin,
		State: func() remember.LoadResult {
			if store == nil {
				return remember.LoadResult{}
			}
			return store.LoadState()
		},
		StartTray: func() (tray.IconAPI, bool) { // G-P20-13: X ile tepsiye inen süreç de mutex'i almak zorunda
			icon, ok := acquireTray(writeDiag)
			if !ok {
				return nil, false
			}
			current.Store(icon)
			return icon, true
		},
		Verify: func() bool {
			c, _ := autorun.New().Verify() // G-P20-15: tepsiden pencere açılışında
			return c.Removed
		},
		Disable:    func() { _ = autorun.New().Disable() },
		Raise:      u.Raise,
		EndSession: u.EndSession,
		Standalone: isRef || isCode, // kod/ref dosyası tepsi örneğine bağlanmaz
		Elevated:   selfElevated,
		ExitGrace:  exitGrace,
	}
	if trayIcon != nil {
		res.RunTray(context.Background(), trayIcon, trayBalloon)
	} else {
		res.RunNormal(context.Background())
	}
	current.Store(nil)
	return exitOK
}

// acquireTray tek örnek mutex'i (G-P20-16 sahip denetimi) + simge. Başka sahipli mutex yok sayılır (diag).
func acquireTray(writeDiag func(event, reason string)) (*tray.Icon, bool) {
	_, r := tray.Acquire() // tutulan handle süreç ömrü boyunca açık kalır (işletim sistemi çıkışta bırakır)
	switch r {
	case tray.LockTaken:
		return nil, false
	case tray.LockForeign:
		writeDiag(eventTrayMutexForeign, "")
	}
	icon, err := tray.Start(ui.SystemLogo())
	if err != nil {
		return nil, false
	}
	return icon, true
}

// launchDeps bir pencere kapsamının açılış bağımlılıkları (G-P20-5): izin kapısı, SendInput alıcısı ve kısayol bu
// kapsamındır; flow.Deps her kapsamda yeniden kurulur (bağlayıcı kayıt yuvası, logo, sohbet, PeerConnection launch/flow
// içinde kapsam başına).
func launchDeps(cfg config.Config, fp string, elevated bool, client *api.Client, u *ui.UI, store *remember.Store, opener capture.Opener,
	diagLog *diag.Log, gate *control.Gate, hotkey string, active func()) launch.Deps {
	// P7: SendInput alıcısı.
	applier := input.NewApplier(gate, input.SendInputInjector{}, nil)
	if diagLog != nil { // S17-1: pencere kapsamı düşmeleri (5 sn'de en çok 1 satır; içerik/koordinat yok)
		applier.SetDropLog(func(reason string) {
			_ = diagLog.Write(diag.Report{Time: time.Now(), Event: eventInputDropped, Version: cfg.Version, Reason: reason})
		})
	}
	deps := flow.Deps{
		Host: cfg.DisplayHost(), Version: cfg.Version, Fingerprint: fp,
		API: client,
		Dial: func(ctx context.Context, cred signal.Credential) (flow.Conn, error) {
			return signal.Dial(ctx, client.HTTPClient(), cfg.ServerURL, cred)
		},
		NewPeer: func(ice []signal.IceServer, caps []string, h rtc.Handlers) (flow.Peer, error) {
			return rtc.New(ice, caps, h)
		},
		Monitors:    capture.Monitors,
		Capture:     opener.Open,
		DownloadDir: func() (string, error) { return windows.KnownFolderPath(windows.FOLDERID_Downloads, 0) },
		MOTW:        files.WriteMOTW,
		Logo:        client.Logo, // AC-98: yalnız gömülü sunucu kökeni, PNG/JPG ≤ 2 MB
		UI:          tray.WithActive(u, active),
		Events:      u.Events(),
		Gate:        gate,
		Hotkey:      hotkey,
		Input:       applier.Handle,
		SetInputMonitor: func(id int) {
			if r, ok := capture.MonitorRect(id); ok {
				applier.SetTarget(control.Rect{Left: r.Left, Top: r.Top, Right: r.Right, Bottom: r.Bottom}, input.VirtualScreen())
			}
		},
		// AC-248 pencere modu (WGC) + S17-1 girdi kapsamı.
		WindowCapture: capture.WindowCaptureSupported,
		CaptureWindow: opener.OpenWindow,
		SetInputWindow: func(hwnd uintptr) {
			applier.SetWindowTarget(hwnd, input.VirtualScreen(), input.WinWindowAPI{})
		},
		EnvProbe:     env.Probe,
		SelfElevated: elevated, // K8: env.state.selfElevated (GRANTED audit'i, konsol rozeti)
	}
	ld := launch.Deps{ServerURL: cfg.ServerURL, API: client, Flow: deps,
		Request: request.Deps{UI: u, Events: u.RequestEvents(), Version: cfg.Version, Logo: client.Logo,
			Dial: func(ctx context.Context, secret string) (request.Conn, error) {
				return request.Dial(ctx, client.HTTPClient(), cfg.ServerURL, secret)
			}}}
	if store != nil {
		ld.Store = store
	}
	return ld
}

// rememberStore hatırlama dosyası deposu; LocalAppData bulunamazsa nil (kayıt ve hatırlama kapalı).
func rememberStore() *remember.Store {
	s, err := remember.DefaultStore()
	if err != nil {
		return nil
	}
	return s
}

// identity çalışan ikilinin yolu ve SHA-256 ilk 8 hanesi (AC-128).
func identity() (string, string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", "", err
	}
	f, err := os.Open(exe)
	if err != nil {
		return "", "", err
	}
	defer f.Close()
	fp, err := config.Fingerprint(f)
	if err != nil {
		return "", "", errors.Join(errors.New("parmak izi hesaplanamadı"), err)
	}
	return exe, fp, nil
}
