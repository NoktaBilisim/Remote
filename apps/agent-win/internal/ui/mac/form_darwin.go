//go:build darwin

package mac

import (
	"image"
	"image/color"
	"unsafe"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/control"
	"remote-support/agent-win/internal/darwin/objc"
	"remote-support/agent-win/internal/ui/uicore"
)

// form bir AppKit penceresi ve denetimleri. İçerik görünümü ters çevrilmiştir (orijin sol üst, y aşağı) ki düzen
// Windows ekranlarıyla aynı nokta değerleriyle yazılsın. Tüm yöntemler ana iş parçacığında çağrılır.
type form struct {
	u       *UI
	win     objc.ID
	view    objc.ID
	w, h    float64
	senders []objc.ID // geri çağrı tablolarından silinecek denetimler
	dangers []objc.ID // tema değişince yeniden boyanan uyarı etiketleri
	closed  bool
}

type fontKind int

const (
	fontNormal fontKind = iota
	fontBold
	fontBig
	fontHuge
)

var (
	selInitContent    = objc.Sel("initWithContentRect:styleMask:backing:defer:")
	selSetTitle       = objc.Sel("setTitle:")
	selSetContentView = objc.Sel("setContentView:")
	selClose          = objc.Sel("close")
)

// newForm başlıklı, kapatılabilir (küçültülemez, boyutlanamaz; §5.2b) pencere. TEST bandı gerekiyorsa en üstte
// kırmızı satır olarak eklenir ve içerik aşağı kayar (AC-390: her pencerenin üstünde).
func (u *UI) newForm(title string, w, h float64) *form {
	top := 0.0
	if u.band {
		top = bandH
	}
	win := cls("NSWindow").Send(selAlloc).Send(selInitContent,
		objc.CGRect{Size: objc.CGSize{W: w, H: h + top}}, uint(nsTitled|nsClosable), uint(nsBuffered), false)
	f := &form{u: u, win: win, w: w, h: h + top}
	win.Send(objc.Sel("setRestorable:"), false) // AC-394: Saved Application State yok
	win.Send(objc.Sel("setReleasedWhenClosed:"), false)
	win.Send(objc.Sel("setCanHide:"), false) // §5.2b
	win.Send(objc.Sel("setHidesOnDeactivate:"), false)
	win.Send(selSetTitle, nsstr(title))
	view := objc.ID(clsView).Send(selAlloc).Send(objc.Sel("initWithFrame:"), objc.CGRect{Size: objc.CGSize{W: w, H: h + top}})
	win.Send(selSetContentView, view)
	view.Send(selRelease)
	f.view = view
	win.Send(selSetDelegate, target)
	f.senders = append(f.senders, win)
	if u.band {
		b := f.labelAt(flowBandText(), 0, 0, w, bandH, fontBold)
		b.Send(objc.Sel("setDrawsBackground:"), true)
		b.Send(objc.Sel("setBackgroundColor:"), rgb(uicore.IndicatorBg))
		b.Send(selSetTextColor, rgb(uicore.IndicatorText))
		b.Send(objc.Sel("setAlignment:"), uint(nsAlignCtr))
		f.view = f.inset(top)
	}
	u.forms[f] = true
	return f
}

// inset band altındaki içerik görünümü (y = top'tan başlar).
func (f *form) inset(top float64) objc.ID {
	v := objc.ID(clsView).Send(selAlloc).Send(objc.Sel("initWithFrame:"),
		objc.CGRect{Origin: objc.CGPoint{Y: top}, Size: objc.CGSize{W: f.w, H: f.h - top}})
	f.view.Send(selAddSubview, v)
	v.Send(selRelease)
	return v
}

func rect(x, y, w, h float64) objc.CGRect {
	return objc.CGRect{Origin: objc.CGPoint{X: x, Y: y}, Size: objc.CGSize{W: w, H: h}}
}

func font(k fontKind) objc.ID {
	f := cls("NSFont")
	switch k {
	case fontBold:
		return f.Send(objc.Sel("boldSystemFontOfSize:"), 13.0)
	case fontBig:
		return f.Send(objc.Sel("boldSystemFontOfSize:"), 20.0)
	case fontHuge:
		return f.Send(objc.Sel("monospacedDigitSystemFontOfSize:weight:"), 34.0, 0.4)
	}
	return f.Send(objc.Sel("systemFontOfSize:"), 13.0)
}

func rgb(c uicore.RGB) objc.ID {
	return cls("NSColor").Send(objc.Sel("colorWithSRGBRed:green:blue:alpha:"),
		float64(c.R)/255, float64(c.G)/255, float64(c.B)/255, 1.0)
}

// label sarmalı, seçilemez düz metin etiketi (S-P28f-12: yalnız setStringValue:).
func (f *form) label(text string, x, y, w, h float64, k fontKind) objc.ID {
	return f.labelAt(text, x, y, w, h, k)
}

func (f *form) labelAt(text string, x, y, w, h float64, k fontKind) objc.ID {
	l := cls("NSTextField").Send(objc.Sel("wrappingLabelWithString:"), nsstr(text))
	l.Send(selSetSelectable, false)
	l.Send(selSetFrame, rect(x, y, w, h))
	l.Send(selSetFont, font(k))
	sendIf(l, "setAllowsEditingTextAttributes:", false)
	f.view.Send(selAddSubview, l)
	return l
}

// danger tehlike renginde etiket (DESIGN danger; açık/koyu tabloya göre, tema değişince tikte yeniden boyanır).
func (f *form) danger(text string, x, y, w, h float64, k fontKind) objc.ID {
	l := f.label(text, x, y, w, h, k)
	l.Send(selSetTextColor, rgb(uicore.ThemePalette(f.u.dark).Danger))
	f.dangers = append(f.dangers, l)
	return l
}

// button NKDestekDugme (basış kaydı localClick için). fn ana iş parçacığında, gönderenle çağrılır.
func (f *form) button(title string, x, y, w, h float64, fn func(sender objc.ID)) objc.ID {
	b := objc.ID(clsButton).Send(objc.Sel("buttonWithTitle:target:action:"), nsstr(stripAccel(title)), target, selAction)
	return f.control(b, x, y, w, h, fn)
}

// check onay kutusu (NKDestekDugme). Durum korunan kutularda denetimden değil Go değişkeninden okunur.
func (f *form) check(title string, x, y, w, h float64, fn func(sender objc.ID)) objc.ID {
	b := objc.ID(clsButton).Send(objc.Sel("checkboxWithTitle:target:action:"), nsstr(stripAccel(title)), target, selAction)
	return f.control(b, x, y, w, h, fn)
}

// radio seçenek düğmesi (aynı üst görünüm ve eylemdeki radyolar tek grup).
func (f *form) radio(title string, x, y, w, h float64, fn func(sender objc.ID)) objc.ID {
	b := objc.ID(clsButton).Send(objc.Sel("radioButtonWithTitle:target:action:"), nsstr(title), target, selAction)
	return f.control(b, x, y, w, h, fn)
}

func (f *form) control(c objc.ID, x, y, w, h float64, fn func(objc.ID)) objc.ID {
	c.Send(selSetFrame, rect(x, y, w, h))
	f.view.Send(selAddSubview, c)
	actions[c] = fn
	f.senders = append(f.senders, c)
	return c
}

// field tek satırlı metin girişi; onEnter Enter'da, onChange her değişimde (ikisi de nil olabilir).
func (f *form) field(x, y, w, h float64, onEnter func(), onChange func()) objc.ID {
	t := cls("NSTextField").Send(selAlloc).Send(objc.Sel("initWithFrame:"), rect(x, y, w, h))
	t.Send(selSetFont, font(fontNormal))
	sendIf(t, "setAllowsEditingTextAttributes:", false)
	sendIf(t, "setImportsGraphics:", false)
	f.view.Send(selAddSubview, t)
	t.Send(selRelease)
	if onEnter != nil {
		t.Send(selSetTarget, target)
		t.Send(selSetAction, selAction)
		actions[t] = func(objc.ID) { onEnter() }
	}
	if onChange != nil {
		t.Send(selSetDelegate, target)
		textChanged[t] = onChange
	}
	f.senders = append(f.senders, t)
	return t
}

// textView salt okunur, kaydırılabilir düz metin alanı (S-P28f-12: zengin metin, bağlantı ve veri algılama kapalı).
func (f *form) textView(x, y, w, h float64, text string) objc.ID {
	sv := cls("NSScrollView").Send(selAlloc).Send(objc.Sel("initWithFrame:"), rect(x, y, w, h))
	sv.Send(objc.Sel("setHasVerticalScroller:"), true)
	sv.Send(objc.Sel("setBorderType:"), uint(2)) // NSBezelBorder
	cs := pobjc.Send[objc.CGSize](sv, objc.Sel("contentSize"))
	tv := cls("NSTextView").Send(selAlloc).Send(objc.Sel("initWithFrame:"), objc.CGRect{Size: cs})
	tv.Send(selSetEditable, false)
	tv.Send(selSetSelectable, true)
	tv.Send(objc.Sel("setRichText:"), false)
	sendIf(tv, "setImportsGraphics:", false)
	sendIf(tv, "setAutomaticLinkDetectionEnabled:", false)
	sendIf(tv, "setAutomaticDataDetectionEnabled:", false)
	sendIf(tv, "setAutomaticTextReplacementEnabled:", false)
	tv.Send(objc.Sel("setVerticallyResizable:"), true)
	tv.Send(objc.Sel("setHorizontallyResizable:"), false)
	tv.Send(objc.Sel("setAutoresizingMask:"), uint(nsWidthSize))
	tv.Send(objc.Sel("setMinSize:"), objc.CGSize{H: cs.H})
	tv.Send(objc.Sel("setMaxSize:"), objc.CGSize{W: 1e7, H: 1e7})
	tv.Send(objc.Sel("textContainer")).Send(objc.Sel("setWidthTracksTextView:"), true)
	tv.Send(selSetFont, font(fontNormal))
	tv.Send(objc.Sel("setString:"), nsstr(text))
	sv.Send(objc.Sel("setDocumentView:"), tv)
	tv.Send(selRelease)
	f.view.Send(selAddSubview, sv)
	sv.Send(selRelease)
	return tv
}

// setTextView metni değiştirir ve sona kaydırır.
func setTextView(tv objc.ID, text string) {
	tv.Send(objc.Sel("setString:"), nsstr(text))
	tv.Send(objc.Sel("scrollToEndOfDocument:"), objc.ID(0))
}

// picture logo (Go'da çözülmüş; NSImage initWithData: yok — S-P28f-12). Retina için 2× piksel, logo zemini
// LogoBg (siyah "nokta" yazısı koyu temada da okunur).
func (f *form) picture(img image.Image, x, y, w, h float64) {
	pw, ph := int(w*2), int(h*2)
	bg := uicore.ThemePalette(f.u.dark).LogoBg
	px := bgrToRGBA(uicore.FitBGR(img, pw, ph, color.RGBA{bg.R, bg.G, bg.B, 0xff}), pw, ph)
	if px == nil {
		return
	}
	rep := cls("NSBitmapImageRep").Send(selAlloc).Send(
		objc.Sel("initWithBitmapDataPlanes:pixelsWide:pixelsHigh:bitsPerSample:samplesPerPixel:hasAlpha:isPlanar:colorSpaceName:bytesPerRow:bitsPerPixel:"),
		uintptr(0), pw, ph, 8, 4, true, false, nsstr("NSDeviceRGBColorSpace"), pw*4, 32)
	if rep == 0 {
		return
	}
	defer rep.Send(selRelease)
	dst := pobjc.Send[unsafe.Pointer](rep, objc.Sel("bitmapData")) // NSBitmapImageRep'in kendi tamponu
	if dst == nil || sendInt(rep, objc.Sel("bytesPerRow")) != pw*4 {
		return
	}
	copy(unsafe.Slice((*byte)(dst), len(px)), px)
	im := cls("NSImage").Send(selAlloc).Send(objc.Sel("initWithSize:"), objc.CGSize{W: w, H: h})
	im.Send(objc.Sel("addRepresentation:"), rep)
	iv := cls("NSImageView").Send(objc.Sel("imageViewWithImage:"), im)
	im.Send(selRelease)
	iv.Send(objc.Sel("setImageScaling:"), uint(nsScaleDown))
	iv.Send(selSetFrame, rect(x, y, w, h))
	f.view.Send(selAddSubview, iv)
}

// keyButton görünmez, yalnız kısayol tuşu taşıyan düğme (ör. Esc → Reddet).
func (f *form) keyButton(key string, fn func()) {
	b := f.button("", -100, -100, 1, 1, func(objc.ID) { fn() })
	b.Send(selSetKeyEquivalent, nsstr(key))
	b.Send(objc.Sel("setRefusesFirstResponder:"), true)
}

func setDefault(b objc.ID) { b.Send(selSetKeyEquivalent, nsstr(keyEnter)) }

func setText(c objc.ID, s string) { c.Send(selSetStringValue, nsstr(s)) }

func getText(c objc.ID) string { return goText(c.Send(selStringVal)) }

func enable(c objc.ID, on bool) { c.Send(selSetEnabled, on) }

func show(c objc.ID, on bool) { c.Send(selSetHidden, !on) }

func setChecked(c objc.ID, on bool) {
	v := 0
	if on {
		v = nsStateOn
	}
	c.Send(selSetState, v)
}

func checked(c objc.ID) bool { return sendInt(c, selState) == nsStateOn }

// onClose pencere kapatma düğmesinin (ve Cmd+Q yolunun) işleyicisi.
func (f *form) onClose(fn func()) {
	closers[f.win] = fn
	f.u.quit = fn
}

// show pencereyi ana ekranın çalışma alanında ortalar (away: imleç dışında, G-03), öne getirir ve odaklar.
func (f *form) show(focus objc.ID, away bool, level int) {
	scr := cls("NSScreen").Send(objc.Sel("mainScreen"))
	vf := sendRect(scr, objc.Sel("visibleFrame"))
	fr := sendRect(f.win, objc.Sel("frame"))
	x := vf.Origin.X + (vf.Size.W-fr.Size.W)/2
	y := vf.Origin.Y + (vf.Size.H-fr.Size.H)/2
	if away {
		ml := pobjc.Send[objc.CGPoint](cls("NSEvent"), objc.Sel("mouseLocation"))
		work := control.Rect{Left: int32(vf.Origin.X), Top: int32(vf.Origin.Y),
			Right: int32(vf.Origin.X + vf.Size.W), Bottom: int32(vf.Origin.Y + vf.Size.H)}
		px, py := control.PlaceAway(control.Point{X: int32(ml.X), Y: int32(ml.Y)}, work,
			int32(fr.Size.W), int32(fr.Size.H), 24)
		x, y = float64(px), float64(py)
	}
	f.win.Send(objc.Sel("setFrameOrigin:"), objc.CGPoint{X: x, Y: y})
	if level != 0 {
		f.win.Send(objc.Sel("setLevel:"), level)
	}
	f.win.Send(objc.Sel("makeKeyAndOrderFront:"), objc.ID(0))
	cls("NSApplication").Send(selSharedApp).Send(objc.Sel("activateIgnoringOtherApps:"), true)
	if focus != 0 {
		f.win.Send(objc.Sel("makeFirstResponder:"), focus)
	}
}

// destroy pencereyi kapatır ve geri çağrı kayıtlarını siler.
func (f *form) destroy() {
	if f.closed {
		return
	}
	f.closed = true
	for _, s := range f.senders {
		delete(actions, s)
		delete(textChanged, s)
		delete(closers, s)
		delete(becameKey, s)
		delete(downs, s)
	}
	delete(f.u.forms, f)
	f.win.Send(selSetDelegate, objc.ID(0))
	f.win.Send(selClose)
	f.win.Send(selRelease)
}

// recolor tema değişince uyarı etiketleri.
func (f *form) recolor(dark bool) {
	c := rgb(uicore.ThemePalette(dark).Danger)
	for _, l := range f.dangers {
		l.Send(selSetTextColor, c)
	}
}

// sendIf seçici uygulanıyorsa gönderir (sınıfta olmayan seçici ObjC istisnası = süreç çökmesi olurdu).
func sendIf(id objc.ID, sel string, arg bool) {
	if s := objc.Sel(sel); objc.Responds(id, s) {
		id.Send(s, arg)
	}
}
