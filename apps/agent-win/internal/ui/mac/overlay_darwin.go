//go:build darwin

package mac

import (
	"time"

	"remote-support/agent-win/internal/annot"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/dc"
	"remote-support/agent-win/internal/flow"
	"remote-support/agent-win/internal/ui/uicore"
)

// Gizlenemeyen gösterge (AC-103, §5.2b, S-P28f-2) ve işaretleme katmanı (AC-37/56): her NSScreen'de ekran boyutunda,
// kenarlıksız, saydam, tıklama geçirgen, gösterge seviyesinde, tüm masaüstlerinde/tam ekran uygulama üstünde, canHide=NO
// bir pencere. Görünüm kırmızı kenarlığı (ve paylaşılan ekranda çizimleri) çizer; üst-ortada etiket, altında bildirim
// ve "Kayıt" satırı. 1 sn tikte uygulama gizliyse unhide:, her ekranda pencere var mı, hepsi öne alınır ve
// occlusionState ile görünürlük denetlenir; 3 ardışık tik görünmezse kapı kapanır (fail-closed).

type overlay struct {
	win, view, label, note, rec objc.ID
	sc                          screen
}

type indicator struct {
	list     []*overlay
	text     string
	noteText string
	noteGen  int
	rec      bool
	shared   int // paylaşılan ekranın CGDirectDisplayID'si (K2: signal.Monitor.ID)
	strokes  []annot.Stroke
	laser    *[2]float64
	laserGen int
}

const (
	indLabelW, indLabelH = 460, 30
	indBorder            = 5
)

func newIndicator(u *UI, text string, shared int) *indicator {
	ind := &indicator{text: text, shared: shared}
	ind.sync(u)
	return ind
}

// sync her ekranda bir pencere (ekran kümesi değiştiyse yeniden kurulur).
func (ind *indicator) sync(_ *UI) {
	scr := screenFrames()
	same := len(scr) == len(ind.list)
	for i := 0; same && i < len(scr); i++ {
		same = scr[i] == ind.list[i].sc
	}
	if !same {
		for _, o := range ind.list {
			o.close()
		}
		ind.list = nil
		for _, s := range scr {
			ind.list = append(ind.list, ind.newOverlay(s))
		}
	}
	for _, o := range ind.list {
		o.win.Send(selOrderFrontRegardless)
	}
}

func (ind *indicator) newOverlay(s screen) *overlay {
	o := &overlay{sc: s, win: overlayWindow(s.frame)}
	v := objc.ID(clsView).Send(selAlloc).Send(objc.Sel("initWithFrame:"), rect(0, 0, s.frame.Size.W, s.frame.Size.H))
	o.win.Send(selSetContentView, v)
	v.Send(selRelease)
	o.view = v
	drawers[v] = func(objc.ID) { ind.draw(o) }
	menuH := s.frame.Origin.Y + s.frame.Size.H - (s.visible.Origin.Y + s.visible.Size.H)
	x := (s.frame.Size.W - indLabelW) / 2
	o.label = indLabel(v, ind.text, x, menuH, indLabelW, indLabelH)
	o.note = indLabel(v, ind.noteText, x, menuH+indLabelH+4, indLabelW, 26)
	show(o.note, ind.noteText != "")
	o.rec = indLabel(v, flow.RecTexts.Indicator, x, menuH+indLabelH+34, 160, 26)
	show(o.rec, ind.rec)
	return o
}

func indLabel(v objc.ID, text string, x, y, w, h float64) objc.ID {
	l := cls("NSTextField").Send(objc.Sel("labelWithString:"), nsstr(text))
	l.Send(selSetFont, font(fontBold))
	l.Send(objc.Sel("setDrawsBackground:"), true)
	l.Send(objc.Sel("setBackgroundColor:"), rgb(uicore.IndicatorBg))
	l.Send(selSetTextColor, rgb(uicore.IndicatorText))
	l.Send(objc.Sel("setAlignment:"), uint(nsAlignCtr))
	l.Send(selSetFrame, rect(x, y, w, h))
	v.Send(selAddSubview, l)
	return l
}

func (o *overlay) close() {
	delete(drawers, o.view)
	o.win.Send(selClose)
	o.win.Send(selRelease)
}

func (ind *indicator) close() {
	for _, o := range ind.list {
		o.close()
	}
	ind.list = nil
}

// visible her ekrandaki gösterge penceresi görünür mü (isVisible + occlusionState visible).
func (ind *indicator) visible() bool {
	if len(ind.list) == 0 {
		return false
	}
	for _, o := range ind.list {
		if !sendBool(o.win, objc.Sel("isVisible")) || sendInt(o.win, objc.Sel("occlusionState"))&occVisible == 0 {
			return false
		}
	}
	return true
}

// indicatorTick §5.2b: öne al, denetle; 3 ardışık başarısız tikte kapı kapanır ve oturum penceresine neden yazılır.
func (u *UI) indicatorTick() {
	u.ind.sync(u)
	if !u.health.Observe(u.ind.visible()) {
		return
	}
	u.gate.Close()
	closePrompt(u.ctlDlg)
	u.emit(flow.Event{Kind: flow.EvControlSystem}) // akış control.state{VIEW, SYSTEM} gönderir
	if s := u.sess; s != nil && !s.finished {
		setText(s.status, flow.MacTexts.IndicatorFail)
	}
}

func (ind *indicator) setText(text string) {
	ind.text = text
	for _, o := range ind.list {
		setText(o.label, text)
	}
}

func (ind *indicator) setRec(on bool) {
	ind.rec = on
	for _, o := range ind.list {
		show(o.rec, on)
	}
}

// notify 3 sn bildirim satırı (yeni bildirim öncekinin yerini alır).
func (ind *indicator) notify(u *UI, text string) {
	ind.noteText = text
	ind.noteGen++
	gen := ind.noteGen
	for _, o := range ind.list {
		setText(o.note, text)
		show(o.note, true)
	}
	time.AfterFunc(3*time.Second, func() {
		u.do(func() {
			if gen != ind.noteGen || u.ind != ind {
				return
			}
			ind.noteText = ""
			for _, o := range ind.list {
				show(o.note, false)
			}
		})
	})
}

func (ind *indicator) setShared(id int) {
	ind.shared, ind.strokes, ind.laser = id, nil, nil
	ind.redraw()
}

func (ind *indicator) redraw() {
	for _, o := range ind.list {
		o.view.Send(selSetNeedsDisplay, true)
	}
}

// annot işaretleme iletisi (lazer 1 sn sonra söner).
func (ind *indicator) annot(u *UI, m dc.Ctl) {
	var laser bool
	ind.strokes, ind.laser, laser = annot.Apply(ind.strokes, ind.laser, m)
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

var (
	selBezier      = objc.Sel("bezierPath")
	selMoveTo      = objc.Sel("moveToPoint:")
	selLineTo      = objc.Sel("lineToPoint:")
	selStroke      = objc.Sel("stroke")
	selLineWidth   = objc.Sel("setLineWidth:")
	selSetStroke   = objc.Sel("setStroke")
	selSetFill     = objc.Sel("setFill")
	selRectPath    = objc.Sel("bezierPathWithRect:")
	selOvalPath    = objc.Sel("bezierPathWithOvalInRect:")
	selFill        = objc.Sel("fill")
	selColorString = objc.Sel("colorWithSRGBRed:green:blue:alpha:")
)

// draw kırmızı kenarlık ve (paylaşılan ekranda) çizimler; görünüm ters çevrilmiştir (0..1 → sol üst orijin).
func (ind *indicator) draw(o *overlay) {
	w, h := o.sc.frame.Size.W, o.sc.frame.Size.H
	rgb(uicore.IndicatorBg).Send(selSetStroke)
	border := cls("NSBezierPath").Send(selRectPath, rect(indBorder/2, indBorder/2, w-indBorder, h-indBorder))
	border.Send(selLineWidth, float64(indBorder))
	border.Send(selStroke)
	if o.sc.id != ind.shared {
		return
	}
	pt := func(p [2]float64) objc.CGPoint { return objc.CGPoint{X: p[0], Y: p[1]} }
	bp := cls("NSBezierPath")
	for _, s := range ind.strokes {
		c := annot.Color(s.Color)
		cls("NSColor").Send(selColorString, c[0], c[1], c[2], 1.0).Send(selSetStroke)
		for _, seg := range annot.Polylines(s, w, h) {
			p := bp.Send(selBezier)
			p.Send(selLineWidth, 4.0)
			p.Send(selMoveTo, pt(seg[0]))
			for _, q := range seg[1:] {
				p.Send(selLineTo, pt(q))
			}
			p.Send(selStroke)
		}
	}
	if ind.laser != nil {
		c := annot.Color("red")
		cls("NSColor").Send(selColorString, c[0], c[1], c[2], 1.0).Send(selSetFill)
		x, y := ind.laser[0]*w, ind.laser[1]*h
		bp.Send(selOvalPath, rect(x-8, y-8, 16, 16)).Send(selFill)
	}
}
