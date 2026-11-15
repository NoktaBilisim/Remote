package ui

import "strings"

// AC-248 (P17 I4): paylaşım ekranındaki "Yalnız bir pencere" listesi. Süzgeç (mimari-e11 §8.1): görünür, araç
// penceresi değil, kendi pencerelerimiz (istemci süreci: oturum, gösterge, işaretleme katmanı) hariç; ayrıca DWM
// tarafından gizlenmiş (başka sanal masaüstü / askıdaki UWP) ve başlıksız pencereler gösterilmez. Başlık yalnız
// müşterinin ekranında görünür; ağa ve loga gitmez. Kabuk pencereleri (masaüstü "Program Manager", görev çubukları)
// listelenmez (S-P17-4): seçilirse "yalnız bir pencere" fiilen masaüstü simgeleri/Başlat olur ve uygulama başlatılabilir.

// windowCandidate EnumWindows'tan gelen üst düzey pencere.
type windowCandidate struct {
	HWND    uintptr
	Title   string
	PID     uint32
	Visible bool
	Tool    bool
	Cloaked bool
	Iconic  bool
	Class   string // pencere sınıfı (kabuk pencerelerini ayıklamak için; gösterilmez)
}

// shellClasses kabuk penceresi sınıfları (S-P17-4): masaüstü (Progman, WorkerW), birincil/ikincil görev çubuğu.
var shellClasses = map[string]bool{"Progman": true, "WorkerW": true, "Shell_TrayWnd": true, "Shell_SecondaryTrayWnd": true}

// shareWindow listede gösterilen pencere.
type shareWindow struct {
	HWND  uintptr
	Label string
}

const (
	shareWindowsMax = 64 // liste üst sınırı (Z sırasıyla üstteki pencereler önce)
	shareTitleMax   = 70 // görünen başlık uzunluğu (rune)
)

// shareableWindows süzgeci uygular; sıra korunur (üstteki önce). Simge durumundakiler "(simge durumunda)" ekiyle
// listelenir (paylaşılabilir; kaplama gösterilir).
func shareableWindows(all []windowCandidate, selfPID uint32) []shareWindow {
	var out []shareWindow
	for _, w := range all {
		title := strings.Join(strings.Fields(w.Title), " ")
		if w.HWND == 0 || !w.Visible || w.Tool || w.Cloaked || title == "" || w.PID == selfPID ||
			shellClasses[w.Class] {
			continue
		}
		if r := []rune(title); len(r) > shareTitleMax {
			title = string(r[:shareTitleMax-1]) + "…"
		}
		if w.Iconic {
			title += " (simge durumunda)"
		}
		out = append(out, shareWindow{HWND: w.HWND, Label: title})
		if len(out) == shareWindowsMax {
			break
		}
	}
	return out
}
