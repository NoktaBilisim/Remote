//go:build windows || darwin || linux

package main

import (
	"context"
	"io"
	"runtime"
	"strings"
	"time"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/update"
)

// P29 K8 taşınabilir güncelleyici kablolaması (mimari-p29 §5.2). Platforma özgü olan yalnız SelfReplacer ve politika
// kaynağıdır (Windows kayıtları + ref); macOS/Linux'ta tenant bilinmez → auto.

// updateCloseTimeout çıkışta olay gönderimi + iptal için üst sınır (AC-107 closeDelay'in içinde kalır).
const updateCloseTimeout = 2 * time.Second

// newUpdater güncelleyiciyi kurar; ref müşteri dosyası ref'i ("" yok), policy nil → auto, notify tepsi balonu (nil olabilir).
func newUpdater(cfg config.Config, client *api.Client, rep update.SelfReplacer, ref string,
	policy func(context.Context) (update.Policy, []string, error), notify func(string) bool) *update.Portable {
	platform, arch := update.RunningIdentity(runtime.GOOS)
	ver, _ := update.ParseVersion(cfg.Version)
	origin := *cfg.ServerURL
	origin.Path, origin.RawQuery, origin.Fragment = "", "", ""
	return update.NewPortable(update.PortableDeps{
		Trust:   cfg.Update,
		Running: update.Running{Platform: platform, Arch: arch, Component: update.ComponentClient, Version: ver},
		Check: func(ctx context.Context) (*update.Offer, error) {
			o, err := client.CheckUpdate(ctx, platform, arch, ref)
			if err != nil || o == nil {
				return nil, err
			}
			return &update.Offer{Manifest: o.Manifest, Signature: o.Signature, Policy: o.Policy}, nil
		},
		Policy: policy,
		Send: func(ctx context.Context, keys []string, ev []update.Event) error {
			return client.SendUpdateEvents(ctx, platform, arch, keys, ev)
		},
		Download: func(ctx context.Context, m update.Manifest, dst io.Writer) error {
			return update.Download(ctx, update.DownloadRequest{Client: client.HTTPClient(), Origin: &origin,
				Path: update.ClientPath(platform), UserAgent: "NoktaDestek/" + cfg.Version, Manifest: m, Dst: dst})
		},
		Replacer: rep,
		Link:     origin.String() + "/",
		Notify:   notify,
	})
}

// withUpdateNotice son ekran metnine bekleyen güncelleme bilgisini ekler (Linux/macOS; flow dosyalarına dokunmadan).
// Son ekran yoksa bilgi tüketilmez.
func withUpdateNotice(m flow.Message, upd *update.Portable) flow.Message {
	if m == (flow.Message{}) {
		return m
	}
	if n := upd.Notice(); n != "" {
		m.Body = strings.TrimSpace(m.Body + "\n\n" + n)
	}
	return m
}
