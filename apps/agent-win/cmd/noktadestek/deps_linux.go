//go:build linux

package main

import (
	"context"
	"errors"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/clipprint"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/fsrv"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/voice"
)

// errNotYet K1 iskeleti: yeteneğin Linux uygulaması sonraki pakette (K2 yakalama, K5 dosya). Akış bunu mevcut hata
// yolundan işler (yakalama hatası / dosya reddi); sessiz başarı yoktur.
var errNotYet = errors.New("linux: bu yetenek henüz yok")

func notYet() error { return errNotYet }

// flowDeps Linux kod akışının bağımlılıkları (mimari-p28g §2; darwin kalıbı). Video VP8'dir (ADR-0038 m.3). K1'de
// bağlanmayan özellikler bildirilmez (flow.Features): kontrol (Input/Hotkey boş → izin verilemez, G-21; K3),
// roster/sunucu dosyası arayüzü (K4). Monitör/yakalama (K2) açık hata döner. Pano, yazdırma, ses, indirme dizini ve
// MOTW karşılığı K5'te bağlandı (linuxClipPrintVoice).
func flowDeps(cfg config.Config, fp string, client *api.Client, u flow.UI, events <-chan flow.Event,
	gate *control.Gate) flow.Deps {
	media, merr := rtc.NewMedia(rtc.VP8) // ana/düşük iz çifti (ADR-0035), Linux'ta VP8
	d := flow.Deps{
		Host: cfg.DisplayHost(), Version: cfg.Version, Fingerprint: fp,
		API: client,
		NewPeer: func(ice []signal.IceServer, caps []string, h rtc.Handlers) (flow.Peer, error) {
			if merr != nil {
				return nil, merr
			}
			return rtc.New(ice, caps, h, media)
		},
		Monitors:    func() ([]signal.Monitor, error) { return nil, notYet() },
		Capture:     func(int) (rtc.Source, error) { return nil, notYet() },
		DownloadDir: files.DownloadsDir, // K5: XDG_DOWNLOAD_DIR → ~/Downloads → $HOME (saf Go)
		MOTW:        files.ClearExec,    // K5 (T8): MOTW yok; 0644, yürütme biti yok, yoksa teslim edilmez
		Logo:        client.Logo,        // AC-98: yalnız gömülü sunucu kökeni, PNG/JPG ≤ 2 MB
		UI:          u,
		Events:      events,
		Gate:        gate,
		FileServer:  fsrv.New(cfg.ServerURL, client.HTTPClient(), cfg.Version),
	}
	if merr == nil {
		d.Media = media
	}
	// K4: teknisyen listesi + "Çıkar" (rs.cap.multi1; ses için de gerekir) ve sunucu dosyası durum satırı.
	if r, ok := u.(flow.RosterUI); ok {
		d.RosterUI = r
	}
	if fs, ok := u.(flow.FileServerUI); ok {
		d.FileServerUI = fs
	}
	linuxClipPrintVoice(&d, u) // K5: Features'tan ÖNCE
	features := flow.Features(d)
	d.Dial = func(ctx context.Context, cred signal.Credential) (flow.Conn, error) {
		return signal.Dial(ctx, client.HTTPClient(), cfg.ServerURL, cred, features)
	}
	return d
}

// linuxClipPrintVoice P28g K5 (AC-402): pano (GTK CLIPBOARD) ve yazdırma (lp, r4 PagesUnknown) yalnız arayüz
// ClipPrintUI'yi uyguluyorsa (pano izni korunan denetimdir); ses yalnız wazero derleyicisinin çalıştığı işlemcide
// (voice.Supported: amd64 + SSE4.1) ve arayüz VoiceUI'yi uyguluyorsa. Kurulamayan özellik bildirilmez (flow.Features).
func linuxClipPrintVoice(d *flow.Deps, u flow.UI) {
	if cp, ok := u.(flow.ClipPrintUI); ok {
		d.ClipPrintUI = cp
		d.Printer = clipprint.NewPrinter("") // Linux: lp, işleyici süreç yok (argüman kullanılmaz)
		if c, err := clipprint.NewClipboard(); err == nil {
			d.Clipboard = c
		}
	}
	if vu, ok := u.(flow.VoiceUI); ok && voice.Supported() {
		d.VoiceUI = vu
		d.OpenVoice = openVoice
	}
}

// openVoice yalnız yerel "Kabul et"ten sonra akışın goroutine'inde çağrılır: Opus (wasm) + pulse aygıtı + 20 ms döngü.
// Hata açıkça nil arayüzle döner (flow voice.end{device}). Linux'ta tanılama logu yazılmaz (§5.3).
func openVoice(onFail func(error)) (flow.VoiceCall, error) {
	c, err := voice.New(voice.OpenPulse, onFail)
	if err != nil {
		return nil, err
	}
	return c, nil
}
