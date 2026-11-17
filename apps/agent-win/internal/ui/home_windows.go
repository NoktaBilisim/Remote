//go:build windows

package ui

import (
	"context"
	"fmt"

	"remote-support/agent-win/internal/launch"
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// FirmHome istemcinin tek ana ekranı (mimari-e11 §8d.3, AC-253/254; tek ekran kararı 2026-11-15): her açılış yolu
// (dosya adı, firma dosyası, süresi dolmuş kod, tepsi) bu ekranı açar. Firma listesi (dosyanın firması üstte ve seçili,
// kayıtlı firmalarda kayıt tarihi), başka kökenli kayıtlar ayrı başlık altında ve seçilemez, seçili firmayla "Destek
// iste", "Bu firmayı unut" (onay; yalnız kayıtlı firmada), "Bu bilgisayarı unut (tüm firmalar)" (onay), "Tepside
// çalıştır" / "Windows açılışında başlat" onay kutuları + açıklama. Satır yoksa AC-190 açıklaması ve "Bağlantı kodum
// var" varsayılandır. Satırlar request.Display süzgecinden geçmiş gelir; statik metinler SS_NOPREFIX.
func (u *UI) FirmHome(ctx context.Context, v launch.FirmView) launch.FirmAction {
	ch := make(chan launch.FirmAction, 1)
	u.t.Do(func() {
		h := &firmHome{u: u, v: v, ch: ch}
		h.build()
	})
	return await(ctx, ch, launch.FirmAction{Kind: launch.FirmClose})
}

// firmHome ana ekran penceresi ve denetimleri (list: satır varsa; auto: Windows açılışı onay kutusu gizli değilse).
type firmHome struct {
	u         *UI
	v         launch.FirmView
	ch        chan<- launch.FirmAction
	f         *form
	list      *ctrl
	focus     *ctrl
	forgetOne *ctrl
	tray      *ctrl
	auto      *ctrl
	hint      *ctrl
}

func (h *firmHome) build() {
	const width = 540
	y := int32(10)
	f := h.u.t.newForm(appTitle+" — Uzaktan destek", width, firmHomeHeight(h.v), false)
	h.f = f
	f.picture(uicore.SystemLogo(), 396, 8, 128, 56)
	f.label("Uzaktan destek", 16, y, 370, 32, fontBig)
	y = h.addFirms(46)
	y = h.addNotes(y)
	y = h.addButtons(y)
	y = h.addToggles(y)
	f.label(h.u.footer, 16, y, 508, 20, fontNormal)
	h.apply(h.v.Toggles)
	f.command = h.command
	f.close = func() { h.done(launch.FirmAction{Kind: launch.FirmClose}) }
	if h.focus == nil {
		h.focus = h.list
	}
	f.show(win.WorkAreaAt(win.CursorPos()), true, h.focus)
}

// addFirms satır yoksa AC-190 açıklaması, varsa firma listesi (ilk satır seçili). Sonraki y'yi döner.
func (h *firmHome) addFirms(y int32) int32 {
	f, v := h.f, h.v
	if !listed(v) {
		f.label(singleText(v), 16, y, 370, 36, fontNormal)
		return y + 40
	}
	f.label(firmPick, 16, y, 370, 20, fontBold)
	y += 24
	lh := int32(firmListRows(v)*firmRowHeight + 8)
	h.list = f.add("LISTBOX", "", win.WS_TABSTOP|win.LBS_NOTIFY|win.WS_VSCROLL, win.WS_EX_CLIENTEDGE, idFirmList,
		16, y, 508, lh, fontNormal)
	for _, r := range v.Firms {
		win.SendMessageStr(h.list.h, win.LB_ADDSTRING, 0, r.Text)
	}
	win.SendMessage(h.list.h, win.LB_SETCURSEL, 0, 0)
	return y + lh + 8
}

// addNotes başka kökenli kayıtlar, dolandırıcılık uyarısı ve (varsa) bilgi satırı.
func (h *firmHome) addNotes(y int32) int32 {
	f, v := h.f, h.v
	if n := othersLines(v); n > 0 {
		lh := int32(n * 18)
		f.label(othersText(v), 16, y, 508, lh, fontNormal)
		y += lh + 8
	}
	f.danger(fraudText, 16, y, 508, 36, fontNormal)
	y += 40
	if v.Notice != "" {
		f.danger(v.Notice, 16, y, 508, 72, fontNormal)
		y += 76
	}
	return y
}

// addButtons firma düğmeleri (dördüncüden itibaren ikinci satır) ve "Kapat".
func (h *firmHome) addButtons(y int32) int32 {
	x := int32(16)
	widths := map[int]int32{idHomeSupport: 140, idHomeCode: 170, idFirmForgetOne: 170, idHomeForget: 260}
	for i, b := range firmButtons(h.v) {
		if i == 3 {
			x, y = 16, y+38
		}
		c := h.f.button(b.text, b.id, x, y, widths[b.id], b.def)
		win.EnableWindow(c.h, b.enabled)
		if b.def {
			h.focus = c
		}
		if b.id == idFirmForgetOne {
			h.forgetOne = c
		}
		x += widths[b.id] + 8
	}
	h.f.button("Kapat", idCancel, 434, y, 90, false)
	return y + 42
}

// addToggles "Tepside çalıştır", (gizli değilse) "Windows açılışında başlat", ipucu ve açılış açıklaması.
func (h *firmHome) addToggles(y int32) int32 {
	f := h.f
	h.tray = f.add("BUTTON", "&Tepside çalıştır", win.WS_TABSTOP|win.BS_AUTOCHECKBOX, 0, idFirmTray, 16, y, 508, 24, fontNormal)
	y += 28
	if !h.v.Toggles.AutostartHidden {
		h.auto = f.add("BUTTON", "&Windows açılışında başlat", win.WS_TABSTOP|win.BS_AUTOCHECKBOX, 0, idFirmAutostart,
			16, y, 508, 24, fontNormal)
		y += 28
	}
	h.hint = f.label("", 16, y, 508, 36, fontNormal)
	y += 40
	if h.auto != nil {
		f.label(autostartInfo, 16, y, 508, 36, fontNormal)
		y += 40
	}
	return y
}

func (h *firmHome) apply(t launch.Toggles) {
	setChecked(h.tray, t.Tray)
	win.EnableWindow(h.tray.h, t.TrayEnabled)
	if h.auto != nil {
		setChecked(h.auto, t.Autostart)
		win.EnableWindow(h.auto.h, t.AutostartEnabled)
	}
	win.SetText(h.hint.h, t.Hint)
}

func (h *firmHome) selected() int {
	if h.list == nil {
		return 0
	}
	return int(win.SendMessage(h.list.h, win.LB_GETCURSEL, 0, 0))
}

func (h *firmHome) done(a launch.FirmAction) { h.f.destroy(); h.ch <- a }

func (h *firmHome) command(id, code int) {
	v := h.v
	switch {
	case (id == idHomeSupport || id == idOK) && len(v.Firms) > 0,
		id == idFirmList && code == lbnDblClk:
		if i := h.selected(); i >= 0 && i < len(v.Firms) {
			h.done(launch.FirmAction{Kind: launch.FirmSupport, Index: i})
		}
	case id == idFirmList && code == lbnSelChange:
		win.EnableWindow(h.forgetOne.h, forgettable(v, h.selected()))
	case id == idHomeCode:
		h.done(launch.FirmAction{Kind: launch.FirmCode})
	case id == idFirmForgetOne:
		h.confirmForgetOne()
	case id == idHomeForget:
		h.confirmForgetAll()
	case id == idFirmTray, id == idFirmAutostart:
		h.toggle(id)
	case id == idCancel:
		h.done(launch.FirmAction{Kind: launch.FirmClose})
	}
}

// confirmForgetOne "Bu firmayı unut": yalnız kayıtlı seçili firmada, onaydan sonra.
func (h *firmHome) confirmForgetOne() {
	i := h.selected()
	if !forgettable(h.v, i) {
		return
	}
	if win.MessageBox(h.f.h, fmt.Sprintf(confirmForgetOne, h.v.Firms[i].Text), appTitle,
		win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2) == win.IDYES {
		h.done(launch.FirmAction{Kind: launch.FirmForgetOne, Index: i})
	}
}

// confirmForgetAll "Bu bilgisayarı unut (tüm firmalar)": onaydan sonra.
func (h *firmHome) confirmForgetAll() {
	if win.MessageBox(h.f.h, confirmForgetAll, appTitle, win.MB_YESNO|win.MB_ICONQUESTION|win.MB_DEFBUTTON2) == win.IDYES {
		h.done(launch.FirmAction{Kind: launch.FirmForgetAll})
	}
}

// toggle onay kutusu değişti: tercih kaydedilir, dönen durum (işaret, etkinlik, ipucu) uygulanır. Kaydetme işlevi
// yoksa (veya Windows açılışı kutusu gizliyse) yok sayılır.
func (h *firmHome) toggle(id int) {
	v := h.v
	switch {
	case id == idFirmTray && v.SetTray != nil:
		h.apply(v.SetTray(checked(h.tray)))
	case id == idFirmAutostart && h.auto != nil && v.SetAutostart != nil:
		h.apply(v.SetAutostart(checked(h.auto)))
	}
}
