//go:build windows

package helper

import (
	"context"
	"os"
	"time"

	"golang.org/x/sys/windows"

	"remote-support/agent-win/internal/api"
	"remote-support/agent-win/internal/capture"
	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/desktop"
	"remote-support/agent-win/internal/env"
	"remote-support/agent-win/internal/files"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/input"
	"remote-support/agent-win/internal/rtc"
	"remote-support/agent-win/internal/servis/helperio"
	"remote-support/agent-win/internal/signal"
)

// dialTimeout `/ws/guest` el sıkışması üst süresi (bilet ömrü ≤ 300 sn; askıda kalan yardımcı servisi meşgul tutmasın).
const dialTimeout = 30 * time.Second

// Main `--helper` kipi (cmd/noktadestek-servis `runHelper`). Ölümcül hata yolu yalnız çıkış kodudur (pencere yok).
func Main(cfg config.Config) int {
	if code := verifyProcess(); code != 0 {
		return int(code)
	}
	br := helperio.NewReader(os.Stdin) // P28u §7.4: ilk satır girdi, sonraki satırlar komut (boru açık kalır)
	in, err := helperio.ReadInput(br)
	if err != nil {
		return int(helperio.ExitHelperFailed)
	}
	inc, incErr := openIncoming() // hata: dosya teklifleri otomatik reddedilir, oturum sürer
	if incErr == nil {
		defer inc.Close()
	} else {
		inc = nil
	}
	gate := desktop.NewGate()
	fd, applier := flowDeps(cfg, inc, gate)
	d := Deps{ShowIndicator: showIndicator, InputDesktop: desktop.InputName, Gate: gate, Resumed: applier.ReleaseAll,
		Flow: fd, Status: os.Stdout, Commands: br, Locker: newWinLocker()}
	return int(Run(context.Background(), d, in))
}

// flowDeps P20 istemcisinin yakalama/WebRTC/girdi/dosya paketleriyle akış bağımlılıkları (cmd/noktadestek flowDeps
// eşi; arayüz, kısayol, kayıt ve pencere modu yok). K6b: yakalama ve SendInput iş parçacıkları giriş masaüstüne bağlanır.
func flowDeps(cfg config.Config, inc *incoming, desk *desktop.Gate) (flow.Deps, *input.Applier) {
	client := api.New(cfg.ServerURL, cfg.Version)
	gate := &control.Gate{}
	applier := input.NewApplier(gate, newDeskInjector(desk, input.SendInputInjector{}), nil)
	opener := capture.Opener{Version: cfg.Version, Attach: attachCapture}
	media, merr := rtc.NewMedia() // P28c: ana/düşük iz çifti (ADR-0035)
	d := flow.Deps{
		Host: cfg.DisplayHost(), Version: cfg.Version,
		Dial: func(ctx context.Context, cred signal.Credential) (flow.Conn, error) {
			dctx, cancel := context.WithTimeout(ctx, dialTimeout)
			defer cancel()
			// P28a: onay gerektiren özellikler bildirilmez (O-P28a-4); P28c: multi1 bildirilir (gösterge adları, AC-364).
			return signal.Dial(dctx, client.HTTPClient(), cfg.ServerURL, cred, []string{signal.FeatureMulti})
		},
		NewPeer: func(ice []signal.IceServer, caps []string, h rtc.Handlers) (flow.Peer, error) {
			if merr != nil {
				return nil, merr
			}
			return rtc.New(ice, caps, h, media)
		},
		Monitors: capture.Monitors,
		Capture:  opener.Open,
		MOTW:     files.WriteMOTW,
		Gate:     gate,
		Input:    applier.Handle,
		SetInputMonitor: func(id int) {
			if r, ok := capture.MonitorRect(id); ok {
				applier.SetTarget(control.Rect{Left: r.Left, Top: r.Top, Right: r.Right, Bottom: r.Bottom}, input.VirtualScreen())
			}
		},
		EnvProbe:     env.Probe,
		SelfElevated: windows.GetCurrentProcessToken().IsElevated(),
	}
	d.DownloadDir, d.CheckDir = incomingDeps(inc)
	if merr == nil {
		d.Media = media
	}
	return d, applier
}

// incomingDeps `Gelen` yolu ve yazım denetimi; klasör doğrulanamadıysa DownloadDir hata verir (her teklif reddedilir).
func incomingDeps(inc *incoming) (func() (string, error), func() error) {
	if inc == nil {
		return func() (string, error) { return "", errRedirected }, func() error { return errRedirected }
	}
	return func() (string, error) { return inc.dir, nil }, inc.Check
}
