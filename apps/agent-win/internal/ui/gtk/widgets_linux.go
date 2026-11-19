//go:build linux

package gtk

import (
	"image"
	"image/color"
	"strings"

	"remote-support/agent-win/internal/linux/glib"
	"remote-support/agent-win/internal/ui/uicore"
)

// GTK sabitleri.
const (
	gtkWindowToplevel = 0
	gtkWindowPopup    = 1
	orientH           = 0
	orientV           = 1
	wrapWordChar      = 3
	hintDialog        = 1
	alignStart        = 1
	alignCenter       = 3
	stateIconified    = 1 << 1
	gdkButtonPress    = 4
	gdkButtonRelease  = 7
	keyEscape         = 0xff1b
	shadowIn          = 1
	priorityUserPlus1 = 801 // GTK_STYLE_PROVIDER_PRIORITY_USER + 1 (O-P28g-T2-1)
)

// form bir üst düzey pencere: dikey kutu düzeni (mantıksal piksel, GDK_SCALE ile ölçeklenir).
type form struct {
	u      *UI
	win    uintptr
	box    uintptr
	closed bool
	onX    func() // ✕ (delete-event): her zaman yakalanır, sessiz gizleme yok
}

func (u *UI) newForm(t string, width int32) *form {
	f := &form{u: u, win: gtkWindowNew(gtkWindowToplevel)}
	gtkWindowSetTitle(f.win, cstr(u.winTitle(t)))
	gtkWindowSetResizable(f.win, false)
	gtkWidgetSetSizeRequest(f.win, width, -1)
	gtkContainerSetBorderWidth(f.win, 16)
	addClass(f.win, clsWindow)
	f.box = gtkBoxNew(orientV, 8)
	gtkContainerAdd(f.win, f.box)
	onEvent(f.win, sigDelete, func(uintptr) bool {
		if f.onX != nil {
			f.onX()
		}
		return true // pencere kendiliğinden kapanmaz; kapatma yolu onX'tir
	})
	on(f.win, sigDestroy, func() { f.closed = true; delete(u.forms, f) })
	u.forms[f] = true
	return f
}

// show pencereyi gösterir ve öne getirir; focus verilirse odak oradadır.
func (f *form) show(focus uintptr) {
	gtkWidgetShowAll(f.win)
	gtkWindowPresent(f.win)
	if focus != 0 {
		gtkWidgetGrabFocus(focus)
	}
}

func (f *form) destroy() {
	if !f.closed {
		f.closed = true
		delete(f.u.forms, f)
		gtkWidgetDestroy(f.win)
	}
}

func addClass(w uintptr, c string) { gtkStyleContextAddClass(gtkWidgetGetStyleContext(w), cstr(c)) }

// add kutuya ekler (genişlemez).
func add(box, w uintptr) uintptr {
	gtkBoxPackStart(box, w, false, true, 0)
	return w
}

// row yatay düğme satırı.
func (f *form) row() uintptr { return add(f.box, gtkBoxNew(orientH, 8)) }

// newLabel düz metin etiketi: markup ve alt çizgi (mnemonic) kapalı, sarar, sola dayalı (güvenilmeyen metin yalnız
// gtk_label_set_text ile; §2.1).
func newLabel(text, class string) uintptr {
	l := gtkLabelNew(nil)
	gtkLabelSetUseMarkup(l, false)
	gtkLabelSetUseUnderline(l, false)
	gtkLabelSetText(l, cstr(text))
	gtkLabelSetLineWrap(l, true)
	gtkLabelSetMaxWidthChar(l, 56)
	gtkLabelSetXalign(l, 0)
	addClass(l, class)
	return l
}

func (f *form) label(text string) uintptr   { return add(f.box, newLabel(text, clsLabel)) }
func (f *form) danger(text string) uintptr  { return add(f.box, newLabel(text, clsDanger)) }
func (f *form) heading(text string) uintptr { l := f.label(text); setBold(l); return l }

// setBold kalın başlık (CSS sınıfı; markup kullanılmaz).
func setBold(l uintptr) { addClass(l, clsBold) }

func setText(w uintptr, s string) {
	if w != 0 {
		gtkLabelSetText(w, cstr(s))
	}
}

func labelText(w uintptr) string { return glib.GoString(gtkLabelGetText(w)) }

// show gösterir/gizler; gösterirken çocuklar da gösterilir (gizli kurulan satırlar no_show_all ile kalmıştı).
func show(w uintptr, on bool) {
	if w == 0 {
		return
	}
	gtkWidgetSetNoShowAll(w, !on)
	if on {
		gtkWidgetShowAll(w)
	} else {
		gtkWidgetSetVisible(w, false)
	}
}

// wrapChild onay kutusu/radyo düğmesi etiketini sarar (uzun metin pencereyi genişletmesin).
func wrapChild(b uintptr) {
	if l := gtkBinGetChild(b); l != 0 {
		gtkLabelSetUseMarkup(l, false)
		gtkLabelSetLineWrap(l, true)
		gtkLabelSetMaxWidthChar(l, 56)
		gtkLabelSetXalign(l, 0)
	}
}

func enable(w uintptr, on bool) {
	if w != 0 {
		gtkWidgetSetSensitive(w, on)
	}
}

// button sıradan (korunmayan) düğme: "clicked" (fare, klavye, Orca) — yalnız güvenli yönde işleyen eylemler
// (Kontrolü kapat, Oturumu bitir, Gönder, Vazgeç, Sessize al …; AC-100).
func (f *form) button(box uintptr, text string, fn func()) uintptr {
	b := gtkButtonNewWithLabel(cstr(uicore.StripAccel(text)))
	addClass(b, clsButton)
	on(b, sigClicked, fn)
	gtkBoxPackStart(box, b, false, false, 0)
	return b
}

// protected korunan düğme (§5.2a): eylem yalnız aynı düğmede sol basış + sol bırakma çiftinden gelir; clicked/activate
// bağlı değildir ve düğme klavye odağı almaz. fn yerel/ret sınıfını alır. Basış/bırakma bağlanamazsa düğme devre
// dışıdır (fail-closed).
func (f *form) protected(box uintptr, text string, fn func(k clickKind)) uintptr {
	b := gtkButtonNewWithLabel(cstr(uicore.StripAccel(text)))
	addClass(b, clsButton)
	gtkWidgetSetCanFocus(b, false)
	if !f.u.bindClick(b, false, fn) {
		gtkWidgetSetSensitive(b, false)
	}
	gtkBoxPackStart(box, b, false, false, 0)
	return b
}

// protectedCheck korunan onay kutusu (pano anahtarı, kayıt rızası): görünüm her zaman get()'ten yazılır; GTK'nın kendi
// geçişi (fare, Space, AT-SPI) "toggled"da geri alınır, mantık yalnız yerel tıklamayla fn içinde değişir.
func (f *form) protectedCheck(text string, get func() bool, fn func(k clickKind)) uintptr {
	c := gtkCheckButtonNewWithLabel(cstr(text))
	addClass(c, clsLabel)
	wrapChild(c)
	ok := f.u.bindClick(c, true, func(k clickKind) { fn(k); setChecked(c, get()) })
	ok = ok && on(c, sigToggled, func() {
		if gtkToggleGetActive(c) != get() {
			setChecked(c, get())
		}
	})
	if !ok {
		gtkWidgetSetSensitive(c, false)
	}
	add(f.box, c)
	return c
}

// check sıradan onay kutusu (KVKK onayı: güvenli yön değil ama kontrol vermez; P28f ile aynı).
func (f *form) check(text string, fn func()) uintptr {
	c := gtkCheckButtonNewWithLabel(cstr(text))
	addClass(c, clsLabel)
	wrapChild(c)
	on(c, sigToggled, fn)
	add(f.box, c)
	return c
}

var setting bool // setChecked yeniden giriş koruması (set_active "toggled" üretir)

func setChecked(c uintptr, on bool) {
	if setting || c == 0 {
		return
	}
	setting = true
	gtkToggleSetActive(c, on)
	setting = false
}

func checked(c uintptr) bool { return gtkToggleGetActive(c) }

// field tek satır metin alanı (Enter → onEnter; değişim → onChange).
func (f *form) field(box uintptr, max int32, onEnter, onChange func()) uintptr {
	e := gtkEntryNew()
	gtkEntrySetMaxLength(e, max)
	addClass(e, clsField)
	if onEnter != nil {
		on(e, sigActivate, onEnter)
	}
	if onChange != nil {
		on(e, sigChanged, onChange)
	}
	gtkBoxPackStart(box, e, true, true, 0)
	return e
}

func entryText(e uintptr) string { return glib.GoString(gtkEntryGetText(e)) }

func setEntry(e uintptr, s string) { gtkEntrySetText(e, cstr(s)) }

// textView salt okunur, kaydırmalı düz metin (gtk_text_buffer_set_text; markup yok).
func (f *form) textView(h int32, text string) uintptr {
	sw := gtkScrolledWindowNew(0, 0)
	gtkScrolledSetMinHeight(sw, h)
	gtkScrolledSetShadow(sw, shadowIn)
	v := gtkTextViewNew()
	gtkTextViewSetEditable(v, false)
	gtkTextViewSetCursorVis(v, false)
	gtkTextViewSetWrapMode(v, wrapWordChar)
	addClass(v, clsField)
	gtkContainerAdd(sw, v)
	gtkBoxPackStart(f.box, sw, true, true, 0)
	setTextView(v, text)
	return v
}

// setTextView metni yazar ve sona kaydırır.
// textViewText geçmiş kutusunun düz metni (geri okuma; GUI duman testi düz metin kanıtı).
func textViewText(v uintptr) string {
	buf := gtkTextViewGetBuffer(v)
	var a, b [96]byte
	gtkTextBufferGetStartIter(buf, &a)
	gtkTextBufferGetEndIter(buf, &b)
	return glib.GoString(gtkTextBufferGetText(buf, &a, &b, true))
}

func setTextView(v uintptr, s string) {
	buf := gtkTextViewGetBuffer(v)
	gtkTextBufferSetText(buf, cstr(s), -1)
	var it [96]byte // GtkTextIter (80 bayt) + pay
	gtkTextBufferGetEndIter(buf, &it)
	gtkTextBufferPlaceCursor(buf, &it)
	gtkTextViewScrollMark(v, gtkTextBufferGetInsert(buf))
}

// picture logo: Go'da çözülür, uicore.FitBGR ile kutuya sığdırılır ve ham RGBA olarak verilir (g_bytes_new kopyalar;
// Go belleği C'de saklanmaz).
func picture(box uintptr, img image.Image, w, h int, bg uicore.RGB) uintptr {
	if img == nil {
		return 0
	}
	px := uicore.BGRToRGBA(uicore.FitBGR(img, w, h, color.RGBA{bg.R, bg.G, bg.B, 0xff}), w, h)
	if len(px) == 0 {
		return 0
	}
	bytes := gBytesNew(&px[0], uintptr(len(px)))
	pb := gdkPixbufNewFromBytes(bytes, 0, true, 8, int32(w), int32(h), int32(w*4))
	gBytesUnref(bytes)
	if pb == 0 {
		return 0
	}
	im := gtkImageNewFromPixbuf(pb)
	glib.Unref(pb)
	gtkBoxPackEnd(box, im, false, false, 0)
	return im
}

// --- GtkSettings özellikleri (değişken argümanlı g_object_set/get yerine) --------------------------------------------

func setStringProp(obj uintptr, name, v string) {
	var gv gvalue
	gValueInit(&gv, gTypeString)
	gValueSetString(&gv, cstr(v))
	gObjectSetProperty(obj, cstr(name), &gv)
	gValueUnset(&gv)
}

func stringProp(obj uintptr, name string) string {
	var gv gvalue
	gValueInit(&gv, gTypeString)
	gObjectGetProperty(obj, cstr(name), &gv)
	s := glib.GoString(gValueGetString(&gv))
	gValueUnset(&gv)
	return s
}

func setBoolProp(obj uintptr, name string, v bool) {
	var gv gvalue
	gValueInit(&gv, gTypeBoolean)
	gValueSetBoolean(&gv, v)
	gObjectSetProperty(obj, cstr(name), &gv)
	gValueUnset(&gv)
}

func boolProp(obj uintptr, name string) bool {
	var gv gvalue
	gValueInit(&gv, gTypeBoolean)
	gObjectGetProperty(obj, cstr(name), &gv)
	b := gValueGetBoolean(&gv)
	gValueUnset(&gv)
	return b
}

// openURI yalnız bu paketin kurduğu mailto: URI'si (adres uicore.MailtoAddr'dan geçmiş; S-P28f-12 eşi).
func openURI(parent uintptr, uri string) {
	if !strings.HasPrefix(uri, "mailto:") {
		return
	}
	var gerr uintptr
	if !gtkShowURIOnWindow(parent, cstr(uri), 0, &gerr) && gerr != 0 {
		gErrorFree(gerr)
	}
}
