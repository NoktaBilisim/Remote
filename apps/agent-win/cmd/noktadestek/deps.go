//go:build windows

package main

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/autorun"
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/clipprint"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/diag"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/fsrv"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/remember"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/tray"
	"remote-support/agent-win/internal/ui"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/voice"
)

// Pencere kapsamı ve yerleşik döngü bağımlılıkları (run'ın çalıştırma adımı; PT-K8'de main.go'dan ayrıldı).

// resident yerleşik döngünün bağımlılıkları (tepsiye inme, Run doğrulaması, öne getirme, çıkış).
func (a *app) resident(u *ui.UI, client *api.Client, current *atomic.Pointer[tray.Icon]) tray.Resident {
	return tray.Resident{
		Scope:  a.scope(u, client),
		Origin: a.origin,
		State: func() remember.LoadResult {
			if a.store == nil {
				return remember.LoadResult{}
			}
			return a.store.LoadState()
		},
		StartTray: func() (tray.IconAPI, bool) { // G-P20-13: X ile tepsiye inen süreç de mutex'i almak zorunda
			icon, lock, ok := acquireTray(a.writeDiag, a.cfg.Version)
			if !ok {
				return nil, false
			}
			a.trayLock = lock
			current.Store(icon)
			return icon, true
		},
		Verify: func() string {
			c, _ := autorun.New().Verify() // G-P20-15: tepsiden pencere açılışında
			return tray.AutorunBalloon(c)
		},
		Disable:    func() { _ = autorun.New().Disable() },
		Raise:      u.Raise,
		EndSession: u.EndSession,
		VoiceEnd:   u.VoiceEnd,     // P28d O-PD-3: menüde "Görüşmeyi bitir"
		Licenses:   u.ShowLicenses, // P28d: üçüncü taraf bildirimleri (ağsız)
		Elevated:   a.elevated,     // firma/kod dosyasıyla açılış da aynı tepsi kurallarına tabidir (tek ekran, 2026-11-15)
		ExitGrace:  exitGrace,
	}
}

// scope bir pencere kapsamı: kısayol, sıfırlama, açılış (launch.Run) ve son ekran.
func (a *app) scope(u *ui.UI, client *api.Client) tray.Scope {
	opener := capture.Opener{Version: a.cfg.Version, Log: a.diagLog}
	firstStartup := a.startup
	return tray.Scope{
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
			// P29 K8 (AC-479): pencere kapsamı sürerken kurulum yok; kapsam bitince bekleyen sürüm kurulur (son ekrandan önce).
			a.upd.Begin()
			defer a.upd.End()
			a.beginUpdates()
			ld := a.launchDeps(client, u, opener, gate, hotkey, active)
			ld.Diag = a.writeDiag
			ld.Startup, firstStartup = firstStartup, nil // göç bilgileri yalnız ilk ana ekranda
			if first {
				ld.Exe = a.exe
			}
			// mimari-e10 §8.1: dosya adı + ağ yanıtı + bilgisayar kaydı → kod akışı / ana ekran (internal/launch).
			return launch.Run(ctx, ld)
		},
		Ended: func(out flow.Outcome) {
			// AC-187: keeper tam cümle üretir; P29 AC-482/483: bekleyen güncelleme bilgisi (bir kez) aynı satırda.
			note := strings.TrimSpace(out.BindingChanged + " " + a.upd.Notice())
			if note != "" {
				u.EndedNote(note)
			}
			u.Ended(out.Message)
		},
		CloseDelay: closeDelay,
		Idle:       client.HTTPClient().CloseIdleConnections,
	}
}

// acquireTray tek örnek mutex'i (G-P20-16 sahip denetimi) + simge. Başka sahipli mutex yok sayılır (diag; kilit nil).
// Dönen kilidi çağıran süreç ömrü boyunca tutar ve çıkışta bırakır (S-P20-K3); simge eklenemezse kilit bırakılır.
func acquireTray(writeDiag func(event, reason string), version string) (*tray.Icon, *tray.Lock, bool) {
	lock, r := tray.Acquire()
	switch r {
	case tray.LockTaken:
		return nil, nil, false
	case tray.LockForeign:
		writeDiag(eventTrayMutexForeign, "")
	}
	icon, err := tray.Start(ui.SystemLogo(), uicore.VersionLabel(version))
	if err != nil {
		lock.Release()
		return nil, nil, false
	}
	return icon, lock, true
}

// launchDeps bir pencere kapsamının açılış bağımlılıkları (G-P20-5): izin kapısı, SendInput alıcısı ve kısayol bu
// kapsamındır; flow.Deps her kapsamda yeniden kurulur (bağlayıcı kayıt yuvası, logo, sohbet, PeerConnection launch/flow
// içinde kapsam başına).
func (a *app) launchDeps(client *api.Client, u *ui.UI, opener capture.Opener, gate *control.Gate, hotkey string,
	active func()) launch.Deps {
	cfg := a.cfg
	// P7: SendInput alıcısı.
	applier := input.NewApplier(gate, input.SendInputInjector{}, nil)
	if a.diagLog != nil { // S17-1: pencere kapsamı düşmeleri (5 sn'de en çok 1 satır; içerik/koordinat yok)
		applier.SetDropLog(func(reason string) {
			_ = a.diagLog.Write(diag.Report{Time: time.Now(), Event: eventInputDropped, Version: cfg.Version, Reason: reason})
		})
	}
	ld := launch.Deps{ServerURL: cfg.ServerURL, API: client, Flow: a.flowDeps(client, u, opener, applier, gate, hotkey, active),
		Home: u,
		Request: request.Deps{UI: u, Events: u.RequestEvents(), Version: cfg.Version, Logo: client.Logo,
			Dial: func(ctx context.Context, secret string) (request.Conn, error) {
				return request.Dial(ctx, client.HTTPClient(), cfg.ServerURL, secret)
			}}}
	if a.store != nil {
		ld.Store = a.store
	}
	ld.UpdateNotice = a.upd.Notice // P29: ana ekran bilgi satırı (AC-482/483)
	return ld
}

// flowDeps kod akışının (internal/flow) kapsam bağımlılıkları.
func (a *app) flowDeps(client *api.Client, u *ui.UI, opener capture.Opener, applier *input.Applier, gate *control.Gate,
	hotkey string, active func()) flow.Deps {
	cfg := a.cfg
	media, merr := rtc.NewMedia(rtc.H264) // P28c: kapsam başına tek ana/düşük iz çifti (tüm eşler paylaşır, ADR-0035)
	d := flow.Deps{
		Host: cfg.DisplayHost(), Version: cfg.Version, Fingerprint: a.fp,
		API: client,
		NewPeer: func(ice []signal.IceServer, caps []string, h rtc.Handlers) (flow.Peer, error) {
			if merr != nil {
				return nil, merr
			}
			return rtc.New(ice, caps, h, media)
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
		SelfElevated: a.elevated, // K8: env.state.selfElevated (GRANTED audit'i, konsol rozeti)
		ClipPrintUI:  u,
		RosterUI:     u,                           // P28c: teknisyen listesi + "Çıkar" (rs.cap.multi1 bildirilir)
		ChatUI:       u,                           // P22-G: oturum sohbeti bölümü (rs.cap.schat1 bildirilir)
		Printer:      clipprint.NewPrinter(a.exe), // işleyici `exe --pdf-isleyici` (kısıtlı süreç, iş başına)
		// P28b (mimari-p28b §8): sunucu üzerinden dosya — aynı kök + TLS/proxy taşıyıcısı, belirteç yalnız Bearer.
		FileServer:   fsrv.New(cfg.ServerURL, client.HTTPClient(), cfg.Version),
		FileServerUI: u,
	}
	if c := a.clipboard(); c != nil {
		d.Clipboard = c
	}
	if merr == nil {
		d.Media = media
	}
	// P28d (O-PD-3, A-PD-6): ses motoru yalnız kodlayıcının gerçek zamanlı çalıştığı işlemcide (amd64 + SSE4.1, wazero
	// derleyici yolu) bağlanır; değilse alanlar nil kalır ve `rs.cap.voice1` bildirilmez (flow.Features). Gözetimsiz
	// yardımcıya (unattended/helper) bağlanmaz — sınır testi internal/voice'u yasaklar. Features'tan ÖNCE atanmalı.
	if voice.Supported() {
		d.VoiceUI = u
		d.OpenVoice = a.openVoice
	}
	// P28a (mimari-p28 §4.2): yalnız bağlı özellikler (Clipboard/Printer + ClipPrintUI, K4/K5) bildirilir; P28b: + fsrv.
	features := flow.Features(d)
	d.Dial = func(ctx context.Context, cred signal.Credential) (flow.Conn, error) {
		return signal.Dial(ctx, client.HTTPClient(), cfg.ServerURL, cred, features)
	}
	return d
}

// openVoice P28d: yalnız yerel "Kabul et"ten sonra akışın goroutine'inde çağrılır (K-PD-2): Opus çalışma zamanı +
// WASAPI yakalama/çalma (eCommunications) + 20 ms döngü. Hata (aygıt yok/izin kapalı) açıkça nil arayüzle döner.
// Saha düzeltmesi 1: görüşme kapanınca tanılama özeti (olay=ses_ozet; yalnız sayaç/biçim) yazılır.
func (a *app) openVoice(onFail func(error)) (flow.VoiceCall, error) {
	c, err := voice.New(voice.OpenWASAPI, onFail)
	if err != nil {
		return nil, err
	}
	return &diagCall{Call: c, log: a.diagLog, version: a.cfg.Version}, nil
}

// diagCall Close'da görüşme özetini tanılama loguna yazar (akış döngüsünü bekletmemek için goroutine'de).
type diagCall struct {
	*voice.Call
	log     *diag.Log
	version string
	once    sync.Once
}

func (c *diagCall) Close() error {
	err := c.Call.Close()
	c.once.Do(func() {
		if c.log == nil {
			return
		}
		r := diag.Report{Time: time.Now(), Event: diag.EventVoiceEnd, Version: c.version, Voice: voiceSummary(c.Call.Stats())}
		go func() { _ = c.log.Write(r) }()
	})
	return err
}

// voiceSummary motor sayaçlarını tanılama biçimine çevirir (tid/aygıt adı yok).
func voiceSummary(s voice.Stats) *diag.Voice {
	v := &diag.Voice{Decoded: s.Decoded, FEC: s.FEC, PLC: s.PLC, DecodeErr: s.DecodeErr, Written: s.Written,
		Audible: s.Audible, DroppedPeers: s.DroppedPeers}
	for _, p := range s.Peers {
		v.Peers = append(v.Peers, diag.VoicePeer{Rx: p.Rx, Gated: p.Gated, Jitter: p.Jitter})
	}
	if d := s.Device; d != nil {
		v.Device, v.RenderIsComm, v.Rendered, v.RenderDropped = true, d.RenderIsComm, d.Rendered, d.RenderDropped
		v.Render = diag.AudioFormat{Rate: d.Render.Rate, Channels: d.Render.Channels, Bits: d.Render.Bits, Float: d.Render.Float}
		v.Capture = diag.AudioFormat{Rate: d.Capture.Rate, Channels: d.Capture.Channels, Bits: d.Capture.Bits, Float: d.Capture.Float}
	}
	return v
}

// clipboard P28a pano iş parçacığı süreç ömründe bir kez kurulur (kapsam başına iş parçacığı açılmaz); kurulamazsa nil
// ve pano özelliği bildirilmez (flow.Features).
func (a *app) clipboard() flow.Clipboard {
	a.clipOnce.Do(func() {
		if c, err := clipprint.NewClipboard(); err == nil {
			a.clip = c
		}
	})
	if a.clip == nil {
		return nil
	}
	return a.clip
}
