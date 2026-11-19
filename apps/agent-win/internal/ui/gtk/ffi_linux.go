//go:build linux

package gtk

import (
	"errors"
	"unsafe"

	"github.com/ebitengine/purego"

	"remote-support/agent-win/internal/linux/glib"
)

// GTK/GDK/cairo bağlamaları (FFI kuralları internal/linux/glib paket belgesi): kitaplıklar izin listeli mutlak yoldan,
// sembol yoksa hata (fail-closed), değişken argümanlı işlev yok (g_object_set yerine g_object_set_property + GValue),
// değerle yapı yok. gdk_pixbuf sembolleri libgtk tutamacının bağımlılık ağacından çözülür (libgdk_pixbuf izin
// listesine eklenmez).

var (
	gdkSetAllowedBackends func(*byte)
	gtkInitCheck          func(argc, argv uintptr) bool
	gtkMain               func()
	gtkMainQuit           func()

	gtkWindowNew            func(kind int32) uintptr
	gtkWindowSetTitle       func(w uintptr, s *byte)
	gtkWindowSetDefaultSize func(w uintptr, x, y int32)
	gtkWindowSetResizable   func(w uintptr, b bool)
	gtkWindowMove           func(w uintptr, x, y int32)
	gtkWindowResize         func(w uintptr, x, y int32)
	gtkWindowGetSize        func(w uintptr, x, y *int32)
	gtkWindowGetPosition    func(w uintptr, x, y *int32)
	gtkWindowPresent        func(w uintptr)
	gtkWindowSetKeepAbove   func(w uintptr, b bool)
	gtkWindowStick          func(w uintptr)
	gtkWindowDeiconify      func(w uintptr)
	gtkWindowSetDefault     func(w, child uintptr)
	gtkWindowIsActive       func(w uintptr) bool
	gtkWindowSetUrgencyHint func(w uintptr, b bool)
	gtkWindowSetTypeHint    func(w uintptr, hint int32)
	gtkWindowSetDecorated   func(w uintptr, b bool)
	gtkWindowSetAcceptFocus func(w uintptr, b bool)
	gtkWindowSetSkipTaskbar func(w uintptr, b bool)
	gtkWindowSetSkipPager   func(w uintptr, b bool)

	gtkContainerAdd            func(c, w uintptr)
	gtkContainerSetBorderWidth func(c uintptr, n uint32)
	gtkBoxNew                  func(orient, spacing int32) uintptr
	gtkBoxPackStart            func(box, child uintptr, expand, fill bool, pad uint32)
	gtkBoxPackEnd              func(box, child uintptr, expand, fill bool, pad uint32)

	gtkLabelNew             func(s *byte) uintptr
	gtkLabelSetText         func(l uintptr, s *byte)
	gtkLabelGetText         func(l uintptr) uintptr
	gtkLabelSetLineWrap     func(l uintptr, b bool)
	gtkLabelSetXalign       func(l uintptr, x float32)
	gtkLabelSetMaxWidthChar func(l uintptr, n int32)
	gtkLabelSetUseMarkup    func(l uintptr, b bool)
	gtkLabelSetUseUnderline func(l uintptr, b bool)
	gtkLabelSetSelectable   func(l uintptr, b bool)
	gtkLabelSetJustify      func(l uintptr, j int32)

	gtkButtonNewWithLabel      func(s *byte) uintptr
	gtkButtonSetLabel          func(b uintptr, s *byte)
	gtkCheckButtonNewWithLabel func(s *byte) uintptr
	gtkRadioNewFromWidget      func(group uintptr, s *byte) uintptr
	gtkToggleSetActive         func(b uintptr, on bool)
	gtkToggleGetActive         func(b uintptr) bool

	gtkEntryNew          func() uintptr
	gtkEntryGetText      func(e uintptr) uintptr
	gtkEntrySetText      func(e uintptr, s *byte)
	gtkEntrySetMaxLength func(e uintptr, n int32)
	gtkEntrySetWidth     func(e uintptr, n int32)

	gtkTextViewNew          func() uintptr
	gtkTextViewGetBuffer    func(v uintptr) uintptr
	gtkTextViewSetEditable  func(v uintptr, b bool)
	gtkTextViewSetWrapMode  func(v uintptr, m int32)
	gtkTextViewSetCursorVis func(v uintptr, b bool)
	gtkTextViewScrollMark   func(v, mark uintptr)
	gtkTextBufferSetText    func(b uintptr, s *byte, n int32)
	gtkTextBufferGetEndIter func(b uintptr, iter *[96]byte)
	// P22-G: geçmişin geri okunması (düz metin kanıtı — `<b>` literal kalır; GUI duman testi).
	gtkTextBufferGetStartIter func(b uintptr, iter *[96]byte)
	gtkTextBufferGetText      func(b uintptr, start, end *[96]byte, hidden bool) uintptr
	gtkTextBufferPlaceCursor  func(b uintptr, iter *[96]byte)
	gtkTextBufferGetInsert    func(b uintptr) uintptr
	gtkScrolledWindowNew      func(h, v uintptr) uintptr
	gtkScrolledSetMinHeight   func(s uintptr, h int32)
	gtkScrolledSetShadow      func(s uintptr, t int32)
	gtkImageNewFromPixbuf     func(p uintptr) uintptr
	gtkDrawingAreaNew         func() uintptr
	gtkSeparatorNew           func(orient int32) uintptr
	gtkWidgetQueueDraw        func(w uintptr)
	gtkWidgetSetSizeRequest   func(w uintptr, x, y int32)
	gtkWidgetSetMarginTop     func(w uintptr, n int32)
	gtkWidgetShowAll          func(w uintptr)
	gtkWidgetSetVisible       func(w uintptr, b bool)
	gtkWidgetGetVisible       func(w uintptr) bool
	gtkWidgetGetMapped        func(w uintptr) bool
	gtkWidgetSetNoShowAll     func(w uintptr, b bool)
	gtkWidgetSetSensitive     func(w uintptr, b bool)
	gtkWidgetGetSensitive     func(w uintptr) bool
	gtkWidgetSetCanFocus      func(w uintptr, b bool)
	gtkWidgetSetCanDefault    func(w uintptr, b bool)
	gtkWidgetGrabFocus        func(w uintptr)
	gtkWidgetDestroy          func(w uintptr)
	gtkWidgetGetWindow        func(w uintptr) uintptr
	gtkWidgetGetAllocW        func(w uintptr) int32
	gtkWidgetGetAllocH        func(w uintptr) int32
	gtkWidgetGetStyleContext  func(w uintptr) uintptr
	gtkWidgetSetVisual        func(w, visual uintptr)
	gtkWidgetSetAppPaintable  func(w uintptr, b bool)
	gtkWidgetInputShape       func(w, region uintptr)
	gtkWidgetGetScaleFactor   func(w uintptr) int32
	gtkWidgetGetPreferredSize func(w uintptr, min, nat *[2]int32)
	gtkWidgetSetHalign        func(w uintptr, a int32)
	gtkStyleContextAddClass   func(c uintptr, s *byte)
	gtkBinGetChild            func(b uintptr) uintptr

	gtkSettingsGetDefault     func() uintptr
	gtkCSSProviderNew         func() uintptr
	gtkCSSProviderLoadData    func(p uintptr, data *byte, n int, errp *uintptr) bool
	gtkStyleContextAddScreen  func(screen, provider uintptr, prio uint32)
	gdkPixbufNewFromBytes     func(bytes uintptr, cs int32, alpha bool, bits, w, h, stride int32) uintptr
	gtkShowURIOnWindow        func(parent uintptr, uri *byte, ts uint32, errp *uintptr) bool
	gdkScreenGetDefault       func() uintptr
	gdkScreenGetRGBAVisual    func(s uintptr) uintptr
	gdkScreenIsComposited     func(s uintptr) bool
	gdkDisplayGetDefault      func() uintptr
	gdkDisplayGetNMonitors    func(d uintptr) int32
	gdkDisplayGetMonitor      func(d uintptr, i int32) uintptr
	gdkDisplayMonitorAtWindow func(d, w uintptr) uintptr
	gdkDisplayMonitorAtPoint  func(d uintptr, x, y int32) uintptr
	gdkDisplayGetDefaultSeat  func(d uintptr) uintptr
	gdkSeatGetPointer         func(s uintptr) uintptr
	gdkDeviceGetPosition      func(dev uintptr, screen *uintptr, x, y *int32)
	gdkMonitorGetGeometry     func(m uintptr, r *[4]int32)
	gdkMonitorGetWorkarea     func(m uintptr, r *[4]int32)
	gdkMonitorIsPrimary       func(m uintptr) bool
	gdkWindowRaise            func(w uintptr)
	gdkWindowIsViewable       func(w uintptr) bool
	gdkWindowGetState         func(w uintptr) uint32
	gdkEventGetSourceDevice   func(ev uintptr) uintptr
	gdkX11DeviceGetID         func(dev uintptr) int32
	gdkX11WindowGetXID        func(w uintptr) uint64

	cairoSetSourceRGBA  func(cr uintptr, r, g, b, a float64)
	cairoSetOperator    func(cr uintptr, op int32)
	cairoPaint          func(cr uintptr)
	cairoRectangle      func(cr uintptr, x, y, w, h float64)
	cairoFill           func(cr uintptr)
	cairoStroke         func(cr uintptr)
	cairoSetLineWidth   func(cr uintptr, w float64)
	cairoMoveTo         func(cr uintptr, x, y float64)
	cairoLineTo         func(cr uintptr, x, y float64)
	cairoArc            func(cr uintptr, x, y, r, a1, a2 float64)
	cairoSelectFontFace func(cr uintptr, family *byte, slant, weight int32)
	cairoSetFontSize    func(cr uintptr, s float64)
	cairoShowText       func(cr uintptr, s *byte)
	cairoTextExtents    func(cr uintptr, s *byte, ext *[6]float64)
	cairoRegionCreate   func() uintptr
	cairoRegionDestroy  func(r uintptr)
	cairoSetLineJoin    func(cr uintptr, j int32)
	cairoNewPath        func(cr uintptr)
	cairoSetSourceRGB   func(cr uintptr, r, g, b float64)

	gBytesNew          func(data *byte, n uintptr) uintptr
	gBytesUnref        func(b uintptr)
	gValueInit         func(v *gvalue, t uintptr) uintptr
	gValueUnset        func(v *gvalue)
	gValueSetString    func(v *gvalue, s *byte)
	gValueGetString    func(v *gvalue) uintptr
	gValueSetBoolean   func(v *gvalue, b bool)
	gValueGetBoolean   func(v *gvalue) bool
	gObjectSetProperty func(obj uintptr, name *byte, v *gvalue)
	gObjectGetProperty func(obj uintptr, name *byte, v *gvalue)
	gErrorFree         func(e uintptr)
)

// gvalue GValue (GType + 2×8 bayt birlik); yalnız çağrı süresince Go belleğinde.
type gvalue [3]uint64

const (
	gTypeBoolean = 5 << 2
	gTypeString  = 16 << 2
)

// sym C işlevi işaretçisi ve adı.
type sym struct {
	fn   any
	name string
}

func bindAll(h uintptr, list []sym) error {
	var errs []error
	for _, s := range list {
		errs = append(errs, glib.Func(s.fn, h, s.name))
	}
	return errors.Join(errs...)
}

// load kitaplıkları açar ve tüm sembolleri bağlar (bir kez; New'den, ana iş parçacığında).
func load() error {
	if err := glib.Load(); err != nil {
		return err
	}
	hs := map[string]uintptr{}
	for _, l := range []string{glib.LibGTK, glib.LibGDK, glib.LibCairo, glib.LibGLib, glib.LibGObject} {
		h, err := glib.Open(glib.Path(l))
		if err != nil {
			return err
		}
		hs[l] = h
	}
	return errors.Join(
		bindAll(hs[glib.LibGTK], gtkSyms()),
		bindAll(hs[glib.LibGDK], gdkSyms()),
		bindAll(hs[glib.LibCairo], cairoSyms()),
		bindAll(hs[glib.LibGLib], []sym{{&gBytesNew, "g_bytes_new"}, {&gBytesUnref, "g_bytes_unref"},
			{&gErrorFree, "g_error_free"}}),
		bindAll(hs[glib.LibGObject], []sym{{&gValueInit, "g_value_init"}, {&gValueUnset, "g_value_unset"},
			{&gValueSetString, "g_value_set_string"}, {&gValueGetString, "g_value_get_string"},
			{&gValueSetBoolean, "g_value_set_boolean"}, {&gValueGetBoolean, "g_value_get_boolean"},
			{&gObjectSetProperty, "g_object_set_property"}, {&gObjectGetProperty, "g_object_get_property"}}),
	)
}

func gtkSyms() []sym {
	return []sym{
		{&gtkInitCheck, "gtk_init_check"}, {&gtkMain, "gtk_main"}, {&gtkMainQuit, "gtk_main_quit"},
		{&gtkWindowNew, "gtk_window_new"}, {&gtkWindowSetTitle, "gtk_window_set_title"},
		{&gtkWindowSetDefaultSize, "gtk_window_set_default_size"}, {&gtkWindowSetResizable, "gtk_window_set_resizable"},
		{&gtkWindowMove, "gtk_window_move"}, {&gtkWindowResize, "gtk_window_resize"},
		{&gtkWindowGetSize, "gtk_window_get_size"}, {&gtkWindowGetPosition, "gtk_window_get_position"},
		{&gtkWindowPresent, "gtk_window_present"}, {&gtkWindowSetKeepAbove, "gtk_window_set_keep_above"},
		{&gtkWindowStick, "gtk_window_stick"}, {&gtkWindowDeiconify, "gtk_window_deiconify"},
		{&gtkWindowSetDefault, "gtk_window_set_default"}, {&gtkWindowIsActive, "gtk_window_is_active"},
		{&gtkWindowSetUrgencyHint, "gtk_window_set_urgency_hint"}, {&gtkWindowSetTypeHint, "gtk_window_set_type_hint"},
		{&gtkWindowSetDecorated, "gtk_window_set_decorated"}, {&gtkWindowSetAcceptFocus, "gtk_window_set_accept_focus"},
		{&gtkWindowSetSkipTaskbar, "gtk_window_set_skip_taskbar_hint"},
		{&gtkWindowSetSkipPager, "gtk_window_set_skip_pager_hint"},
		{&gtkContainerAdd, "gtk_container_add"}, {&gtkContainerSetBorderWidth, "gtk_container_set_border_width"},
		{&gtkBoxNew, "gtk_box_new"}, {&gtkBoxPackStart, "gtk_box_pack_start"}, {&gtkBoxPackEnd, "gtk_box_pack_end"},
		{&gtkLabelNew, "gtk_label_new"}, {&gtkLabelSetText, "gtk_label_set_text"}, {&gtkLabelGetText, "gtk_label_get_text"},
		{&gtkLabelSetLineWrap, "gtk_label_set_line_wrap"}, {&gtkLabelSetXalign, "gtk_label_set_xalign"},
		{&gtkLabelSetMaxWidthChar, "gtk_label_set_max_width_chars"}, {&gtkLabelSetUseMarkup, "gtk_label_set_use_markup"},
		{&gtkLabelSetUseUnderline, "gtk_label_set_use_underline"}, {&gtkLabelSetSelectable, "gtk_label_set_selectable"},
		{&gtkLabelSetJustify, "gtk_label_set_justify"},
		{&gtkButtonNewWithLabel, "gtk_button_new_with_label"}, {&gtkButtonSetLabel, "gtk_button_set_label"},
		{&gtkCheckButtonNewWithLabel, "gtk_check_button_new_with_label"},
		{&gtkRadioNewFromWidget, "gtk_radio_button_new_with_label_from_widget"},
		{&gtkToggleSetActive, "gtk_toggle_button_set_active"}, {&gtkToggleGetActive, "gtk_toggle_button_get_active"},
		{&gtkEntryNew, "gtk_entry_new"}, {&gtkEntryGetText, "gtk_entry_get_text"}, {&gtkEntrySetText, "gtk_entry_set_text"},
		{&gtkEntrySetMaxLength, "gtk_entry_set_max_length"}, {&gtkEntrySetWidth, "gtk_entry_set_width_chars"},
		{&gtkTextViewNew, "gtk_text_view_new"}, {&gtkTextViewGetBuffer, "gtk_text_view_get_buffer"},
		{&gtkTextViewSetEditable, "gtk_text_view_set_editable"}, {&gtkTextViewSetWrapMode, "gtk_text_view_set_wrap_mode"},
		{&gtkTextViewSetCursorVis, "gtk_text_view_set_cursor_visible"},
		{&gtkTextViewScrollMark, "gtk_text_view_scroll_mark_onscreen"},
		{&gtkTextBufferSetText, "gtk_text_buffer_set_text"}, {&gtkTextBufferGetEndIter, "gtk_text_buffer_get_end_iter"},
		{&gtkTextBufferGetStartIter, "gtk_text_buffer_get_start_iter"}, {&gtkTextBufferGetText, "gtk_text_buffer_get_text"},
		{&gtkTextBufferPlaceCursor, "gtk_text_buffer_place_cursor"}, {&gtkTextBufferGetInsert, "gtk_text_buffer_get_insert"},
		{&gtkScrolledWindowNew, "gtk_scrolled_window_new"},
		{&gtkScrolledSetMinHeight, "gtk_scrolled_window_set_min_content_height"},
		{&gtkScrolledSetShadow, "gtk_scrolled_window_set_shadow_type"},
		{&gtkImageNewFromPixbuf, "gtk_image_new_from_pixbuf"}, {&gtkDrawingAreaNew, "gtk_drawing_area_new"},
		{&gtkSeparatorNew, "gtk_separator_new"}, {&gtkWidgetQueueDraw, "gtk_widget_queue_draw"},
		{&gtkWidgetSetSizeRequest, "gtk_widget_set_size_request"}, {&gtkWidgetSetMarginTop, "gtk_widget_set_margin_top"},
		{&gtkWidgetShowAll, "gtk_widget_show_all"}, {&gtkWidgetSetVisible, "gtk_widget_set_visible"},
		{&gtkWidgetGetVisible, "gtk_widget_get_visible"}, {&gtkWidgetGetMapped, "gtk_widget_get_mapped"},
		{&gtkWidgetSetNoShowAll, "gtk_widget_set_no_show_all"}, {&gtkWidgetSetSensitive, "gtk_widget_set_sensitive"},
		{&gtkWidgetGetSensitive, "gtk_widget_get_sensitive"},
		{&gtkWidgetSetCanFocus, "gtk_widget_set_can_focus"}, {&gtkWidgetSetCanDefault, "gtk_widget_set_can_default"},
		{&gtkWidgetGrabFocus, "gtk_widget_grab_focus"}, {&gtkWidgetDestroy, "gtk_widget_destroy"},
		{&gtkWidgetGetWindow, "gtk_widget_get_window"}, {&gtkWidgetGetAllocW, "gtk_widget_get_allocated_width"},
		{&gtkWidgetGetAllocH, "gtk_widget_get_allocated_height"},
		{&gtkWidgetGetStyleContext, "gtk_widget_get_style_context"}, {&gtkWidgetSetVisual, "gtk_widget_set_visual"},
		{&gtkWidgetSetAppPaintable, "gtk_widget_set_app_paintable"},
		{&gtkWidgetInputShape, "gtk_widget_input_shape_combine_region"},
		{&gtkWidgetGetScaleFactor, "gtk_widget_get_scale_factor"},
		{&gtkWidgetGetPreferredSize, "gtk_widget_get_preferred_size"}, {&gtkWidgetSetHalign, "gtk_widget_set_halign"},
		{&gtkStyleContextAddClass, "gtk_style_context_add_class"}, {&gtkBinGetChild, "gtk_bin_get_child"},
		{&gtkSettingsGetDefault, "gtk_settings_get_default"}, {&gtkCSSProviderNew, "gtk_css_provider_new"},
		{&gtkCSSProviderLoadData, "gtk_css_provider_load_from_data"},
		{&gtkStyleContextAddScreen, "gtk_style_context_add_provider_for_screen"},
		{&gtkShowURIOnWindow, "gtk_show_uri_on_window"},
		{&gdkPixbufNewFromBytes, "gdk_pixbuf_new_from_bytes"}, // libgtk bağımlılık ağacından
	}
}

func gdkSyms() []sym {
	return []sym{
		{&gdkSetAllowedBackends, "gdk_set_allowed_backends"},
		{&gdkScreenGetDefault, "gdk_screen_get_default"}, {&gdkScreenGetRGBAVisual, "gdk_screen_get_rgba_visual"},
		{&gdkScreenIsComposited, "gdk_screen_is_composited"}, {&gdkDisplayGetDefault, "gdk_display_get_default"},
		{&gdkDisplayGetNMonitors, "gdk_display_get_n_monitors"}, {&gdkDisplayGetMonitor, "gdk_display_get_monitor"},
		{&gdkDisplayMonitorAtWindow, "gdk_display_get_monitor_at_window"},
		{&gdkDisplayMonitorAtPoint, "gdk_display_get_monitor_at_point"},
		{&gdkDisplayGetDefaultSeat, "gdk_display_get_default_seat"}, {&gdkSeatGetPointer, "gdk_seat_get_pointer"},
		{&gdkDeviceGetPosition, "gdk_device_get_position"}, {&gdkMonitorGetGeometry, "gdk_monitor_get_geometry"},
		{&gdkMonitorGetWorkarea, "gdk_monitor_get_workarea"}, {&gdkMonitorIsPrimary, "gdk_monitor_is_primary"},
		{&gdkWindowRaise, "gdk_window_raise"}, {&gdkWindowIsViewable, "gdk_window_is_viewable"},
		{&gdkWindowGetState, "gdk_window_get_state"}, {&gdkEventGetSourceDevice, "gdk_event_get_source_device"},
		{&gdkX11DeviceGetID, "gdk_x11_device_get_id"}, {&gdkX11WindowGetXID, "gdk_x11_window_get_xid"},
	}
}

func cairoSyms() []sym {
	return []sym{
		{&cairoSetSourceRGBA, "cairo_set_source_rgba"}, {&cairoSetOperator, "cairo_set_operator"},
		{&cairoPaint, "cairo_paint"}, {&cairoRectangle, "cairo_rectangle"}, {&cairoFill, "cairo_fill"},
		{&cairoStroke, "cairo_stroke"}, {&cairoSetLineWidth, "cairo_set_line_width"}, {&cairoMoveTo, "cairo_move_to"},
		{&cairoLineTo, "cairo_line_to"}, {&cairoArc, "cairo_arc"}, {&cairoSelectFontFace, "cairo_select_font_face"},
		{&cairoSetFontSize, "cairo_set_font_size"}, {&cairoShowText, "cairo_show_text"},
		{&cairoTextExtents, "cairo_text_extents"}, {&cairoRegionCreate, "cairo_region_create"},
		{&cairoRegionDestroy, "cairo_region_destroy"}, {&cairoSetLineJoin, "cairo_set_line_join"},
		{&cairoNewPath, "cairo_new_path"}, {&cairoSetSourceRGB, "cairo_set_source_rgb"},
	}
}

// cstr güvenli C dizgisi: geçersiz UTF-8 ve NUL temizlenir, uzunluk sınırlanır (ağdan gelen metin; FFI kuralı 6).
func cstr(s string) *byte {
	p, err := glib.CString(clean(s))
	if err != nil {
		p, _ = glib.CString("")
	}
	return p
}

// cptr C adresini unsafe.Pointer'a çevirir (yalnız geri çağrı süresince geçerli C belleği okunur).
func cptr(p uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&p)) }

// --- sinyal geri çağrıları (FFI kuralı 3: init'te, sabit sayıda; yalnız ana iş parçacığında çağrılır) -----------------

type sigKind int

const (
	sigClicked sigKind = iota
	sigActivate
	sigChanged
	sigToggled
	sigDestroy
	sigPress
	sigRelease
	sigDelete
	sigKey
	sigState
	sigDraw
	sigNotify
	sigCount
)

var sigNames = [sigCount]string{"clicked", "activate", "changed", "toggled", "destroy", "button-press-event",
	"button-release-event", "delete-event", "key-press-event", "window-state-event", "draw", "notify::gtk-theme-name"}

// Geri çağrı tabloları (yalnız ana iş parçacığı). Anahtar: GTK nesnesinin C adresi (Go işaretçisi C'ye verilmez).
// Bir nesnenin kayıtları "destroy"da silinir: GTK adresleri yeniden kullanır, bayat bir işlev yeni bir denetime
// bağlanmamalıdır.
var (
	voidFns  [sigCount]map[uintptr]func()
	eventFns [sigCount]map[uintptr]func(ev uintptr) bool
	tramps   [sigCount]uintptr
	tracked  = map[uintptr]bool{}
)

func init() {
	for i := range sigCount {
		voidFns[i] = map[uintptr]func(){}
		eventFns[i] = map[uintptr]func(uintptr) bool{}
	}
	mkVoid := func(k sigKind) uintptr {
		return purego.NewCallback(func(w, _ uintptr) uintptr {
			if fn := voidFns[k][w]; fn != nil {
				fn()
			}
			if k == sigDestroy {
				forget(w)
			}
			return 0
		})
	}
	mkEvent := func(k sigKind) uintptr {
		return purego.NewCallback(func(w, ev, _ uintptr) uintptr {
			if fn := eventFns[k][w]; fn != nil && fn(ev) {
				return 1
			}
			return 0
		})
	}
	for _, k := range []sigKind{sigClicked, sigActivate, sigChanged, sigToggled, sigDestroy} {
		tramps[k] = mkVoid(k)
	}
	for _, k := range []sigKind{sigPress, sigRelease, sigDelete, sigKey, sigState, sigDraw} {
		tramps[k] = mkEvent(k)
	}
	// notify::… (GObject*, GParamSpec*, gpointer) → void; olay işlevi tablosu kullanılır, dönüş yok sayılır.
	tramps[sigNotify] = purego.NewCallback(func(w, _, _ uintptr) uintptr {
		if fn := eventFns[sigNotify][w]; fn != nil {
			fn(0)
		}
		return 0
	})
}

func forget(w uintptr) {
	for i := range sigCount {
		delete(voidFns[i], w)
		delete(eventFns[i], w)
	}
	delete(tracked, w)
	delete(presses, w)
}

// track nesnenin destroy'unda tabloların temizlenmesi (bir kez bağlanır).
func track(w uintptr) {
	if tracked[w] {
		return
	}
	if _, err := glib.SignalConnect(w, sigNames[sigDestroy], tramps[sigDestroy]); err == nil {
		tracked[w] = true
	}
}

// on void sinyal bağlar (bağlanamazsa false; korunan denetim çağıranında fail-closed).
func on(w uintptr, k sigKind, fn func()) bool {
	if k != sigDestroy {
		track(w)
	}
	if _, ok := voidFns[k][w]; !ok {
		if _, err := glib.SignalConnect(w, sigNames[k], tramps[k]); err != nil {
			return false
		}
	}
	voidFns[k][w] = fn
	return true
}

// onEvent olaylı sinyal bağlar (fn true → olay tüketildi).
func onEvent(w uintptr, k sigKind, fn func(ev uintptr) bool) bool {
	if k != sigNotify { // GtkSettings bir widget değil (destroy yok)
		track(w)
	}
	if _, ok := eventFns[k][w]; !ok {
		if _, err := glib.SignalConnect(w, sigNames[k], tramps[k]); err != nil {
			return false
		}
	}
	eventFns[k][w] = fn
	return true
}

// ptrAt C belleğinde sabit ofset (yalnız geri çağrı süresince geçerli olay yapısı).
func ptrAt(p unsafe.Pointer, off int) unsafe.Pointer { return unsafe.Add(p, off) }
