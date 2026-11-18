//go:build linux

package capture

import (
	"errors"
	"sync"
	"unsafe"

	"remote-support/agent-win/internal/linux/glib"
)

// P28g K2 GStreamer FFI (mimari-p28g §4.4, ADR-0038 m.2/m.3): çekme kipi (gst_app_sink_try_pull_sample), veri yolu
// yoklaması (gst_bus_timed_pop_filtered), C geri çağrısı yok. Değişken argümanlı g_object_set yok
// (gst_util_set_object_arg). GstMapInfo Go belleğinde, içinde Go işaretçisi yok, işaretçiyle verilir.

// GStreamer sabitleri (gstelement.h, gstmessage.h, gstiterator.h, gstmemory.h).
const (
	gstStateNull      = 1
	gstStatePlaying   = 4
	gstChangeFailure  = 0
	gstMsgEOS         = 1
	gstMsgError       = 2
	gstIterDone       = 0
	gstIterOK         = 1
	gstIterResync     = 2
	gstMapRead        = 1
	gstClockNone      = ^uint64(0)
	gstStateWait      = 5_000_000_000 // ns
	gstMaxIterElement = 64
)

// mapInfo GstMapInfo (gstmemory.h): memory, flags, data, size, maxsize, user_data[4], _gst_reserved[4].
type mapInfo struct {
	_    uintptr // memory
	_    int32   // flags
	_    int32
	data uintptr
	size uint64
	_    uint64     // maxsize
	_    [4]uintptr // user_data
	_    [4]uintptr // _gst_reserved
}

// gValue GValue (GType + 2 × 8 bayt veri); G_VALUE_INIT = sıfır.
type gValue [3]uint64

var gst struct {
	once sync.Once
	err  error

	init         func(argc, argv uintptr)
	parseLaunch  func(desc *byte, gerr *uintptr) uintptr
	binGet       func(bin uintptr, name *byte) uintptr
	setState     func(e uintptr, st int32) int32
	getState     func(e uintptr, st, pend *int32, timeout uint64) int32
	sendEvent    func(e, ev uintptr) bool
	setArg       func(obj uintptr, name, value *byte)
	getBus       func(e uintptr) uintptr
	busPop       func(bus uintptr, timeout uint64, types int32) uintptr
	objectUnref  func(o uintptr)
	miniUnref    func(o uintptr)
	sampleBuffer func(s uintptr) uintptr
	bufMap       func(b uintptr, mi *mapInfo, flags int32) bool
	bufUnmap     func(b uintptr, mi *mapInfo)
	iterRecurse  func(bin uintptr) uintptr
	iterNext     func(it uintptr, v *gValue) int32
	iterResync   func(it uintptr)
	iterFree     func(it uintptr)
	factory      func(e uintptr) uintptr
	objectName   func(o uintptr) uintptr
	pull         func(sink uintptr, timeout uint64) uintptr
	forceKey     func(ts uint64, all bool, count uint32) uintptr
	valueObject  func(v *gValue) uintptr
	valueUnset   func(v *gValue)
	errorFree    func(e uintptr)
}

var errGst = errors.New("capture: GStreamer yüklenemedi")

// loadGst GStreamer'ı (yalnız paylaşım başlarken; §7 açılış) izin listeli yoldan yükler ve gst_init çağırır (bir kez).
// Ortam (kayıt yolu, eklenti dizini, tarayıcı) K1'de C kitaplıkları yüklenmeden önce ayarlanmıştır.
func loadGst() error {
	gst.once.Do(func() {
		var hs [5]uintptr
		for i, lib := range []string{glib.LibGStreamer, glib.LibGstApp, glib.LibGstVideo, glib.LibGObject, glib.LibGLib} {
			h, err := glib.Open(glib.Path(lib))
			if err != nil {
				gst.err = errGst
				return
			}
			hs[i] = h
		}
		g, app, vid, gobj, gl := hs[0], hs[1], hs[2], hs[3], hs[4]
		if errors.Join(
			glib.Func(&gst.init, g, "gst_init"), glib.Func(&gst.parseLaunch, g, "gst_parse_launch"),
			glib.Func(&gst.binGet, g, "gst_bin_get_by_name"), glib.Func(&gst.setState, g, "gst_element_set_state"),
			glib.Func(&gst.getState, g, "gst_element_get_state"), glib.Func(&gst.sendEvent, g, "gst_element_send_event"),
			glib.Func(&gst.setArg, g, "gst_util_set_object_arg"), glib.Func(&gst.getBus, g, "gst_element_get_bus"),
			glib.Func(&gst.busPop, g, "gst_bus_timed_pop_filtered"), glib.Func(&gst.objectUnref, g, "gst_object_unref"),
			glib.Func(&gst.miniUnref, g, "gst_mini_object_unref"), glib.Func(&gst.sampleBuffer, g, "gst_sample_get_buffer"),
			glib.Func(&gst.bufMap, g, "gst_buffer_map"), glib.Func(&gst.bufUnmap, g, "gst_buffer_unmap"),
			glib.Func(&gst.iterRecurse, g, "gst_bin_iterate_recurse"), glib.Func(&gst.iterNext, g, "gst_iterator_next"),
			glib.Func(&gst.iterResync, g, "gst_iterator_resync"), glib.Func(&gst.iterFree, g, "gst_iterator_free"),
			glib.Func(&gst.factory, g, "gst_element_get_factory"), glib.Func(&gst.objectName, g, "gst_object_get_name"),
			glib.Func(&gst.pull, app, "gst_app_sink_try_pull_sample"),
			glib.Func(&gst.forceKey, vid, "gst_video_event_new_upstream_force_key_unit"),
			glib.Func(&gst.valueObject, gobj, "g_value_get_object"), glib.Func(&gst.valueUnset, gobj, "g_value_unset"),
			glib.Func(&gst.errorFree, gl, "g_error_free"),
		) != nil {
			gst.err = errGst
			return
		}
		gst.init(0, 0)
	})
	return gst.err
}

// gstPipe çalışan boru hattı ve adlı öğeleri (her biri bizim başvurumuz; close bırakır).
type gstPipe struct {
	pipe, mainSink, lowSink, enc, valve, bus uintptr
}

var errPipe = &Error{Reason: ReasonOther, Op: "GstPipeline"}

// startPipe dizgiyi ayrıştırır, öğe beyaz listesini çalışan hatta denetler (T6 ikinci katman), adlı öğeleri alır ve
// PLAYING'e geçirir. Hata yolunda her şey bırakılır.
func startPipe(desc string) (*gstPipe, error) {
	if err := loadGst(); err != nil {
		return nil, &Error{Reason: ReasonOther, Op: "LoadGStreamer"}
	}
	cd, err := glib.CString(desc)
	if err != nil {
		return nil, errPipe
	}
	var gerr uintptr
	pipe := gst.parseLaunch(cd, &gerr)
	if gerr != 0 {
		gst.errorFree(gerr)
		if pipe != 0 {
			gst.objectUnref(pipe)
		}
		return nil, errPipe
	}
	if pipe == 0 {
		return nil, errPipe
	}
	p := &gstPipe{pipe: pipe}
	if !p.elementsAllowed() {
		p.close()
		return nil, &Error{Reason: ReasonOther, Op: "GstAllowList"}
	}
	for _, e := range []struct {
		dst  *uintptr
		name string
	}{{&p.mainSink, "mainsink"}, {&p.lowSink, "lowsink"}, {&p.enc, "main"}, {&p.valve, "lowvalve"}} {
		n, _ := glib.CString(e.name)
		if *e.dst = gst.binGet(pipe, n); *e.dst == 0 {
			p.close()
			return nil, errPipe
		}
	}
	p.bus = gst.getBus(pipe)
	if p.bus == 0 || gst.setState(pipe, gstStatePlaying) == gstChangeFailure {
		p.close()
		return nil, errPipe
	}
	var st, pend int32
	if gst.getState(pipe, &st, &pend, gstStateWait) == gstChangeFailure {
		p.close()
		return nil, errPipe
	}
	return p, nil
}

// elementsAllowed çalışan hattaki (iç içe dahil) her öğenin fabrika adı gstAllowed'da mı (§5.1 T6).
func (p *gstPipe) elementsAllowed() bool {
	it := gst.iterRecurse(p.pipe)
	if it == 0 {
		return false
	}
	defer gst.iterFree(it)
	var names []string
	for range gstMaxIterElement * 2 {
		var v gValue
		switch gst.iterNext(it, &v) {
		case gstIterOK:
			name := ""
			if f := gst.factory(gst.valueObject(&v)); f != 0 {
				np := gst.objectName(f)
				name = glib.GoString(np)
				glib.Free(np)
			}
			gst.valueUnset(&v)
			names = append(names, name)
			if len(names) > gstMaxIterElement {
				return false
			}
		case gstIterResync:
			gst.iterResync(it)
			names = names[:0]
		case gstIterDone:
			return factoriesAllowed(names)
		default:
			return false
		}
	}
	return false
}

// pull appsink'ten bir kodlanmış kare (timeout ns); yoksa nil. Kare Go belleğine kopyalanır.
func pull(sink uintptr, timeout uint64) []byte {
	s := gst.pull(sink, timeout)
	if s == 0 {
		return nil
	}
	defer gst.miniUnref(s)
	b := gst.sampleBuffer(s)
	if b == 0 {
		return nil
	}
	var mi mapInfo
	if !gst.bufMap(b, &mi, gstMapRead) {
		return nil
	}
	defer gst.bufUnmap(b, &mi)
	if mi.data == 0 || mi.size == 0 || mi.size > 64<<20 {
		return nil
	}
	base := *(*unsafe.Pointer)(unsafe.Pointer(&mi.data)) // C belleği (unmap öncesi kopyalanır)
	return append([]byte(nil), unsafe.Slice((*byte)(base), int(mi.size))...)
}

// failed veri yolunda ERROR ya da EOS var mı (bekletmeden).
func (p *gstPipe) failed() bool {
	m := gst.busPop(p.bus, 0, gstMsgEOS|gstMsgError)
	if m == 0 {
		return false
	}
	gst.miniUnref(m)
	return true
}

// forceKey ilgili appsink'e yukarı yönlü anahtar kare olayı (§4.4).
func forceKey(sink uintptr) {
	if ev := gst.forceKey(gstClockNone, true, 0); ev != 0 {
		gst.sendEvent(sink, ev) // olayın sahipliği öğeye geçer
	}
}

// setProp gst_util_set_object_arg(obj, name, value).
func setProp(obj uintptr, name, value string) {
	n, err1 := glib.CString(name)
	v, err2 := glib.CString(value)
	if err1 == nil && err2 == nil {
		gst.setArg(obj, n, v)
	}
}

// close hattı NULL'a alır ve başvuruları bırakır (bir kez çağrılır).
func (p *gstPipe) close() {
	if p.pipe != 0 {
		gst.setState(p.pipe, gstStateNull)
	}
	for _, o := range []*uintptr{&p.mainSink, &p.lowSink, &p.enc, &p.valve, &p.bus, &p.pipe} {
		if *o != 0 {
			gst.objectUnref(*o)
			*o = 0
		}
	}
}
