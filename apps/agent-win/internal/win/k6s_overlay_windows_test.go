//go:build windows

package win

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// P28u K6s spike sorusu 4 (mimari-p28u §7.3 örtülme kuralı, O-P28u-1; sonuç docs/spike-p28u-k6s.md): onay diyaloğunu
// temsil eden WS_EX_TOPMOST taban pencerenin üstüne katmanlı (ve saydam) bir örtü açılır; (a) tabandan yukarı
// GetWindow(GW_HWNDPREV) zinciri örtüyü "görünür + dikdörtgeni kesen" olarak buluyor mu, (b) WindowFromPoint taban
// merkezinde tabanı mı örtüyü mü döndürüyor. Ölçümdür: işletim sistemi davranışı testi kırmızı yapmaz; satırlar t.Log
// ve GitHub Actions'ta $GITHUB_STEP_SUMMARY'ye yazılır. Örtü aynı süreçte, aynı iş parçacığındadır (saldırgan ayrı
// süreçtir; z-sırası ve WS_EX_TRANSPARENT isabet atlaması pencere yöneticisinde süreçten bağımsızdır — elle turda ayrıca
// doğrulanır).

const gwHwndPrev = 3 // GW_HWNDPREV

var (
	pPeekMessageW = user32.NewProc("PeekMessageW")
	k6sWndProc    = windows.NewCallback(func(h uintptr, msg uint32, w, l uintptr) uintptr {
		return DefWindowProc(h, msg, w, l)
	})
)

type k6sVariant struct {
	name  string
	ex    uint32
	alpha byte
}

func TestK6sOverlayZOrderAndWindowFromPoint(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := RegisterClass("NoktaK6sSpike", k6sWndProc, SysColorBrush(5)); err != nil {
		t.Skipf("pencere sınıfı kaydedilemedi (etkileşimsiz oturum?): %v", err)
	}
	// capture WGC duman testinin penceresinden (100,100 320×240) uzak, küçük; paralel paketlerin testlerini örtmesin.
	const x, y, w, h = 640, 440, 160, 100
	base := CreateWindow(WS_EX_TOPMOST|WS_EX_TOOLWINDOW, "NoktaK6sSpike", "K6s taban", WS_POPUP, x, y, w, h, 0, 0)
	if base == 0 {
		t.Skip("taban pencere açılamadı (etkileşimsiz oturum?)")
	}
	defer DestroyWindow(base)
	ShowWindow(base, SW_SHOWNOACTIVATE)
	SetWindowPos(base, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)
	k6sPump(100 * time.Millisecond)
	br, ok := WindowBounds(base)
	if !ok {
		t.Skip("taban pencere sınırları okunamadı")
	}
	report := k6sReporter(t, "P28u K6s soru 4 — örtü penceresi (GW_HWNDPREV / WindowFromPoint)")
	report(fmt.Sprintf("taban=%#x sınır=%v", base, br))

	variants := []k6sVariant{
		{"LAYERED|TRANSPARENT alfa 0", WS_EX_LAYERED | WS_EX_TRANSPARENT, 0},
		{"LAYERED|TRANSPARENT alfa 1", WS_EX_LAYERED | WS_EX_TRANSPARENT, 1},
		{"LAYERED|TRANSPARENT alfa 255", WS_EX_LAYERED | WS_EX_TRANSPARENT, 255},
		{"LAYERED|TRANSPARENT|NOACTIVATE|TOOLWINDOW alfa 1", WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, 1},
		{"yalnız LAYERED alfa 1 (saydam değil)", WS_EX_LAYERED, 1},
	}
	for _, v := range variants {
		ov := CreateWindow(WS_EX_TOPMOST|v.ex, "NoktaK6sSpike", "", WS_POPUP, x, y, w, h, 0, 0)
		if ov == 0 {
			report(v.name + ": örtü açılamadı")
			continue
		}
		SetLayered(ov, 0, v.alpha, LWA_ALPHA)
		ShowWindow(ov, SW_SHOWNOACTIVATE)
		SetWindowPos(ov, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)
		k6sPump(150 * time.Millisecond)
		found, others := k6sScanAbove(base, br, ov)
		at := RootAt(x+w/2, y+h/2)
		wfp := "belirsiz (başka pencere)"
		switch at {
		case base:
			wfp = "TABAN (örtü atlandı)"
		case ov:
			wfp = "ÖRTÜ"
		case 0:
			wfp = "yok (0)"
		}
		report(fmt.Sprintf("%s: exstyle=%#x görünür=%v GW_HWNDPREV örtüyü buldu=%v (diğer kesen=%d) WindowFromPoint=%s",
			v.name, ExStyle(ov), windows.IsWindowVisible(windows.HWND(ov)), found, others, wfp))
		DestroyWindow(ov)
		k6sPump(50 * time.Millisecond)
	}
}

// k6sScanAbove §7.3 (1) kuralının ham hâli: tabandan z-sırasında yukarı gezilir; görünür, sıfır olmayan alanlı ve
// taban dikdörtgenini kesen pencereler sayılır (katmanlı/saydam dahil). found = örtü bunlar arasında mı.
func k6sScanAbove(base uintptr, br RECT, ov uintptr) (found bool, others int) {
	h := base
	for i := 0; i < 4096; i++ {
		h, _, _ = pGetWindow.Call(h, gwHwndPrev)
		if h == 0 {
			break
		}
		if !windows.IsWindowVisible(windows.HWND(h)) {
			continue
		}
		r, ok := WindowBounds(h)
		if !ok || r.Right <= br.Left || r.Left >= br.Right || r.Bottom <= br.Top || r.Top >= br.Bottom {
			continue
		}
		if h == ov {
			found = true
		} else {
			others++
		}
	}
	return found, others
}

// k6sPump d süresince iş parçacığının ileti kuyruğunu boşaltır (PM_REMOVE).
func k6sPump(d time.Duration) {
	end := time.Now().Add(d)
	var m MSG
	for time.Now().Before(end) {
		for {
			r, _, _ := pPeekMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0, 1)
			if r == 0 {
				break
			}
			TranslateDispatch(&m)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// k6sReporter satırı t.Log'a yazar ve biriktirir; test bitince (varsa) GitHub step summary'ye tek yazışta ekler
// (paralel paketlerin tabloları iç içe geçmesin).
func k6sReporter(t *testing.T, title string) func(string) {
	t.Helper()
	var rows []string
	t.Cleanup(func() {
		path := os.Getenv("GITHUB_STEP_SUMMARY")
		if path == "" || len(rows) == 0 {
			return
		}
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
		if err != nil {
			return
		}
		defer f.Close()
		var b strings.Builder
		fmt.Fprintf(&b, "\n### %s\n\n| Sonuç |\n|---|\n", title)
		for _, r := range rows {
			fmt.Fprintf(&b, "| %s |\n", strings.ReplaceAll(r, "|", "/"))
		}
		_, _ = f.WriteString(b.String())
	})
	return func(row string) {
		t.Log(row)
		rows = append(rows, row)
	}
}
