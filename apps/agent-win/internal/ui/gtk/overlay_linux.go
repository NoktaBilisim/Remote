//go:build linux

package gtk

import (
	"math"
	"time"

	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/linux/x11"
	"remote-support/agent-win/internal/signal"
	"remote-support/agent-win/internal/ui/uicore"
)

// Gösterge (AC-103) + işaretleme katmanı (AC-37/56), §2.1 overlay satırı: her monitörde monitör boyutunda
// GTK_WINDOW_POPUP (override-redirect; pencere yöneticisi küçültemez/gizleyemez), RGBA görsel, boş giriş şekli
// (tıklama geçer). Kırmızı kenarlık + üst ortada metin satırları (gösterge, bildirim, kayıt, mikrofon) cairo ile
// çizilir (GtkLabel yok → kullanıcı CSS'i dokunamaz). 1 sn tik: gdk_window_raise + görünürlük denetimi; RGBA görsel
// ya da bileştirici yoksa ya da 3 tikte görünür kılınamazsa kapı kapanır (fail-closed). Yakalamadan hariç tutma yoktur
// (§5.4: çizim videoya girer). Wayland'de (XWayland) en iyi çaba (AC-400).
// S-P28g-8 (K10): X11'de tikte öne almanın hemen ardından GDK'nın kendi bağlantısında XQueryTree ile kök yığın sırası
// denetlenir (indicatorOnTop): göstergemizin üstünde başka pencere varsa ya da sıra okunamazsa o tik görünmez sayılır;
// bir sonraki tik yeniden yükseltir, 3 tikte olmazsa kapı kapanır. Bileştiricinin örtü penceresi (sunucu XID'i) sayılmaz.
// Wayland'de (XWayland) yığın ölçülemez (yerel Wayland pencereleri XQueryTree'de yok; AC-400, kılavuz) → yalnız
// eşlenmiş/görüntülenebilir denetimi.

type overlay struct {
	win, area uintptr
	geo       rect
	mon       uintptr
}

type indicator struct {
	list     []*overlay
	text     string
	noteText string
	noteGen  int
	rec      bool
	voice    string
	shared   signal.Monitor
	strokes  []uicore.Stroke
	laser    *[2]float64
	laserGen int
	broken   bool // RGBA görsel/bileştirici/giriş şekli yok → kalıcı sağlıksız
}

const indBorder = 5

func newIndicator(u *UI, text string, shared signal.Monitor) *indicator {
	ind := &indicator{text: text, shared: shared}
	ind.sync(u)
	return ind
}

// monitors GDK monitör geometrileri (mantıksal piksel, kök koordinatı).
func monitors() []struct {
	g rect
	m uintptr
} {
	d := gdkDisplayGetDefault()
	n := gdkDisplayGetNMonitors(d)
	out := make([]struct {
		g rect
		m uintptr
	}, 0, n)
	for i := range n {
		m := gdkDisplayGetMonitor(d, i)
		var g [4]int32
		gdkMonitorGetGeometry(m, &g)
		out = append(out, struct {
			g rect
			m uintptr
		}{rect{int(g[0]), int(g[1]), int(g[2]), int(g[3])}, m})
	}
	return out
}

// sync her monitörde bir pencere (monitör kümesi değiştiyse yeniden kurulur).
func (ind *indicator) sync(u *UI) {
	ms := monitors()
	same := len(ms) == len(ind.list)
	for i := 0; same && i < len(ms); i++ {
		same = ms[i].g == ind.list[i].geo
	}
	if same && len(ind.list) > 0 {
		return
	}
	ind.closeWins()
	scr := gdkScreenGetDefault()
	visual := gdkScreenGetRGBAVisual(scr)
	ind.broken = visual == 0 || !gdkScreenIsComposited(scr)
	if ind.broken {
		return // ARGB tam ekran pencere bileştiricisiz ekranı karartır: hiç kurulmaz, kapı kapanır
	}
	for _, m := range ms {
		o := &overlay{geo: m.g, mon: m.m, win: gtkWindowNew(gtkWindowPopup)}
		gtkWidgetSetVisual(o.win, visual)
		gtkWidgetSetAppPaintable(o.win, true)
		gtkWindowSetAcceptFocus(o.win, false)
		gtkWindowSetSkipTaskbar(o.win, true)
		gtkWindowSetSkipPager(o.win, true)
		gtkWindowMove(o.win, int32(m.g.X), int32(m.g.Y))
		gtkWindowResize(o.win, int32(m.g.W), int32(m.g.H))
		o.area = gtkDrawingAreaNew()
		gtkContainerAdd(o.win, o.area)
		onEvent(o.area, sigDraw, func(cr uintptr) bool { ind.draw(o, cr); return true })
		gtkWidgetShowAll(o.win)
		region := cairoRegionCreate() // boş bölge: giriş şekli yok → tıklama geçer
		gtkWidgetInputShape(o.win, region)
		cairoRegionDestroy(region)
		ind.list = append(ind.list, o)
	}
}

func (ind *indicator) closeWins() {
	for _, o := range ind.list {
		gtkWidgetDestroy(o.win)
	}
	ind.list = nil
}

func (ind *indicator) close() { ind.closeWins() }

// visible her monitördeki gösterge penceresi eşlenmiş ve görüntülenebilir mi.
func (ind *indicator) visible() bool {
	if ind.broken || len(ind.list) == 0 {
		return false
	}
	for _, o := range ind.list {
		gw := gtkWidgetGetWindow(o.win)
		if gw == 0 || !gtkWidgetGetMapped(o.win) || !gdkWindowIsViewable(gw) {
			return false
		}
	}
	return true
}

// indicatorTick: monitör değişimi, öne alma, denetim; 3 ardışık başarısız tikte kapı kapanır.
func (u *UI) indicatorTick() {
	u.ind.sync(u)
	for _, o := range u.ind.list {
		if gw := gtkWidgetGetWindow(o.win); gw != 0 {
			gdkWindowRaise(gw)
		}
	}
	if u.health.Observe(u.indicatorShown()) {
		u.failClosed()
	}
}

// indicatorShown gösterge şu an görünür mü: eşlenmiş/görüntülenebilir ve X11'de kök yığının en üstünde (S-P28g-8).
// Hem tik hem kontrol izni koruması (D-P28g-K2-2: anlık) bunu kullanır. Ana iş parçacığında.
func (u *UI) indicatorShown() bool {
	if u.ind == nil || !u.ind.visible() {
		return false
	}
	if u.wayland {
		return true // XWayland: yığın ölçülemez (en iyi çaba)
	}
	ours := make([]uint64, 0, len(u.ind.list))
	for _, o := range u.ind.list {
		ours = append(ours, gdkX11WindowGetXID(gtkWidgetGetWindow(o.win)))
	}
	children, ok := x11.RootChildren()
	return indicatorOnTop(children, ok, ours)
}

func (ind *indicator) redraw() {
	for _, o := range ind.list {
		gtkWidgetQueueDraw(o.area)
	}
}

func (ind *indicator) setText(t string) { ind.text = t; ind.redraw() }

func (ind *indicator) setRec(on bool) { ind.rec = on; ind.redraw() }

func (ind *indicator) setVoice(on, muted bool) {
	ind.voice = ""
	if on {
		ind.voice = uicore.VoiceIndicator(muted)
	}
	ind.redraw()
}

// notify 3 sn bildirim satırı.
func (ind *indicator) notify(u *UI, text string) {
	ind.noteText = text
	ind.noteGen++
	gen := ind.noteGen
	ind.redraw()
	time.AfterFunc(3*time.Second, func() {
		u.do(func() {
			if gen == ind.noteGen && u.ind == ind {
				ind.noteText = ""
				ind.redraw()
			}
		})
	})
}

func (ind *indicator) setShared(m signal.Monitor) {
	ind.shared, ind.strokes, ind.laser = m, nil, nil
	ind.redraw()
}

// annot işaretleme iletisi (lazer 1 sn sonra söner).
func (ind *indicator) annot(u *UI, m dc.Ctl) {
	var laser bool
	ind.strokes, ind.laser, laser = uicore.ApplyAnnot(ind.strokes, ind.laser, m)
	if laser {
		ind.laserGen++
		gen := ind.laserGen
		time.AfterFunc(time.Second, func() {
			u.do(func() {
				if gen == ind.laserGen && u.ind == ind {
					ind.laser = nil
					ind.redraw()
				}
			})
		})
	}
	ind.redraw()
}

const (
	cairoOpClear  = 0
	cairoOpSource = 1
	cairoOpOver   = 2
)

func rgb(c uicore.RGB) (float64, float64, float64) {
	return float64(c.R) / 255, float64(c.G) / 255, float64(c.B) / 255
}

// sharedHere paylaşılan monitör bu pencere mi. signal.Monitor.ID 1 tabanlı GDK monitör sırasıdır (capture.Monitors:
// ID = x11.Monitors dizini + 1, K2); aralık dışı ya da Wayland (portaldan tek akış) → ilk monitör.
func (ind *indicator) sharedHere(o *overlay) bool {
	i := ind.shared.ID - 1
	if ind.shared.W == 0 || i < 0 || i >= len(ind.list) {
		i = 0
	}
	return len(ind.list) > 0 && ind.list[i] == o
}

// draw saydam zemin, kırmızı kenarlık, üst ortada satırlar ve (paylaşılan monitörde) çizimler.
func (ind *indicator) draw(o *overlay, cr uintptr) {
	w, h := float64(o.geo.W), float64(o.geo.H)
	cairoSetOperator(cr, cairoOpClear)
	cairoPaint(cr)
	cairoSetOperator(cr, cairoOpOver)
	r, g, b := rgb(uicore.IndicatorBg)
	cairoSetSourceRGBA(cr, r, g, b, 1)
	cairoSetLineWidth(cr, indBorder)
	cairoRectangle(cr, indBorder/2, indBorder/2, w-indBorder, h-indBorder)
	cairoStroke(cr)
	y := 4.0
	for _, line := range []string{ind.text, ind.noteText, recLine(ind.rec), ind.voice} {
		if line == "" {
			continue
		}
		y += drawPill(cr, line, w/2, y) + 4
	}
	if !ind.sharedHere(o) {
		return
	}
	cairoSetLineWidth(cr, 4)
	cairoSetLineJoin(cr, 1)
	for _, s := range ind.strokes {
		c := uicore.AnnotColor(s.Color)
		cairoSetSourceRGBA(cr, c[0], c[1], c[2], 1)
		for _, seg := range uicore.StrokePolylines(s, w, h) {
			cairoNewPath(cr)
			cairoMoveTo(cr, seg[0][0], seg[0][1])
			for _, q := range seg[1:] {
				cairoLineTo(cr, q[0], q[1])
			}
			cairoStroke(cr)
		}
	}
	if ind.laser != nil {
		c := uicore.AnnotColor("red")
		cairoSetSourceRGBA(cr, c[0], c[1], c[2], 1)
		cairoNewPath(cr)
		cairoArc(cr, ind.laser[0]*w, ind.laser[1]*h, 8, 0, 2*math.Pi)
		cairoFill(cr)
	}
}

func recLine(on bool) string {
	if on {
		return flow.RecTexts.Indicator
	}
	return ""
}

// drawPill ortalanmış kırmızı zeminli beyaz metin satırı; yüksekliği döner.
func drawPill(cr uintptr, text string, cx, y float64) float64 {
	const size, padX, padY = 15.0, 14.0, 6.0
	cairoSelectFontFace(cr, cstr("sans-serif"), 0, 1)
	cairoSetFontSize(cr, size)
	t := cstr(text)
	var ext [6]float64 // x_bearing, y_bearing, width, height, x_advance, y_advance
	cairoTextExtents(cr, t, &ext)
	pw, ph := ext[4]+2*padX, size+2*padY
	r, g, b := rgb(uicore.IndicatorBg)
	cairoSetSourceRGBA(cr, r, g, b, 1)
	cairoRectangle(cr, cx-pw/2, y, pw, ph)
	cairoFill(cr)
	r, g, b = rgb(uicore.IndicatorText)
	cairoSetSourceRGBA(cr, r, g, b, 1)
	cairoMoveTo(cr, cx-pw/2+padX, y+padY+size*0.8)
	cairoShowText(cr, t)
	return ph
}
