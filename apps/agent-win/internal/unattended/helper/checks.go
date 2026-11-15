package helper

import "strings"

// Platformdan bağımsız denetim kuralları (Windows uygulamaları *_windows.go; Linux'ta birim testli).

// Ad sabitleri internal/servis ile aynıdır (test eşitliği denetler). Yardımcı internal/servis'i içe aktarmaz: servis
// paketi kaldırma için ShellExecute içerir (derleme sınırı, AC-341).
const (
	serviceName     = "NoktaDestekServis"
	dataDirName     = "NoktaDestek Servis"
	incomingDirName = "Gelen"
)

// allowedPrivileges yardımcının jetonunda bulunabilecek tek ayrıcalıklar (mimari-p27 §5.2 r2 m.1). K6b ölçümü ek
// ayrıcalık gerektirirse adıyla buraya eklenir ve gerekçesi implementation.md'ye yazılır.
var allowedPrivileges = []string{"SeChangeNotifyPrivilege"}

// onlyAllowed present'teki her öğe allowed içinde mi (jetonda listede olmayan ayrıcalık → helper_failed).
func onlyAllowed[T comparable](present, allowed []T) bool {
	for _, p := range present {
		ok := false
		for _, a := range allowed {
			if p == a {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

// samePath GetFinalPathNameByHandle sonucu (`\\?\C:\…`) beklenen yerel yolla aynı mı (büyük/küçük harf duyarsız).
// UNC/birim GUID biçimindeki sonuçlar (`\\?\UNC\…`, `\\?\Volume{…}`) hiçbir zaman eşleşmez.
func samePath(final, want string) bool {
	if !strings.HasPrefix(final, `\\?\`) || want == "" {
		return false
	}
	f := strings.TrimSuffix(strings.TrimPrefix(final, `\\?\`), `\`)
	w := strings.TrimSuffix(want, `\`)
	if len(f) < 3 || f[1] != ':' {
		return false
	}
	return strings.EqualFold(f, w)
}

// rect fiziksel ekran koordinatları.
type rect struct{ Left, Top, Right, Bottom int32 }

func (r rect) within(o rect) bool {
	return r.Left >= o.Left && r.Top >= o.Top && r.Right <= o.Right && r.Bottom <= o.Bottom && r.Right > r.Left &&
		r.Bottom > r.Top
}

// shown çizilmiş bir gösterge penceresinin ölçülen durumu.
type shown struct {
	Monitor int // monitör sırası (EnumDisplayMonitors)
	Label   bool
	Exists  bool // IsWindow
	Visible bool // IsWindowVisible
	Rect    rect // GetWindowRect
}

// verifyLayout §5.5: her monitörde en az bir etiket ve dört kenar çubuğu var, hepsi mevcut ∧ görünür ∧ konumu o
// monitörün sınırları içinde. Monitör yoksa doğrulanmış sayılmaz.
func verifyLayout(mons []rect, wins []shown) bool {
	if len(mons) == 0 {
		return false
	}
	labels, bars := make([]int, len(mons)), make([]int, len(mons))
	for _, w := range wins {
		if w.Monitor < 0 || w.Monitor >= len(mons) || !w.Exists || !w.Visible || !w.Rect.within(mons[w.Monitor]) {
			return false
		}
		if w.Label {
			labels[w.Monitor]++
		} else {
			bars[w.Monitor]++
		}
	}
	for i := range mons {
		if labels[i] < 1 || bars[i] < 4 {
			return false
		}
	}
	return true
}

// layout monitör için dört kenar çubuğu ve üst-orta etiketin konumları (b kenar kalınlığı, lw×lh etiket).
func layout(m rect, b, lw, lh int32) (bars [4]rect, label rect) {
	w := m.Right - m.Left
	bars = [4]rect{
		{m.Left, m.Top, m.Right, m.Top + b}, {m.Left, m.Bottom - b, m.Right, m.Bottom},
		{m.Left, m.Top, m.Left + b, m.Bottom}, {m.Right - b, m.Top, m.Right, m.Bottom},
	}
	lw = min(lw, w)
	x := m.Left + (w-lw)/2
	return bars, rect{x, m.Top, x + lw, m.Top + lh}
}

// labelWidth etiket genişliği: metin uzunluğuna göre (karakter başına ~8 px + kenar boşluğu), en az 460 px.
func labelWidth(text string, dpi int32) int32 {
	n := int32(len([]rune(text)))
	return max(460, n*8+48) * dpi / 96
}
