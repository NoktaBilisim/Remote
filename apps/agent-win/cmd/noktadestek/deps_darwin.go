//go:build darwin

package main

import (
	"context"
	"errors"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/fsrv"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// errNoDownloads indirme klasörü K5'te bağlanır; o zamana kadar dosya teklifleri otomatik reddedilir (flow.initFiles).
var errNoDownloads = errors.New("indirme klasörü bu sürümde yok")

// flowDeps macOS kod akışının bağımlılıkları (mimari-p28f §2). Bağlanmayan özellikler bildirilmez (flow.Features):
// kontrol (Hotkey/Input boş → izin verilemez, G-21; K3), pano/yazdırma (K5), ses (K5), roster/çoklu teknisyen ve sunucu
// dosyası arayüzü (K4), pencere paylaşımı (macOS'ta yok, AC-248).
func flowDeps(cfg config.Config, fp string, client *api.Client, u flow.UI, events <-chan flow.Event) flow.Deps {
	media, merr := rtc.NewMedia() // ana/düşük iz çifti (ADR-0035)
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
		DownloadDir: func() (string, error) { return "", errNoDownloads },
		MOTW:        files.WriteQuarantine,
		Logo:        client.Logo, // AC-98: yalnız gömülü sunucu kökeni, PNG/JPG ≤ 2 MB
		UI:          u,
		Events:      events,
		FileServer:  fsrv.New(cfg.ServerURL, client.HTTPClient(), cfg.Version),
	}
	if merr == nil {
		d.Media = media
	}
	features := flow.Features(d)
	d.Dial = func(ctx context.Context, cred signal.Credential) (flow.Conn, error) {
		return signal.Dial(ctx, client.HTTPClient(), cfg.ServerURL, cred, features)
	}
	return d
}
