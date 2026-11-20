//go:build windows

package ui

import (
	"context"

	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/win"
)

// P8b-2 talep modu ekranları (request.UI). Sunucudan gelen tüm metinler (firma adı, teknisyen adı, ret mesajı) statik
// metin denetimiyle `SS_NOPREFIX` gösterilir (f.label); bağlantıya çevrilmez (G-E9-12, T38). Bu metinler request
// paketinde request.Display ile Cc/Cf/bidi karakterlerinden süzülmüş gelir (S8b2-3).

const (
	idReqName     = 60
	idReqPhone    = 61
	idReqEmail    = 62
	idReqDesc     = 63
	idReqConsent  = 64
	idReqRemember = 65
	idReqForget   = 66
	idReqCode     = 67
	idReqDownload = 68
)

// RequestEvents bekleme/onay ekranı eylemleri (request.Deps.Events).
func (u *UI) RequestEvents() <-chan request.UserAction { return u.reqEvents }

func (u *UI) reqEmit(a request.UserAction) {
	select {
	case u.reqEvents <- a:
	default:
	}
}

// OpenURL yalnız request.DownloadURL'in ürettiği https adresi (win.OpenURL ayrıca denetler).
func (u *UI) OpenURL(s string) { win.OpenURL(s) }

func checked(c *ctrl) bool { return win.SendMessage(c.h, win.BM_GETCHECK, 0, 0) == 1 }

func setChecked(c *ctrl, on bool) {
	v := uintptr(0)
	if on {
		v = 1
	}
	win.SendMessage(c.h, win.BM_SETCHECK, v, 0)
}

// RequestProblem AC-133: ağ/TLS hatası (ayrı metin + "Tekrar dene"), geçersiz dosya, eski sürüm.
func (u *UI) RequestProblem(ctx context.Context, p request.Problem) request.ProblemAction {
	ch := make(chan request.ProblemAction, 1)
	u.t.Do(func() {
		f := u.t.newForm(appTitle, 480, 220, false)
		f.label(p.Title, 16, 16, 448, 24, fontBold)
		f.label(p.Body, 16, 48, 448, 72, fontNormal)
		focus := problemButtons(f, p)
		f.button("Kapat", idCancel, 374, 132, 90, focus == nil)
		f.label(u.footer, 16, 184, 448, 20, fontNormal)
		done := func(a request.ProblemAction) { f.destroy(); ch <- a }
		f.command = func(id, _ int) {
			switch id {
			case idReqDownload:
				done(request.ProblemDownload)
			case idOK:
				done(request.ProblemRetry)
			case idReqCode:
				done(request.ProblemCodeMode)
			case idCancel:
				done(request.ProblemClose)
			}
		}
		f.close = func() { done(request.ProblemClose) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
	})
	return await(ctx, ch, request.ProblemClose)
}

// problemButtons sorunun izin verdiği düğmeler soldan sağa; ilki varsayılan ve odakta (yoksa nil: "Kapat" varsayılan).
func problemButtons(f *form, p request.Problem) *ctrl {
	x := int32(16)
	var focus *ctrl
	add := func(text string, id int, w int32) {
		c := f.button(text, id, x, 132, w, focus == nil)
		if focus == nil {
			focus = c
		}
		x += w + 8
	}
	if p.Download {
		add("Yeni sürümü indir", idReqDownload, 150)
	}
	if p.Retry {
		add("Tekrar dene", idOK, 110)
	}
	if p.CodeMode {
		add("Bağlantı kodum var", idReqCode, 180)
	}
	return focus
}

// RequestClosed süre dolumu (AC-142 "Yeniden talep oluştur"), ret (AC-157 "Firmanızın mesajı:" düz metin), iptal.
func (u *UI) RequestClosed(ctx context.Context, v request.ClosedView) request.ClosedAction {
	ch := make(chan request.ClosedAction, 1)
	u.t.Do(func() {
		h := int32(170)
		if v.FirmMessage != "" {
			h += 84
		}
		f := u.t.newForm(appTitle, 460, h, false)
		f.label(v.Title, 16, 16, 428, 24, fontBold)
		f.label(v.Body, 16, 46, 428, 56, fontNormal)
		y := int32(110)
		if v.FirmMessage != "" {
			f.label("Firmanızın mesajı:", 16, y, 428, 20, fontBold)
			f.label(v.FirmMessage, 16, y+22, 428, 56, fontNormal) // SS_NOPREFIX statik metin, bağlantı değil
			y += 84
		}
		var focus *ctrl
		if v.Recreate {
			focus = f.button("Yeniden talep oluştur", idOK, 16, y+10, 180, true)
		}
		c := f.button("Kapat", idCancel, 354, y+10, 90, focus == nil)
		if focus == nil {
			focus = c
		}
		done := func(a request.ClosedAction) { f.destroy(); ch <- a }
		f.command = func(id, _ int) {
			switch {
			case id == idOK && v.Recreate:
				done(request.ClosedRecreate)
			case id == idCancel:
				done(request.ClosedClose)
			}
		}
		f.close = func() { done(request.ClosedClose) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
		win.FlashWindow(f.h)
	})
	return await(ctx, ch, request.ClosedClose)
}
