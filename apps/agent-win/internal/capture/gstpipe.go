package capture

import (
	"errors"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"remote-support/agent-win/internal/signal"
)

// P28g K2 (mimari-p28g §4.4, §5.1 T6, §13 S-P28g-4, §14 m.3/m.4/m.9; ADR-0038 m.3): Linux GStreamer VP8 hattının
// platformdan bağımsız kısmı. Etiketsizdir: dizgi üretimi, öğe beyaz listesi, DISPLAY biçimi, VP8 anahtar kare biti,
// çözünürlük basamağı ve ölçülen bit hızı geri beslemesi her platformda birim testle sınanır. C'ye dokunan katman
// gst_linux.go'dadır.

// gstAllowed boru hattında adı geçebilecek tek öğe fabrikaları (T6 iki katman: bu dizgi şablonu testte, çalışan hattaki
// her öğe çalışma anında gst_bin_iterate_recurse ile aynı listeye karşı denetlenir). capsfilter, caps dizgilerinden doğar.
var gstAllowed = map[string]bool{
	"ximagesrc": true, "pipewiresrc": true, "videorate": true, "videoconvert": true, "videoscale": true, "tee": true,
	"queue": true, "valve": true, "vp8enc": true, "appsink": true, "capsfilter": true,
}

// displayRe S-P28g-4: DISPLAY yalnız ":N" ya da ":N.M" (yerel, ana makine adı yok). Uymazsa X11 yolu açılmaz.
var displayRe = regexp.MustCompile(`^:[0-9]{1,3}(\.[0-9]{1,2})?$`)

// ValidDisplay DISPLAY değeri X11 yakalamaya uygun mu.
func ValidDisplay(s string) bool { return displayRe.MatchString(s) }

// Hat sabitleri (K0s-3 vekil ölçümü).
const (
	gstFPS      = targetFPS
	vp8CPUUsed  = 8
	vp8Threads  = 4
	vp8KeyDist  = int(gopDuration/time.Second) * gstFPS // GOP 2 sn
	maxEdge     = 16384
	minOutEdge  = 16
	defaultEdge = 1280
)

// ladderEdges r2 §14 m.3: varsayılan uzun kenar 1280; ölçülen CPU'ya göre 1600 → 1920.
var ladderEdges = []int{1280, 1600, 1920}

// pipeSpec boru hattı girdileri; hepsi istemcinin ürettiği tamsayılardır (S-P28g-4).
type pipeSpec struct {
	Wayland bool
	// X11: kaynak dikdörtgen (kök pencere fiziksel pikseli, sağ/alt dahil değil).
	X, Y, W, H int
	// Wayland: PipeWire uzak bağlantı fd'si ve düğüm.
	FD   int
	Node uint32
	// Kodlanan boyut (çift), ana bit hızı, düşük akış boyutu.
	OutW, OutH int
	BPS        int
	LowW, LowH int
}

var errSpec = errors.New("capture: boru hattı girdisi sınır dışında")

func inRange(v, lo, hi int) bool { return v >= lo && v <= hi }

// validate tüm yer tutucular için sınırlar (dizgiye sınır dışı tamsayı girmez).
func (s pipeSpec) validate() error {
	ok := inRange(s.OutW, minOutEdge, maxEdge) && inRange(s.OutH, minOutEdge, maxEdge) && s.OutW%2 == 0 && s.OutH%2 == 0 &&
		inRange(s.LowW, minOutEdge, maxEdge) && inRange(s.LowH, minOutEdge, maxEdge) && s.LowW%2 == 0 && s.LowH%2 == 0 &&
		inRange(s.BPS, 100_000, 50_000_000)
	if s.Wayland {
		ok = ok && inRange(s.FD, 0, 1<<20) && s.Node > 0
	} else {
		ok = ok && inRange(s.X, -maxEdge, maxEdge) && inRange(s.Y, -maxEdge, maxEdge) && inRange(s.W, 1, maxEdge) &&
			inRange(s.H, 1, maxEdge)
	}
	if !ok {
		return errSpec
	}
	return nil
}

func itoa(v int) string { return strconv.Itoa(v) }

// buildPipeline sabit şablona yalnız tamsayı yerleştirir (§4.4; r2 §14 m.4: iki appsink async=false).
// ximagesrc'ye display-name yazılmaz (DISPLAY'i kendisi okur; açılışta ValidDisplay).
func buildPipeline(s pipeSpec) (string, error) {
	if err := s.validate(); err != nil {
		return "", err
	}
	var src string
	if s.Wayland {
		src = "pipewiresrc fd=" + itoa(s.FD) + " path=" + strconv.FormatUint(uint64(s.Node), 10) +
			" do-timestamp=true keepalive-time=1000"
	} else {
		src = "ximagesrc use-damage=false show-pointer=true startx=" + itoa(s.X) + " starty=" + itoa(s.Y) +
			" endx=" + itoa(s.X+s.W-1) + " endy=" + itoa(s.Y+s.H-1)
	}
	b := strings.Builder{}
	b.WriteString(src)
	b.WriteString(" ! videorate ! video/x-raw,framerate=" + itoa(gstFPS) + "/1 ! videoconvert ! videoscale" +
		" ! video/x-raw,format=I420,width=" + itoa(s.OutW) + ",height=" + itoa(s.OutH) + " ! tee name=t")
	b.WriteString(" t. ! queue leaky=downstream max-size-buffers=2 ! vp8enc name=main deadline=1 cpu-used=" + itoa(vp8CPUUsed) +
		" end-usage=cbr target-bitrate=" + itoa(s.BPS) + " keyframe-max-dist=" + itoa(vp8KeyDist) +
		" lag-in-frames=0 error-resilient=default threads=" + itoa(vp8Threads) +
		" ! appsink name=mainsink sync=false async=false max-buffers=2 drop=true")
	b.WriteString(" t. ! queue leaky=downstream max-size-buffers=1 ! valve name=lowvalve drop=true ! videorate" +
		" ! video/x-raw,framerate=" + itoa(signal.LowFPS) + "/1 ! videoscale ! video/x-raw,width=" + itoa(s.LowW) +
		",height=" + itoa(s.LowH) + " ! vp8enc name=low deadline=1 cpu-used=" + itoa(vp8CPUUsed) +
		" end-usage=cbr target-bitrate=" + itoa(signal.LowBPS) + " keyframe-max-dist=" + itoa(vp8KeyDist) +
		" lag-in-frames=0 ! appsink name=lowsink sync=false async=false max-buffers=2 drop=true")
	return b.String(), nil
}

// pipelineFactories dizgideki öğe fabrika adları (caps dizgileri → capsfilter; "t." başvurusu öğe değildir).
func pipelineFactories(desc string) []string {
	var out []string
	for _, part := range strings.Split(desc, "!") {
		f := strings.Fields(part)
		if len(f) == 0 {
			continue
		}
		if f[0] == "t." {
			f = f[1:]
		}
		if len(f) == 0 {
			continue
		}
		name := f[0]
		if strings.Contains(name, "/") {
			name = "capsfilter"
		}
		out = append(out, name)
	}
	return out
}

// factoriesAllowed her fabrika adı beyaz listede mi (boş liste ret).
func factoriesAllowed(names []string) bool {
	if len(names) == 0 {
		return false
	}
	for _, n := range names {
		if !gstAllowed[n] {
			return false
		}
	}
	return true
}

// vp8Key VP8 çerçeve etiketinin 0. biti 0 ise anahtar karedir (RFC 6386 §9.1; yapı ofseti okunmaz).
func vp8Key(data []byte) bool { return len(data) > 0 && data[0]&1 == 0 }

// fitEdge kaynak boyutunu uzun kenarı edge olacak biçimde küçültür (büyütmez), oranı korur, çift sayıya yuvarlar.
func fitEdge(w, h, edge int) (int, int) {
	long := max(w, h)
	if long <= edge {
		return even(w), even(h)
	}
	if w >= h {
		return even(edge), even(h * edge / w)
	}
	return even(w * edge / h), even(edge)
}

func even(v int) int { return max(minOutEdge, v&^1) }

// lowSize düşük akış (P28c, ≤ 8 FPS / 1 Mbit/s) ana boyutun yarısı (CPU bütçesi; K0s-3: 1920'de ölçüt kaldı).
func lowSize(w, h int) (int, int) { return even(w / 2), even(h / 2) }

// Basamak eşikleri (§14 m.3; VEKİL — gerçek amd64'te E-15 ile ölçülür).
const (
	ladderWindow  = 10 * time.Second
	ladderHold    = 30 * time.Second
	ladderUpCPU   = 0.40
	ladderDownCPU = 0.60
	// Kodlama süresi C geri çağrısı ya da yapı ofseti olmadan ölçülemez (ADR-0038 m.2); yerine çekilen ana kareler
	// arası süre kullanılır: kodlayıcı yetişemezse sızdıran kuyruk kare düşürür, aralık büyür. Yalnız akış sürekliyken
	// (pencerede ≥ ladderMinFrames kare) değerlendirilir; durağan ekranda (Wayland hasar güdümlü) atlanır.
	ladderUpGap     = 40 * time.Millisecond
	ladderDownGap   = 50 * time.Millisecond
	ladderMinFrames = 200
)

// ladder çözünürlük basamağı. top kaynağın uzun kenarından büyük olmayan en üst basamaktır.
type ladder struct {
	idx, top   int
	lastChange time.Time
}

func newLadder(srcW, srcH int, now time.Time) *ladder {
	long := max(srcW, srcH)
	top := 0
	for i, e := range ladderEdges {
		if e <= long {
			top = i
		}
	}
	return &ladder{top: top, lastChange: now}
}

// Edge geçerli uzun kenar.
func (l *ladder) Edge() int { return ladderEdges[l.idx] }

// Observe 10 sn'lik penceredeki süreç CPU'su (tek çekirdek oranı), çekilen kare sayısı ve kare aralığı p95. Basamak
// değiştiyse true (en çok ladderHold'da bir; yeniden kurulum anahtar kare ister).
func (l *ladder) Observe(now time.Time, cpu float64, frames int, gapP95 time.Duration) bool {
	if now.Sub(l.lastChange) < ladderHold {
		return false
	}
	steady := frames >= ladderMinFrames
	switch {
	case l.idx > 0 && (cpu > ladderDownCPU || (steady && gapP95 > ladderDownGap)):
		l.idx--
	case l.idx < l.top && cpu < ladderUpCPU && (!steady || gapP95 <= ladderUpGap):
		l.idx++
	default:
		return false
	}
	l.lastChange = now
	return true
}

// gapStats kare aralıkları penceresi.
type gapStats struct {
	gaps  []time.Duration
	last  time.Time
	start time.Time
}

func (g *gapStats) add(now time.Time) {
	if g.start.IsZero() {
		g.start = now
	}
	if !g.last.IsZero() {
		g.gaps = append(g.gaps, now.Sub(g.last))
	}
	g.last = now
}

// p95 aralıkların 95. yüzdeliği (sıralı kopya üzerinde).
func (g *gapStats) p95() time.Duration {
	if len(g.gaps) == 0 {
		return 0
	}
	s := append([]time.Duration(nil), g.gaps...)
	slices.Sort(s)
	return s[(len(s)-1)*95/100]
}

func (g *gapStats) reset(now time.Time) {
	g.gaps = g.gaps[:0]
	g.start = now
}

// Ölçülen bit hızı geri beslemesi (§14 m.9): karmaşık içerikte CBR hedefi aşılıyor. 1 sn pencerede appsink'ten alınan
// bayt ölçülür; aşım %20'yi geçerse kodlayıcı hedefi orantılı düşürülür; ölçüm nominalin altına inince hedef %10
// adımlarla nominale döner.
const (
	brWindow   = time.Second
	brOverPct  = 120
	brFloor    = 300_000
	brRecovPct = 110
)

type brCtl struct {
	nominal, target int
	bytes           int
	start           time.Time
}

func newBrCtl(nominal int, now time.Time) *brCtl {
	return &brCtl{nominal: nominal, target: nominal, start: now}
}

// Add bir kodlanmış kareyi sayar; pencere bittiyse yeni kodlayıcı hedefi ve true döner (değiştiyse).
func (b *brCtl) Add(n int, now time.Time) (int, bool) {
	b.bytes += n
	el := now.Sub(b.start)
	if el < brWindow {
		return b.target, false
	}
	measured := int(int64(b.bytes) * 8 * int64(time.Second) / int64(el))
	b.bytes, b.start = 0, now
	next := b.target
	switch {
	case measured*100 > b.nominal*brOverPct:
		next = max(brFloor, int(int64(b.target)*int64(b.nominal)/int64(measured)))
	case measured <= b.nominal && b.target < b.nominal:
		next = min(b.nominal, b.target*brRecovPct/100)
	}
	if next == b.target {
		return b.target, false
	}
	b.target = next
	return next, true
}
