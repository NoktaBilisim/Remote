package win

import (
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// AC-247: Windows uygulama modu (açık/koyu) ve koyu pencere/denetim görünümü için çağrılar.

var (
	uxtheme = windows.NewLazySystemDLL("uxtheme.dll")

	pSetWindowTheme        = uxtheme.NewProc("SetWindowTheme")
	pSystemParametersInfoW = user32.NewProc("SystemParametersInfoW")
	pRedrawWindow          = user32.NewProc("RedrawWindow")
)

const (
	WM_SETTINGCHANGE    = 0x001A
	WM_CTLCOLORLISTBOX  = 0x0134
	WM_CTLCOLORBTN      = 0x0135
	SPI_GETHIGHCONTRAST = 0x0042
	SPI_SETHIGHCONTRAST = 0x0043
	hcfHighContrastOn   = 0x1
	rdwInvalidate       = 0x0001
	rdwErase            = 0x0004
	rdwAllChildren      = 0x0080
	rdwFrame            = 0x0400
	dwmaDarkModeOld     = 19 // Windows 10 1809–1909 (belgelenmemiş eski değer)
	personalizeKey      = `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`
)

type highContrast struct {
	Size   uint32
	Flags  uint32
	Scheme *uint16
}

// AppsUseLightTheme HKCU\…\Themes\Personalize\AppsUseLightTheme; değer/anahtar yoksa found false.
func AppsUseLightTheme() (v uint32, found bool) {
	k, err := registry.OpenKey(registry.CURRENT_USER, personalizeKey, registry.QUERY_VALUE)
	if err != nil {
		return 0, false
	}
	defer k.Close()
	n, _, err := k.GetIntegerValue("AppsUseLightTheme")
	if err != nil {
		return 0, false
	}
	return uint32(n), true
}

// HighContrast yüksek karşıtlık teması açık mı (SPI_GETHIGHCONTRAST).
func HighContrast() bool {
	hc := highContrast{Size: uint32(unsafe.Sizeof(highContrast{}))}
	r, _, _ := pSystemParametersInfoW.Call(SPI_GETHIGHCONTRAST, uintptr(hc.Size), uintptr(unsafe.Pointer(&hc)), 0)
	return r != 0 && hc.Flags&hcfHighContrastOn != 0
}

// DarkTitleBar pencere başlığını koyu/açık yapar: DWMWA_USE_IMMERSIVE_DARK_MODE (20), olmazsa eski 19. Hata yok
// sayılır (Windows 10 1809 öncesi: başlık açık kalır).
func DarkTitleBar(h uintptr, dark bool) {
	v := int32(0)
	if dark {
		v = 1
	}
	if windows.DwmSetWindowAttribute(windows.HWND(h), windows.DWMWA_USE_IMMERSIVE_DARK_MODE, unsafe.Pointer(&v), 4) != nil {
		_ = windows.DwmSetWindowAttribute(windows.HWND(h), dwmaDarkModeOld, unsafe.Pointer(&v), 4)
	}
}

// SetWindowTheme denetime görsel stil alt sınıfı verir (ör. "DarkMode_Explorer"); app boşsa varsayılana döner.
// uxtheme yoksa/başarısızsa yok sayılır.
func SetWindowTheme(h uintptr, app string) {
	if pSetWindowTheme.Find() != nil {
		return
	}
	if app == "" {
		_, _, _ = pSetWindowTheme.Call(h, 0, 0)
		return
	}
	_, _, _ = pSetWindowTheme.Call(h, uintptr(unsafe.Pointer(Str(app))), 0)
}

// ClassicTheme denetimde görsel stili kapatır (SetWindowTheme(h, "", "")): klasik çizim WM_CTLCOLORSTATIC metin
// rengine uyar (koyu temada onay kutusu metni).
func ClassicTheme(h uintptr) {
	if pSetWindowTheme.Find() != nil {
		return
	}
	empty := Str(" ")
	_, _, _ = pSetWindowTheme.Call(h, uintptr(unsafe.Pointer(empty)), uintptr(unsafe.Pointer(empty)))
}

// SettingName WM_SETTINGCHANGE lParam'ındaki alan adı (ör. "ImmersiveColorSet"); yoksa "".
func SettingName(lp uintptr) string {
	p := *(**uint16)(unsafe.Pointer(&lp))
	if p == nil {
		return ""
	}
	return windows.UTF16PtrToString(p)
}

// Redraw pencereyi çerçeve ve alt denetimleriyle yeniden çizer (tema değişimi).
func Redraw(h uintptr) {
	_, _, _ = pRedrawWindow.Call(h, 0, 0, rdwInvalidate|rdwErase|rdwAllChildren|rdwFrame)
}
