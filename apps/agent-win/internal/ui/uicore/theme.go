package uicore

// AC-247 (mimari-e11 §8.1): istemci pencereleri Windows "Uygulama modu"na uyar. Renkler bu tek tablodadır (açık/koyu
// çift); Win32 denetimleri theme_windows.go'da bu tablodan boyanır. Açık tablo 0.10.x görünümüdür (Windows varsayılan
// COLOR_WINDOW/COLOR_WINDOWTEXT ve 0.10.x tehlike kırmızısı); çalışırken açık modda pencere/metin rengi yine sistem
// renginden okunur (yüksek karşıtlık ve özel renk şemaları 0.10.x'teki gibi çalışır). Koyu değerler DESIGN.md §2
// koyu token'larıdır (surface, surface-muted, fg, danger, logo-surface).

// RGB sRGB renk.
type RGB struct{ R, G, B uint8 }

// Palette bir temanın renkleri.
type Palette struct {
	Window    RGB // form zemini, etiket zemini (DESIGN surface)
	Text      RGB // etiket ve onay kutusu metni (fg)
	Danger    RGB // uyarı satırları (danger)
	Field     RGB // metin kutusu ve liste zemini (surface-muted)
	FieldText RGB // metin kutusu ve liste metni (fg)
	LogoBg    RGB // logo kutusu zemini (logo-surface): siyah "nokta" yazısı koyu temada da okunur
}

var (
	paletteLight = Palette{
		Window: RGB{0xff, 0xff, 0xff}, Text: RGB{0x00, 0x00, 0x00}, Danger: RGB{185, 28, 28},
		Field: RGB{0xff, 0xff, 0xff}, FieldText: RGB{0x00, 0x00, 0x00}, LogoBg: RGB{0xff, 0xff, 0xff},
	}
	paletteDark = Palette{
		Window: RGB{0x15, 0x1b, 0x22}, Text: RGB{0xe6, 0xeb, 0xf0}, Danger: RGB{0xff, 0x8a, 0x80},
		Field: RGB{0x1d, 0x25, 0x2e}, FieldText: RGB{0xe6, 0xeb, 0xf0}, LogoBg: RGB{0xf5, 0xf7, 0xfa},
	}
)

// ThemePalette dark true ise koyu tablo.
func ThemePalette(dark bool) Palette {
	if dark {
		return paletteDark
	}
	return paletteLight
}

// UseDark AppsUseLightTheme değeri (found false: değer yok → açık) ve yüksek karşıtlık durumundan karar. Yüksek
// karşıtlık açıkken kullanıcının sistem renkleri korunur (koyu tablo uygulanmaz).
func UseDark(appsUseLight uint32, found, highContrast bool) bool {
	return found && appsUseLight == 0 && !highContrast
}

// IndicatorBg / IndicatorText AC-103 göstergesi ve P28a bildirim satırı (AC-346): temadan bağımsız (iki temada aynı
// kırmızı zemin, beyaz metin; AC-247 kontrast testi theme_test.go).
var IndicatorBg, IndicatorText = RGB{185, 28, 28}, RGB{0xff, 0xff, 0xff}
