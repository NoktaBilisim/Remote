//go:build windows

package ui

import (
	"remote-support/agent-win/internal/ui/uicore"
	"remote-support/agent-win/internal/win"
)

// AC-247: tema durumu UI iş parçacığındadır. Açık modda (veya yüksek karşıtlıkta) 0.10.x ile aynı sistem renkleri
// kullanılır ve hiçbir ek tema çağrısı yapılmaz; koyu modda renkler uicore/theme.go tablosundan, başlık çubuğu DWM ile,
// düğme/metin kutusu/liste görsel stilin koyu alt sınıfıyla boyanır. WM_SETTINGCHANGE "ImmersiveColorSet" (ve yüksek
// karşıtlık değişimi) açık pencereleri yeniden boyar.

type themeState struct {
	loaded bool
	dark   bool
	pal    uicore.Palette
	window uintptr // koyu fırçalar; açık modda 0 (sistem fırçası)
	field  uintptr
}

// Denetim türleri (tema alt sınıfı seçimi).
const (
	kindStatic = iota
	kindButton
	kindCheck
	kindEdit
	kindList
)

func ctrlKind(class string, style uint32) int {
	switch class {
	case "BUTTON":
		if s := style & 0xF; s == win.BS_CHECKBOX || s == win.BS_AUTOCHECKBOX || s == win.BS_AUTORADIOBUTTON { // AC-248, P28a
			return kindCheck
		}
		return kindButton
	case "EDIT":
		return kindEdit
	case "LISTBOX":
		return kindList
	}
	return kindStatic
}

func colorRef(c uicore.RGB) uint32 { return win.RGB(c.R, c.G, c.B) }

// loadTheme kayıt defterini ve yüksek karşıtlığı okur; tema değiştiyse true.
func (t *thread) loadTheme() bool {
	v, found := win.AppsUseLightTheme()
	dark := uicore.UseDark(v, found, win.HighContrast())
	if t.theme.loaded && t.theme.dark == dark {
		return false
	}
	for _, b := range []uintptr{t.theme.window, t.theme.field} {
		if b != 0 {
			win.DeleteObject(b)
		}
	}
	t.theme = themeState{loaded: true, dark: dark, pal: uicore.ThemePalette(dark)}
	if dark {
		t.theme.window = win.SolidBrush(colorRef(t.theme.pal.Window))
		t.theme.field = win.SolidBrush(colorRef(t.theme.pal.Field))
	}
	return true
}

// refreshTheme WM_SETTINGCHANGE: tema değiştiyse temalı formlar yeniden boyanır (logo zemini dahil).
func (t *thread) refreshTheme() {
	if !t.loadTheme() {
		return
	}
	for _, f := range t.forms {
		if !f.themed {
			continue
		}
		f.applyTheme()
		for _, c := range f.ctrls {
			if c.img != nil {
				f.setPicture(c)
			}
		}
		win.Redraw(f.h)
	}
}

func (t *thread) bgColor() uint32 {
	if t.theme.dark {
		return colorRef(t.theme.pal.Window)
	}
	return win.SysColor(win.COLOR_WINDOW)
}

func (t *thread) bgBrush() uintptr {
	if t.theme.dark {
		return t.theme.window
	}
	return win.SysColorBrush(win.COLOR_WINDOW)
}

// logoBg logo kutusu zemini: açıkta pencere rengi (0.10.x), koyuda açık logo zemini (DESIGN logo-surface).
func (t *thread) logoBg() uint32 {
	if t.theme.dark {
		return colorRef(t.theme.pal.LogoBg)
	}
	return win.SysColor(win.COLOR_WINDOW)
}

// ctlColorStatic etiket, onay kutusu ve salt okunur metin kutusu. Açıkta 0.10.x: yalnız uyarı satırı renklenir.
func (f *form) ctlColorStatic(dc, h uintptr) uintptr {
	t := f.t
	win.SetBkColor(dc, t.bgColor())
	if t.theme.dark {
		win.SetTextColor(dc, colorRef(t.theme.pal.Text))
	}
	for _, c := range f.ctrls {
		if c.h == h && c.colored {
			if t.theme.dark {
				win.SetTextColor(dc, colorRef(t.theme.pal.Danger))
			} else {
				win.SetTextColor(dc, c.color)
			}
		}
	}
	return t.bgBrush()
}

// ctlColorField düzenlenebilir metin kutusu ve liste (yalnız koyu modda; açıkta sistem varsayılanı).
func (f *form) ctlColorField(dc uintptr) (uintptr, bool) {
	t := f.t
	if !t.theme.dark {
		return 0, false
	}
	win.SetTextColor(dc, colorRef(t.theme.pal.FieldText))
	win.SetBkColor(dc, colorRef(t.theme.pal.Field))
	return t.theme.field, true
}

// eraseThemed koyu modda temalı formun zemini tablo rengiyle boyanır (sınıf fırçası sistem rengidir).
func (f *form) eraseThemed(dc uintptr) bool {
	if !f.themed || !f.t.theme.dark {
		return false
	}
	r := win.ClientRect(f.h)
	win.FillRect(dc, &r, f.t.theme.window)
	return true
}

// applyTheme başlık çubuğu ve denetim görsel stilleri. Açık modda yalnız daha önce koyu yapılanlar varsayılana döner.
func (f *form) applyTheme() {
	if !f.themed || f.h == 0 {
		return
	}
	dark := f.t.theme.dark
	if f.dark != dark {
		win.DarkTitleBar(f.h, dark)
		f.dark = dark
	}
	for _, c := range f.ctrls {
		if c.dark == dark {
			continue
		}
		c.dark = dark
		switch {
		case c.kind == kindCheck && dark:
			win.ClassicTheme(c.h) // görsel stilli onay kutusu metin rengini yok sayar
		case c.kind == kindButton && dark, c.kind == kindList && dark:
			win.SetWindowTheme(c.h, "DarkMode_Explorer")
		case c.kind == kindEdit && dark:
			win.SetWindowTheme(c.h, "DarkMode_CFD")
		case c.kind != kindStatic:
			win.SetWindowTheme(c.h, "")
		}
	}
}
