//go:build linux

package main

import (
	"context"
	"errors"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/fsrv"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/signal"
)

// errNotYet K1 iskeleti: yeteneğin Linux uygulaması sonraki pakette (K2 yakalama, K5 dosya). Akış bunu mevcut hata
// yolundan işler (yakalama hatası / dosya reddi); sessiz başarı yoktur.
var errNotYet = errors.New("linux: bu yetenek henüz yok")

func notYet() error { return errNotYet }

// flowDeps Linux kod akışının bağımlılıkları (mimari-p28g §2; darwin kalıbı). Video VP8'dir (ADR-0038 m.3). K1'de
// bağlanmayan özellikler bildirilmez (flow.Features): kontrol (Input/Hotkey boş → izin verilemez, G-21; K3), pano ve
// yazdırma (K5), ses (K5), roster/sunucu dosyası arayüzü (K4). Monitör/yakalama (K2) ve indirme dizini/MOTW karşılığı
// (K5) açık hata döner.
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
		DownloadDir: func() (string, error) { return "", notYet() },
		MOTW:        func(string) error { return notYet() },
		Logo:        client.Logo, // AC-98: yalnız gömülü sunucu kökeni, PNG/JPG ≤ 2 MB
		UI:          u,
		Events:      events,
		Gate:        gate,
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
