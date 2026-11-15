//go:build windows

package ui

import (
	"context"
	"fmt"

	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/request"
	"remote-support/agent-win/internal/win"
)

// RequestHome ana ekran (AC-182, 183, 189, 190; mimari-e10 §8.2): logo, sunucudan gelen firma adı, kayıt satırı,
// dolandırıcılık uyarısı (AC-125), bilgi satırı, düğmeler (Tab sırası homeButtons), sunucu + sürüm + SHA-256 satırı
// (AC-133). Sunucu metinleri statik denetimde `SS_NOPREFIX` (f.label), request.Display'den süzülmüş gelir. Enter
// odaktaki düğmeyi çalıştırır (IsDialogMessage); pasif "Destek iste" hiçbir yoldan tetiklenmez.
func (u *UI) RequestHome(ctx context.Context, v request.HomeView) request.HomeAction {
	ch := make(chan request.HomeAction, 1)
	u.t.Do(func() {
		title := v.Tenant
		if title == "" {
			title = "Uzaktan destek"
		}
		f := u.t.newForm(appTitle+" — "+title, 540, 330, false)
		logo := v.Logo
		if logo == nil {
			logo = systemLogo()
		}
		f.picture(logo, 396, 8, 128, 56)
		f.label(title, 16, 10, 370, 32, fontBig)
		f.label(registeredText(v.Registered), 16, 46, 370, 20, fontNormal)
		f.danger(fraudText, 16, 72, 508, 36, fontNormal)
		f.danger(v.Notice, 16, 114, 508, 54, fontNormal)
		var focus *ctrl
		x := int32(16)
		widths := map[int]int32{idHomeSupport: 140, idHomeCode: 170, idHomeForget: 170, idHomeAbuse: 200}
		for i, b := range homeButtons(v) {
			if i == 3 { // ikinci satır: Kötüye kullanımı bildir
				x = 16
			}
			y := int32(176)
			if i == 3 {
				y = 214
			}
			c := f.button(b.text, b.id, x, y, widths[b.id], b.def)
			win.EnableWindow(c.h, b.enabled)
			if b.def {
				focus = c
			}
			x += widths[b.id] + 8
		}
		f.button("Kapat", idCancel, 434, 214, 90, false)
		if !v.Support {
			f.label(v.Hint, 16, 252, 508, 36, fontNormal) // AC-190 açıklaması
		}
		f.label(u.footer, 16, 300, 508, 20, fontNormal)
		done := func(a request.HomeAction) { f.destroy(); ch <- a }
		f.command = func(id, _ int) {
			switch id {
			case idHomeSupport, idOK:
				if v.Support {
					done(request.HomeSupport)
				}
			case idHomeCode:
				done(request.HomeCode)
			case idHomeForget:
				done(request.HomeForget)
			case idHomeAbuse:
				win.OpenMailto(v.AbuseEmail)
			case idCancel:
				done(request.HomeClose)
			}
		}
		f.close = func() { done(request.HomeClose) }
		f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
	})
	select {
	case a := <-ch:
		return a
	case <-ctx.Done():
		return request.HomeClose
	}
}

// FirmHome P20 firma listeli ana ekran (mimari-e11 §8d.3, AC-253/254): firma listesi (her satırda kayıt tarihi),
// başka kökenli kayıtlar ayrı başlık altında ve seçilemez, seçili firmayla "Destek iste", "Bu firmayı unut" (onay),
// "Bu bilgisayarı unut (tüm firmalar)" (onay), "Tepside çalıştır" / "Windows açılışında başlat" onay kutuları + açıklama.
// Satırlar yerel kayıttan, request.Display süzgecinden geçmiş gelir; statik metinler SS_NOPREFIX.
func (u *UI) FirmHome(ctx context.Context, v launch.FirmView) launch.FirmAction {
	ch := make(chan launch.FirmAction, 1)
	u.t.Do(func() {
		const width = 540
		y := int32(10)
		f := u.t.newForm(appTitle+" — Uzaktan destek", width, firmHomeHeight(v), false)
		f.picture(systemLogo(), 396, 8, 128, 56)
		f.label("Uzaktan destek", 16, y, 370, 32, fontBig)
		y = 46
		var list *ctrl
		if v.Single {
			f.label("Kayıtlı firma: "+v.Firms[0].Text, 16, y, 370, 36, fontNormal)
			y += 40
		} else {
			f.label(firmPick, 16, y, 370, 20, fontBold)
			y += 24
			lh := int32(firmListRows(v)*firmRowHeight + 8)
			list = f.add("LISTBOX", "", win.WS_TABSTOP|win.LBS_NOTIFY|win.WS_VSCROLL, win.WS_EX_CLIENTEDGE, idFirmList,
				16, y, 508, lh, fontNormal)
			for _, r := range v.Firms {
				win.SendMessageStr(list.h, win.LB_ADDSTRING, 0, r.Text)
			}
			win.SendMessage(list.h, win.LB_SETCURSEL, 0, 0)
			y += lh + 8
		}
		if n := othersLines(v); n > 0 {
			h := int32(n * 18)
			f.label(othersText(v), 16, y, 508, h, fontNormal)
			y += h + 8
		}
		f.danger(fraudText, 16, y, 508, 36, fontNormal)
		y += 40
		if v.Notice != "" {
			f.danger(v.Notice, 16, y, 508, 72, fontNormal)
			y += 76
		}
		var focus *ctrl
		x := int32(16)
		widths := map[int]int32{idHomeSupport: 140, idHomeCode: 170, idFirmForgetOne: 170, idHomeForget: 260}
		for i, b := range firmButtons(v) {
			if i == 3 {
				x, y = 16, y+38
			}
			c := f.button(b.text, b.id, x, y, widths[b.id], b.def)
			win.EnableWindow(c.h, b.enabled)
			if b.def {
				focus = c
			}
			x += widths[b.id] + 8
		}
		f.button("Kapat", idCancel, 434, y, 90, false)
		y += 42
		tray := f.add("BUTTON", "&Tepside çalıştır", win.WS_TABSTOP|win.BS_AUTOCHECKBOX, 0, idFirmTray, 16, y, 508, 24, fontNormal)
		y += 28
		var auto *ctrl
		if !v.Toggles.AutostartHidden {
			auto = f.add("BUTTON", "&Windows açılışında başlat", win.WS_TABSTOP|win.BS_AUTOCHECKBOX, 0, idFirmAutostart,
				16, y, 508, 24, fontNormal)
			y += 28
		}
		hint := f.label("", 16, y, 508, 36, fontNormal)
		y += 40
		if auto != nil {
			f.label(autostartInfo, 16, y, 508, 36, fontNormal)
			y += 40
		}
		f.label(u.footer, 16, y, 508, 20, fontNormal)
		apply := func(t launch.Toggles) {
			setChecked(tray, t.Tray)
			win.EnableWindow(tray.h, t.TrayEnabled)
			if auto != nil {
				setChecked(auto, t.Autostart)
				win.EnableWindow(auto.h, t.AutostartEnabled)
			}
			win.SetText(hint.h, t.Hint)
		}
		apply(v.Toggles)
		selected := func() int {
			if list == nil {
				return 0
			}
			return int(win.SendMessage(list.h, win.LB_GETCURSEL, 0, 0))
		}
		done := func(a launch.FirmAction) { f.destroy(); ch <- a }
		f.command = func(id, code int) {
			switch {
			case (id == idHomeSupport || id == idOK) && len(v.Firms) > 0,
				id == idFirmList && code == lbnDblClk:
				if i := selected(); i >= 0 && i < len(v.Firms) {
					done(launch.FirmAction{Kind: launch.FirmSupport, Index: i})
				}
			case id == idHomeCode:
				done(launch.FirmAction{Kind: launch.FirmCode})
			case id == idFirmForgetOne:
				i := selected()
				if i < 0 || i >= len(v.Firms) {
					return
				}
				if win.MessageBox(f.h, fmt.Sprintf(confirmForgetOne, v.Firms[i].Text), appTitle,
					win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2) == win.IDYES {
					done(launch.FirmAction{Kind: launch.FirmForgetOne, Index: i})
				}
			case id == idHomeForget:
				if win.MessageBox(f.h, confirmForgetAll, appTitle, win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2) == win.IDYES {
					done(launch.FirmAction{Kind: launch.FirmForgetAll})
				}
			case id == idFirmTray && v.SetTray != nil:
				apply(v.SetTray(checked(tray)))
			case id == idFirmAutostart && auto != nil && v.SetAutostart != nil:
				apply(v.SetAutostart(checked(auto)))
			case id == idCancel:
				done(launch.FirmAction{Kind: launch.FirmClose})
			}
		}
		f.close = func() { done(launch.FirmAction{Kind: launch.FirmClose}) }
		if focus == nil {
			focus = list
		}
		f.show(win.WorkAreaAt(win.CursorPos()), true, focus)
	})
	select {
	case a := <-ch:
		return a
	case <-ctx.Done():
		return launch.FirmAction{Kind: launch.FirmClose}
	}
}
