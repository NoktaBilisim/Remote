package ui

// AC-247 (mimari-e11 §8.1): istemci pencereleri Windows "Uygulama modu"na uyar. Renkler bu tek tablodadır (açık/koyu
// çift); Win32 denetimleri theme_windows.go'da bu tablodan boyanır. Açık tablo 0.10.x görünümüdür (Windows varsayılan
// COLOR_WINDOW/COLOR_WINDOWTEXT ve 0.10.x tehlike kırmızısı); çalışırken açık modda pencere/metin rengi yine sistem
// renginden okunur (yüksek karşıtlık ve özel renk şemaları 0.10.x'teki gibi çalışır). Koyu değerler DESIGN.md §2
// koyu token'larıdır (surface, surface-muted, fg, danger, logo-surface).

// rgb sRGB renk.
type rgb struct{ R, G, B uint8 }

// palette bir temanın renkleri.
type palette struct {
	Window    rgb // form zemini, etiket zemini (DESIGN surface)
	Text      rgb // etiket ve onay kutusu metni (fg)
	Danger    rgb // uyarı satırları (danger)
	Field     rgb // metin kutusu ve liste zemini (surface-muted)
	FieldText rgb // metin kutusu ve liste metni (fg)
	LogoBg    rgb // logo kutusu zemini (logo-surface): siyah "nokta" yazısı koyu temada da okunur
}

var (
	paletteLight = palette{
		Window: rgb{0xff, 0xff, 0xff}, Text: rgb{0x00, 0x00, 0x00}, Danger: rgb{185, 28, 28},
		Field: rgb{0xff, 0xff, 0xff}, FieldText: rgb{0x00, 0x00, 0x00}, LogoBg: rgb{0xff, 0xff, 0xff},
	}
	paletteDark = palette{
		Window: rgb{0x15, 0x1b, 0x22}, Text: rgb{0xe6, 0xeb, 0xf0}, Danger: rgb{0xff, 0x8a, 0x80},
		Field: rgb{0x1d, 0x25, 0x2e}, FieldText: rgb{0xe6, 0xeb, 0xf0}, LogoBg: rgb{0xf5, 0xf7, 0xfa},
	}
)

// themePalette dark true ise koyu tablo.
func themePalette(dark bool) palette {
	if dark {
		return paletteDark
	}
	return paletteLight
}

// useDark AppsUseLightTheme değeri (found false: değer yok → açık) ve yüksek karşıtlık durumundan karar. Yüksek
// karşıtlık açıkken kullanıcının sistem renkleri korunur (koyu tablo uygulanmaz).
func useDark(appsUseLight uint32, found, highContrast bool) bool {
	return found && appsUseLight == 0 && !highContrast
}
