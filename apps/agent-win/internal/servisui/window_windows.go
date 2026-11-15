//go:build windows

package servisui

import (
	"sync"
	"sync/atomic"

	"remote-support/agent-win/internal/config"
	"remote-support/agent-win/internal/servis"
	"remote-support/agent-win/internal/ui"
	"remote-support/agent-win/internal/win"
)

// Ayar penceresi (mimari-p27 §5.4; AC-274, 295, 338): logo, durum, açıklama, destek firması, müşteri, cihaz
// kimliğinin ilk 8 karakteri; düğmeler "Kur…" ya da "Gözetimsiz erişimi kapat / aç…", gerekiyorsa "Güncelle…",
// "Kaldır…". Açılış yolundan bağımsız tek ekrandır (argümansız açılış ve tepsi "Ayarlar…"). Durum 2 sn'de bir
// iş parçacığı dışında okunur; "Kapalı" HKLM'den gelir.

// Denetim kimlikleri.
const (
	idStatus    = 10
	idDetail    = 11
	idLine0     = 12 // idLine0..idLine0+2: firma, müşteri, cihaz
	idError     = 15
	idPrimary   = 20
	idUpdate    = 21
	idUninstall = 22
	idCode      = 30
	idCodeInfo  = 31
	idCodeErr   = 32

	windowPollMS = 2000
)

// Run main.go `runUI` kancası: `--tray` tepsi, diğer her şey ayar penceresi.
func Run(mode servis.Mode, cfg config.Config) int {
	if mode == servis.ModeTray {
		return runTray(cfg.Version)
	}
	w, err := openWindow(cfg.Version, true)
	if err != nil {
		ui.ShowError(ErrElevateText)
		return 1
	}
	<-w.p.Done()
	return 0
}

type window struct {
	p          *ui.Panel
	version    string
	standalone bool // tepsi sürecinde değil: kurulum sonrası tepsiyi başlatır
	busy       atomic.Bool

	mu        sync.Mutex
	last      Snapshot
	view      View
	trayStart bool
}

func openWindow(version string, standalone bool) (*window, error) {
	w := &window{version: version, standalone: standalone}
	p, err := ui.OpenPanel(ui.PanelSpec{Title: Title, W: 480, H: 276, Items: windowItems(),
		OnCommand: w.command, TimerMS: windowPollMS, OnTimer: w.refresh})
	if err != nil {
		return nil, err
	}
	w.p = p
	w.refresh(p)
	return w, nil
}

func windowItems() []ui.Item {
	return []ui.Item{
		{Kind: ui.ItemLogo, X: 16, Y: 16, W: 48, H: 48},
		{Kind: ui.ItemLabel, Text: "Gözetimsiz erişim", X: 76, Y: 16, W: 388, H: 20},
		{Kind: ui.ItemTitle, ID: idStatus, X: 76, Y: 38, W: 388, H: 24},
		{Kind: ui.ItemLabel, ID: idDetail, X: 16, Y: 76, W: 448, H: 36},
		{Kind: ui.ItemLabel, ID: idLine0, X: 16, Y: 116, W: 448, H: 20},
		{Kind: ui.ItemLabel, ID: idLine0 + 1, X: 16, Y: 138, W: 448, H: 20},
		{Kind: ui.ItemLabel, ID: idLine0 + 2, X: 16, Y: 160, W: 448, H: 20},
		{Kind: ui.ItemDanger, ID: idError, X: 16, Y: 186, W: 448, H: 36},
		{Kind: ui.ItemButton, ID: idPrimary, Text: ButtonInstall, X: 16, Y: 230, W: 220, Default: true},
		{Kind: ui.ItemButton, ID: idUpdate, Text: ButtonUpdate, X: 244, Y: 230, W: 104},
		{Kind: ui.ItemButton, ID: idUninstall, Text: ButtonUninstall, X: 356, Y: 230, W: 108},
	}
}

// refresh durumu iş parçacığı dışında okur; önceki okuma sürüyorsa atlanır.
func (w *window) refresh(p *ui.Panel) {
	if !w.busy.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer w.busy.Store(false)
		w.mu.Lock()
		prev := w.last
		w.mu.Unlock()
		s := Merge(prev, readSnapshot(w.version))
		w.apply(p, prev, s)
	}()
}

func (w *window) apply(p *ui.Panel, prev, s Snapshot) {
	v := Compute(s)
	w.mu.Lock()
	w.last, w.view = s, v
	startTrayNow := w.standalone && !prev.Installed && s.Installed && !w.trayStart
	if startTrayNow {
		w.trayStart = true
	}
	w.mu.Unlock()
	if prev.Installed && !s.Installed && s.SelfIsInstalled {
		p.Close() // kaldırıldı: kurulu ikili silinecek, pencere onu kilitlemesin
		return
	}
	if startTrayNow {
		startTray()
	}
	render(p, v)
}

func render(p *ui.Panel, v View) {
	p.SetText(idStatus, v.StatusText)
	p.SetText(idDetail, v.Detail)
	for i := 0; i < 3; i++ {
		line := ""
		if i < len(v.Lines) {
			line = v.Lines[i]
		}
		p.SetText(idLine0+i, line)
	}
	p.SetText(idPrimary, v.PrimaryText)
	p.Show(idPrimary, v.Primary != ActNone)
	p.Show(idUpdate, v.Update)
	p.Show(idUninstall, v.CanUninstall)
}

// command UI iş parçacığında; bekleyebilecek her iş (boru, UAC) ayrı goroutine'dedir.
func (w *window) command(p *ui.Panel, id int) {
	w.mu.Lock()
	act := w.view.Primary
	w.mu.Unlock()
	switch id {
	case win.IDCANCEL:
		p.Close()
	case idPrimary:
		w.primary(p, act)
	case idUpdate:
		w.run(p, "--install")
	case idUninstall:
		w.run(p, "--uninstall")
	}
}

func (w *window) primary(p *ui.Panel, act Action) {
	switch act {
	case ActInstall, ActUpdate:
		w.run(p, "--install")
	case ActEnable:
		w.run(p, "--enable")
	case ActDisable:
		p.Enable(idPrimary, false)
		go func() {
			msg := disableLocal()
			p.SetText(idError, msg)
			p.Enable(idPrimary, true)
			w.refresh(p)
		}()
	}
}

// run UAC ile yükseltilmiş kipi başlatır; sonuç durum yoklamasıyla pencereye yansır.
func (w *window) run(p *ui.Panel, arg string) {
	owner := p.Handle()
	go func() {
		if _, err := elevate(owner, arg); err != nil {
			p.SetText(idError, ErrElevateText)
			return
		}
		p.SetText(idError, "")
	}()
}
