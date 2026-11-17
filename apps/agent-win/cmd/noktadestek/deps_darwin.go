//go:build darwin

package main

import (
	"context"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/clipprint"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/fsrv"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// flowDeps macOS kod akışının bağımlılıkları (mimari-p28f §2). Bağlanmayan özellikler bildirilmez (flow.Features):
// kontrol (Hotkey/Input boş → izin verilemez, G-21; K3), ses (ADR-0037 r3: bildirilmez), roster/çoklu teknisyen ve sunucu dosyası
// arayüzü (K4), pencere paylaşımı (macOS'ta yok, AC-248).
// K5: alınan dosyalar ~/Downloads'a (files.DownloadsDir), `.part`'ta karantinayla (T8); pano NSPasteboard ile ve yalnız
// arayüz ClipPrintUI'yi uyguluyorsa (pano izni anahtarı korunan denetimdir, S-P28f-1); yazdırma lp ile (r4: sayfa sayısı
// istemcide yok, PagesUnknown; yazıcı "Varsayılan yazıcı"), yine yalnız ClipPrintUI varken.
//
// K3: gate arayüzle (mac.Options.Gate) paylaşılan izin kapısıdır; girdi bağlantısı controlDeps'te.
func flowDeps(cfg config.Config, fp string, client *api.Client, u flow.UI, events <-chan flow.Event,
	gate *control.Gate) flow.Deps {
	media, merr := rtc.NewMedia(rtc.H264) // ana/düşük iz çifti (ADR-0035)
	d := flow.Deps{
		Host: cfg.DisplayHost(), Version: cfg.Version, Fingerprint: fp,
		API: client,
		NewPeer: func(ice []signal.IceServer, caps []string, h rtc.Handlers) (flow.Peer, error) {
			if merr != nil {
				return nil, merr
			}
			return rtc.New(ice, caps, h, media)
		},
		Monitors:    capture.Monitors,
		Capture:     capture.Open,
		EnvProbe:    capture.EnvProbe, // K2: kilit ekranı / konsolda değil → "Müşteri güvenli masaüstünde" (AC-105)
		DownloadDir: files.DownloadsDir,
		MOTW:        files.WriteQuarantine,
		Logo:        client.Logo, // AC-98: yalnız gömülü sunucu kökeni, PNG/JPG ≤ 2 MB
		UI:          u,
		Events:      events,
		FileServer:  fsrv.New(cfg.ServerURL, client.HTTPClient(), cfg.Version),
	}
	if merr == nil {
		d.Media = media
	}
	// P28a/P28f K5: pano süreç ömründe bir kez (flowDeps macOS'ta bir kez çağrılır); kurulamazsa özellik bildirilmez.
	// Features'tan ÖNCE atanmalı.
	if cp, ok := u.(flow.ClipPrintUI); ok {
		d.ClipPrintUI = cp
		d.Printer = clipprint.NewPrinter("") // macOS: lp, işleyici süreç yok (argüman kullanılmaz)
		if c, err := clipprint.NewClipboard(); err == nil {
			d.Clipboard = c
		}
	}
	// K4: teknisyen listesi + "Çıkar" (rs.cap.multi1) ve sunucu dosyası durum satırı (rs.cap.fsrv1) arayüz uyguluyorsa.
	if r, ok := u.(flow.RosterUI); ok {
		d.RosterUI = r
	}
	if fs, ok := u.(flow.FileServerUI); ok {
		d.FileServerUI = fs
	}
	controlDeps(&d, u, gate) // K3: Features'tan ÖNCE (Input/Hotkey bağlı değilse kontrol bildirilmez)
	features := flow.Features(d)
	d.Dial = func(ctx context.Context, cred signal.Credential) (flow.Conn, error) {
		return signal.Dial(ctx, client.HTTPClient(), cfg.ServerURL, cred, features)
	}
	return d
}

// controlDeps P28f K3 (mimari-p28f §5.2, §5.2a; ADR-0037 m.3): CGEvent enjektörü + Applier (Windows ile aynı arayüz),
// Carbon kapatma kısayolu ve olay musluğu (input.Host), Erişilebilirlik yoklaması (OS_PERMISSION). Enjektör
// kurulamaz ya da kısayol kaydedilemezse Input/Hotkey boş kalır → kontrol izni verilemez (G-21, fail-closed).
// Arayüz kancaları isteğe bağlıdır (ui/mac uyguluyorsa bağlanır): kısayol etiketi, korunan diyalogda enjeksiyon
// duraklatma, Erişilebilirlik rehberi. localClick'in tek tanımı input.LocalClick'tir (ui/mac doğrudan çağırır).
// P28f düzeltme 1: Applier'a macOS sorguları (Fare Tuşları, imleç; Y-P28f-K1) bağlanır, pencere çerçevelerini ui/mac
// input.SetOwnWindows ile verir; "İzin ver"de kapı açılmadan önce olay musluğu kurulur (ArmControl, D-P28f-K1).
func controlDeps(d *flow.Deps, u flow.UI, gate *control.Gate) {
	if gate == nil {
		return
	}
	d.Gate = gate
	inj, err := input.NewCGInjector()
	if err != nil {
		return
	}
	// Kısayol ve musluk kaybı akışa doğrudan olay olarak girer (arayüzün olay kanalıyla birleştirilir).
	merged := make(chan flow.Event, 16)
	go func(in <-chan flow.Event) {
		for e := range in {
			merged <- e
		}
		close(merged)
	}(d.Events)
	d.Events = merged
	host := input.Start(gate, func() { merged <- flow.Event{Kind: flow.EvControlHotkey} },
		func() { merged <- flow.Event{Kind: flow.EvControlSystem} })
	if host.HotkeyErr != nil {
		return
	}
	applier := input.NewApplier(gate, inj, nil)
	applier.SetAltGrText(true) // Türkçe Q: AltGr karakterleri ⌘⌥ kısayolu değil metin
	applier.SetHostProbe(input.MacProbe())
	d.ArmControl = host.Arm
	d.Hotkey = host.Hotkey.Label
	d.Input = applier.Handle
	d.SetInputMonitor = func(id int) {
		if b, ok := capture.MonitorRect(id); ok {
			mon := control.Rect{Left: int32(b.Origin.X), Top: int32(b.Origin.Y),
				Right: int32(b.Origin.X + b.Size.W), Bottom: int32(b.Origin.Y + b.Size.H)}
			virt := input.VirtualScreen()
			inj.SetVirtual(virt)
			applier.SetTarget(mon, virt)
		}
	}
	d.ControlReady = input.ControlReady
	if g, ok := u.(interface{ AccessibilityGuide() }); ok {
		d.AccessGuide = g.AccessibilityGuide
	}
	if h, ok := u.(interface{ SetHotkey(label string) }); ok {
		h.SetHotkey(d.Hotkey)
	}
	if p, ok := u.(interface{ SetInjectPause(fn func(paused bool)) }); ok {
		p.SetInjectPause(func(paused bool) {
			if paused {
				applier.Pause()
			} else {
				applier.Resume()
			}
		})
	}
}
