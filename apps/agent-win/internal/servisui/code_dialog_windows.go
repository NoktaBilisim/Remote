//go:build windows

package servisui

import (
	"strings"
	"sync/atomic"

	"remote-support/agent-win/internal/servis"
	"remote-support/agent-win/internal/ui"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// Kurulum ve kaldırma arayüzü (mimari-p27 §5.3; AC-273, 274). `--install` (UAC ile yükseltilmiş süreç) kayıt kodunu
// tek alanlı iletişim kutusunda sorar; kutu kayıt ve kurulum boyunca açık kalır ("Kaydediliyor…"), hata metniyle
// yeniden sorar, kurulum bitince kapanır. Kod yalnız bu kutudan okunur (komut satırı/dosya yok) ve hiçbir yere
// yazılmaz. `--uninstall` onayı servis.UninstallConfirmText'tir; varsayılan düğme "Hayır".

const (
	mbIconInfo    = 0x40
	codeMaxLen    = 32
	waitOnlineTry = 20 // ≈ 10 sn
	textRegister  = "Kaydediliyor…"
	textStarting  = "Kuruldu — servis sunucuya bağlanıyor…"
)

type codeResult struct {
	code string
	ok   bool
}

// InstallDialog servis.InstallUI uygulaması (tek kurulum sürecinde tek örnek).
type InstallDialog struct {
	p    *ui.Panel
	res  chan codeResult
	busy atomic.Bool // kayıt sürüyor: düğmeler ve kapatma yok sayılır
	// Version config.Version: pencere başlığında uygulama adının yanında (uicore.VersionedTitle, 2026-11-18).
	Version string
}

// AskCode kayıt kodunu sorar; prev önceki denemenin hata metnidir. false: vazgeçildi.
func (d *InstallDialog) AskCode(prev string) (string, bool) {
	if d.p == nil || closedPanel(d.p) {
		if err := d.open(); err != nil {
			ui.ShowError(ErrElevateText)
			return "", false
		}
	}
	d.p.SetText(idCodeErr, prev)
	d.p.SetText(idCodeInfo, "")
	setBusy(d.p, false)
	d.busy.Store(false)
	r := <-d.res
	return r.code, r.ok
}

func (d *InstallDialog) open() error {
	d.res = make(chan codeResult, 1)
	send := func(p *ui.Panel, r codeResult) {
		select {
		case d.res <- r:
		default:
		}
		if !r.ok {
			p.Close()
		}
	}
	p, err := ui.OpenPanel(ui.PanelSpec{Title: uicore.VersionedTitle(Title, d.Version), W: 460, H: 236, Focus: idCode, Items: codeItems(),
		OnCommand: func(p *ui.Panel, id int) {
			switch {
			case d.busy.Load():
			case id == win.IDOK:
				d.busy.Store(true)
				setBusy(p, true)
				send(p, codeResult{code: strings.TrimSpace(p.Text(idCode)), ok: true})
			case id == win.IDCANCEL:
				send(p, codeResult{})
			}
		},
		OnClose: func(p *ui.Panel) {
			if !d.busy.Load() {
				send(p, codeResult{})
			}
		}})
	d.p = p
	return err
}

func codeItems() []ui.Item {
	return []ui.Item{
		{Kind: ui.ItemLogo, X: 16, Y: 16, W: 48, H: 48},
		{Kind: ui.ItemTitle, Text: CodeTitle, X: 76, Y: 16, W: 368, H: 24},
		{Kind: ui.ItemLabel, Text: CodePrompt, X: 76, Y: 44, W: 368, H: 40},
		{Kind: ui.ItemEdit, ID: idCode, X: 76, Y: 90, W: 220, H: 28, Limit: codeMaxLen},
		{Kind: ui.ItemLabel, ID: idCodeInfo, X: 76, Y: 124, W: 368, H: 20},
		{Kind: ui.ItemDanger, ID: idCodeErr, X: 16, Y: 148, W: 428, H: 36},
		{Kind: ui.ItemButton, ID: win.IDOK, Text: ButtonInstallNext, X: 258, Y: 192, W: 90, Default: true},
		{Kind: ui.ItemButton, ID: win.IDCANCEL, Text: ButtonCancel, X: 354, Y: 192, W: 90},
	}
}

// setBusy kayıt sürerken alanı ve düğmeleri pasifleştirir (yalnız görünüm; karar d.busy'dedir).
func setBusy(p *ui.Panel, on bool) {
	for _, id := range []int{idCode, win.IDOK, win.IDCANCEL} {
		p.Enable(id, !on)
	}
	if on {
		p.SetText(idCodeErr, "")
		p.SetText(idCodeInfo, textRegister)
	}
}

// ShowError kurulum hatası: iletişim kutusu kapanır, hata gösterilir.
func (d *InstallDialog) ShowError(msg string) {
	d.closePanel()
	ui.ShowError(msg)
}

// ShowDone kurulum/güncelleme bitti: servisin sunucuya bağlanması ≈ 10 sn beklenir, sonuç gösterilir (§5.3 adım 7).
func (d *InstallDialog) ShowDone(r servis.Registration) {
	if d.p != nil && !closedPanel(d.p) {
		d.p.SetText(idCodeInfo, textStarting)
	}
	text := DonePendingText
	if waitOnline(waitOnlineTry) {
		text = DoneOnlineText
	}
	d.closePanel()
	for _, l := range infoLines(Snapshot{TenantName: r.TenantName, CustomerName: r.CustomerName, DeviceID: r.DeviceID}) {
		text += "\n" + l
	}
	win.MessageBox(0, text, Title, win.MB_OK|mbIconInfo|win.MB_TOPMOST)
}

func (d *InstallDialog) closePanel() {
	if d.p != nil {
		d.p.Close()
		<-d.p.Done()
	}
}

func closedPanel(p *ui.Panel) bool {
	select {
	case <-p.Done():
		return true
	default:
		return false
	}
}

// UninstallDialog servis.UninstallUI uygulaması.
type UninstallDialog struct{}

// Confirm kaldırma onayı; varsayılan "Hayır".
func (UninstallDialog) Confirm() bool {
	return win.MessageBox(0, servis.UninstallConfirmText, Title,
		win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2|win.MB_TOPMOST) == win.IDYES
}

// ShowError kaldırma hatası.
func (UninstallDialog) ShowError(msg string) { ui.ShowError(msg) }
