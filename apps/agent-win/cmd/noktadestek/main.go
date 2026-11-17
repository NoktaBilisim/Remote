//go:build windows

// Command noktadestek müşteri bilgisayarında çalışan Hızlı Destek istemcisidir (P6): güvenli açılış (DLL arama sırası,
// gömülü yapılandırma, kimlik) → açılış kararı (internal/launch: kod / firma dosyası / bilgisayar kaydı, P8c) → kod akışı
// (internal/flow) veya ana ekran + talep (internal/request) → paylaşım → en geç 3 sn içinde çıkış (AC-107). Arayüz
// internal/ui. P20 K5: `--tray` açılışı ve tepsiye inme (internal/tray, yerleşik döngü resident.go); tepsi modunda
// oturum sonunda süreç tepside kalır (AC-107 istisnası, K-P20-7).
package main

import (
	"context"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/autorun"
	"remote-support/agent-win/internal/clipprint"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/diag"
	"remote-support/agent-win/internal/dllsafe"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/printing"
	"remote-support/agent-win/internal/remember"
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
	// P28a (mimari-p28 §5.2): `--pdf-isleyici` tek ve tam argümanla PDF işleyici kipi; yapılandırma/kimlik/arayüz yok.
	if printing.IsWorkerLaunch(os.Args) {
		os.Exit(runPDFWorker())
	}
	os.Exit(run())
}

// runPDFWorker işleyici kipi: ilk iş DLL sertleştirme (AC-341 kalıbı), sonra yalnız boru döngüsü.
func runPDFWorker() int {
	if err := dllsafe.Harden(); err != nil {
		return exitDLLHarden
	}
	return printing.RunWorker()
}

// app açılışta bir kez kurulan süreç durumu (setup). trayLock tek örnek mutex'idir: süreç ömrü boyunca açıkça tutulur
// (S-P20-K3), run dönerken bırakılır.
type app struct {
	trayLaunch bool
	elevated   bool
	cfg        config.Config
	exe, fp    string
	origin     string
	store      *remember.Store
	startup    *remember.MigrateResult
	diagLog    *diag.Log
	trayLock   *tray.Lock
	// P28a pano iş parçacığı (deps.go clipboard; süreç ömrü).
	clipOnce sync.Once
	clip     *clipprint.Clipboard
}

// run kurulum → mod seçimi (`--tray`) → çalıştırma (arayüz + yerleşik döngü).
func run() int {
	a, code := setup()
	if a == nil {
		return code
	}
	// S-P20-K3: tek örnek mutex'i süreç ömrü boyunca açıkça tutulur (GC/finalizer davranışına bağlı değil), run dönerken
	// bırakılır (Release nil güvenli).
	defer func() { a.trayLock.Release() }()
	defer func() { // P28a pano iş parçacığı (kurulduysa)
		if a.clip != nil {
			a.clip.Close()
		}
	}()
	trayIcon, trayBalloon, ok := a.startTray()
	if !ok {
		return exitOK
	}
	return a.serve(trayIcon, trayBalloon)
}

// setup güvenli açılış: DLL sertleştirme, gömülü yapılandırma, kimlik, yükseltilmişlik, köken, kayıt deposu + göç ve
// tanılama logu. Hata durumunda nil ve çıkış kodu.
func setup() (*app, int) {
	// G-P20-6: `--tray` yalnız tek ve tam argüman; başka argümanlar yok sayılır (komut satırından URL/anahtar alınmaz).
	trayLaunch := tray.IsTrayLaunch(os.Args)
	// G-08: başka hiçbir DLL yüklenmeden önce.
	if err := dllsafe.Harden(); err != nil {
		return nil, exitDLLHarden
	}
	cfg, err := config.Load()
	if err != nil {
		// oturum açılışında hata penceresi yok
		return nil, startFailed(trayLaunch, exitConfig,
			"Bu program hatalı derlenmiş (sunucu adresi yok). Teknisyeninizden yeni bir indirme bağlantısı isteyin.")
	}
	exe, fp, err := identity()
	if err != nil {
		return nil, startFailed(trayLaunch, exitIdentity, "Program dosyası okunamadı. Dosyayı yeniden indirip tekrar deneyin.")
	}
	a := &app{trayLaunch: trayLaunch, cfg: cfg, exe: exe, fp: fp}
	a.elevated = env.SelfElevated() // S7-9/K8: süreç ömrü boyunca sabit, açılışta bir kez ölçülür
	a.origin, _ = remember.CanonicalOrigin(cfg.ServerURL.String())
	a.openStore()
	return a, exitOK
}

// startFailed `--tray` açılışı dışında hata penceresi gösterir; çıkış kodunu döner.
func startFailed(trayLaunch bool, code int, msg string) int {
	if !trayLaunch {
		ui.ShowError(msg)
	}
	return code
}

// openStore kayıt deposu, P20 K2 göçü ve tanılama logu; açılış okuma/göç sorunu tanılamaya yazılır.
func (a *app) openStore() {
	a.store = rememberStore()
	// P20 K2: ilk okumadan önce bir kez göç (hatirla.bin → kayitlar.bin); sonuç açılışın okuma durumudur.
	if a.store != nil {
		m := a.store.Migrate()
		a.startup = &m
	}
	// 0.10.2: tanılama logu yalnız yakalama sorununda ve yalnız kalıcı modda (kayıt veya "hatırla" var) yazılır; kod
	// modunda, LocalAppData yoksa veya süreç yükseltilmişse (CWE-59) kapalı. Neden kodu her durumda ekranda görünür.
	if a.store != nil {
		a.diagLog = diag.NewLog(a.store.Dir, a.elevated, a.store.Persistent)
	}
	if a.startup != nil {
		if a.startup.Status == remember.StatusUnreadable {
			a.writeDiag(eventLoadFailed, a.startup.Class) // salt-okunur açılış (G-P20-3)
		}
		if a.startup.Failed {
			a.writeDiag(eventMigrateFailed, "")
		}
	}
}

func (a *app) writeDiag(event, reason string) {
	if a.diagLog != nil {
		_ = a.diagLog.Write(diag.Report{Time: time.Now(), Event: event, Version: a.cfg.Version, Reason: reason})
	}
}

// startTray `--tray` (mimari-e11 §8d.3): dosya adı değerlendirilmez, ağ isteği yok; yalnız tepsi. Normal açılışta
// (nil, "", true). false: süreç exitOK ile biter (açılmaz, Run değeri silindi veya ikinci örnek).
func (a *app) startTray() (*tray.Icon, string, bool) {
	if !a.trayLaunch {
		return nil, "", true
	}
	var st remember.LoadResult
	if a.startup != nil {
		st = a.startup.LoadResult
	}
	switch tray.DecideStart(st, a.origin, a.store != nil, a.elevated) {
	case tray.StartQuit:
		return nil, "", false
	case tray.StartDisable:
		_ = autorun.New().Disable()
		return nil, "", false
	}
	c, _ := autorun.New().Verify() // G-P20-15; eksik exe de silinir (S-P20-K1)
	balloon := tray.AutorunBalloon(c)
	icon, lock, ok := acquireTray(a.writeDiag)
	if !ok {
		tray.SignalExisting() // ikinci örnek: ilkini öne getir ve çık (yalnız aynı kullanıcının penceresi, S-P20-K2)
		return nil, "", false
	}
	a.trayLock = lock
	return icon, balloon, true
}

// serve arayüzü açar ve yerleşik döngüyü (tepsi veya normal) çalıştırır; döngü bitince exitOK.
func (a *app) serve(trayIcon *tray.Icon, trayBalloon string) int {
	u, err := ui.New(a.cfg.DisplayHost(), a.cfg.Version, a.fp, nil)
	if err != nil {
		if trayIcon != nil {
			trayIcon.Close()
		}
		if !a.trayLaunch {
			ui.ShowError("Arayüz başlatılamadı.")
		}
		return exitUI
	}
	defer u.Close()
	u.SetElevated(a.elevated) // yerel kırmızı uyarı

	var current atomic.Pointer[tray.Icon] // tepsi simgesi (yoksa nil): K6 sohbet balonu
	if trayIcon != nil {
		current.Store(trayIcon)
	}
	u.SetRequestChatBalloon(func(text string) { // metin sabit (request.ChatBalloonText), gövde yok (K-P20-9)
		if ic := current.Load(); ic != nil {
			ic.Balloon(text)
		}
	})

	// P28d O-PD-3: mikrofon açıkken tepsi ipucu "Mikrofon açık"/"Sessizde" + menüde "Görüşmeyi bitir"; yeni dinleyici
	// balonu sabit metin (flow.VoiceTexts.Balloon, ad yok — K-P20-9). Tepsi yoksa gösterge yalnız şerit + pencere satırı.
	u.SetVoiceTray(func(on, muted bool) {
		if ic := current.Load(); ic != nil {
			ic.SetVoice(on, muted)
		}
	}, func(text string) {
		if ic := current.Load(); ic != nil {
			ic.Balloon(text)
		}
	})

	client := api.New(a.cfg.ServerURL, a.cfg.Version)
	res := a.resident(u, client, &current)
	if trayIcon != nil {
		res.RunTray(context.Background(), trayIcon, trayBalloon)
	} else {
		res.RunNormal(context.Background())
	}
	current.Store(nil)
	return exitOK
}

// rememberStore hatırlama dosyası deposu; LocalAppData bulunamazsa nil (kayıt ve hatırlama kapalı).
func rememberStore() *remember.Store {
	s, err := remember.DefaultStore()
	if err != nil {
		return nil
	}
	return s
}
