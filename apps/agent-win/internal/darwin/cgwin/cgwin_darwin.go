//go:build darwin

// Package cgwin P33 K2 (mimari-p33 K-P33-5, §6.3, §6.4): CoreGraphics pencere listesi sorguları. Pencere yakalama
// (capture) ve pencere modu girdi kapsamı (input) aynı tek kaynaktan okur. Yalnız sayısal alanlar okunur: başlık ve
// uygulama adı (kCGWindowName / kCGWindowOwnerName) bu pakette hiç okunmaz (S-P33-T-8). CGWindowListCopyWindowInfo
// Ekran Kaydı izni olmadan da sayısal alanları verir.
package cgwin

import (
	"errors"
	"sync"

	"remote-support/agent-win/internal/darwin/objc"
)

// CGWindowListOption (CGWindow.h).
const (
	optOnScreenOnly   = 1 << 0
	optExcludeDesktop = 1 << 4
)

// CFNumberType / tür kimlikleri.
const cfNumberSInt64 = 4

// Win tek pencerenin sayısal bilgisi. Bounds genel nokta koordinatında (birincil ekranın sol üstü 0,0; y aşağı).
type Win struct {
	ID       uint32
	PID      int32
	Layer    int
	OnScreen bool // kCGWindowIsOnscreen anahtarı var ve true
	Bounds   objc.CGRect
}

// ErrBind CoreGraphics/CoreFoundation bağlanamadı (sorgular fail-closed: yok/görünmez sayılır).
var ErrBind = errors.New("cgwin: CoreGraphics bağlanamadı")

var fn struct {
	list     func(opt, rel uint32) uintptr
	describe func(ids uintptr) uintptr
	arrNew   func(alloc uintptr, vals *uintptr, n int, cb uintptr) uintptr
	rectDict func(d uintptr, out *objc.CGRect) bool
	release  func(p uintptr)
	count    func(a uintptr) int
	at       func(a uintptr, i int) uintptr
	get      func(d, k uintptr) uintptr
	numGet   func(n uintptr, typ int, out *int64) bool
	boolGet  func(b uintptr) bool
	typeID   func(p uintptr) uintptr
	numTID   func() uintptr
	boolTID  func() uintptr
	dictTID  func() uintptr

	kNumber, kPID, kLayer, kOnScreen, kBounds uintptr
}

var bind = sync.OnceValue(func() error {
	cg, err := objc.Framework("CoreGraphics")
	if err != nil {
		return errors.Join(ErrBind, err)
	}
	cf, err := objc.Framework("CoreFoundation")
	if err != nil {
		return errors.Join(ErrBind, err)
	}
	if err := errors.Join(
		objc.Func(&fn.list, cg, "CGWindowListCopyWindowInfo"),
		objc.Func(&fn.describe, cg, "CGWindowListCreateDescriptionFromArray"),
		objc.Func(&fn.arrNew, cf, "CFArrayCreate"),
		objc.Func(&fn.rectDict, cg, "CGRectMakeWithDictionaryRepresentation"),
		objc.Func(&fn.release, cf, "CFRelease"),
		objc.Func(&fn.count, cf, "CFArrayGetCount"),
		objc.Func(&fn.at, cf, "CFArrayGetValueAtIndex"),
		objc.Func(&fn.get, cf, "CFDictionaryGetValue"),
		objc.Func(&fn.numGet, cf, "CFNumberGetValue"),
		objc.Func(&fn.boolGet, cf, "CFBooleanGetValue"),
		objc.Func(&fn.typeID, cf, "CFGetTypeID"),
		objc.Func(&fn.numTID, cf, "CFNumberGetTypeID"),
		objc.Func(&fn.boolTID, cf, "CFBooleanGetTypeID"),
		objc.Func(&fn.dictTID, cf, "CFDictionaryGetTypeID"),
	); err != nil {
		return errors.Join(ErrBind, err)
	}
	for _, k := range []struct {
		dst  *uintptr
		name string
	}{{&fn.kNumber, "kCGWindowNumber"}, {&fn.kPID, "kCGWindowOwnerPID"}, {&fn.kLayer, "kCGWindowLayer"},
		{&fn.kOnScreen, "kCGWindowIsOnscreen"}, {&fn.kBounds, "kCGWindowBounds"}} {
		v, err := objc.Symbol(cg, k.name)
		if err != nil || v == 0 {
			return errors.Join(ErrBind, err)
		}
		*k.dst = v
	}
	return nil
})

// Available CG sorguları bağlanabildi mi.
func Available() bool { return bind() == nil }

// Get tek pencere (CGWindowListCreateDescriptionFromArray: ekranda olmayan — küçültülmüş, gizli, başka Space —
// pencereyi de verir; kCGWindowListOptionIncludingWindow tek başına küçültülmüş pencereyi döndürmüyor, K2 ölçümü).
// Pencere yoksa ya da bağlama başarısızsa ok=false.
func Get(id uint32) (Win, bool) {
	if id == 0 || bind() != nil {
		return Win{}, false
	}
	vals := []uintptr{uintptr(id)} // CFArray değerleri ham CGWindowID (geri çağrısız dizi)
	ids := fn.arrNew(0, &vals[0], 1, 0)
	if ids == 0 {
		return Win{}, false
	}
	defer fn.release(ids)
	for _, w := range decode(fn.describe(ids)) {
		if w.ID == id {
			return w, true
		}
	}
	return Win{}, false
}

// OnScreen ekrandaki pencereler, önden arkaya (kCGWindowListOptionOnScreenOnly; masaüstü öğeleri hariç).
func OnScreen() []Win {
	if bind() != nil {
		return nil
	}
	return list(optOnScreenOnly|optExcludeDesktop, 0)
}

func list(opt, rel uint32) []Win { return decode(fn.list(opt, rel)) }

// decode CGWindowList sözlük dizisini (+1) okur ve bırakır.
func decode(arr uintptr) []Win {
	if arr == 0 {
		return nil
	}
	defer fn.release(arr)
	n := fn.count(arr)
	out := make([]Win, 0, n)
	for i := range n {
		d := fn.at(arr, i)
		if d == 0 || fn.typeID(d) != fn.dictTID() {
			continue
		}
		w := Win{ID: uint32(num(fn.get(d, fn.kNumber))), PID: int32(num(fn.get(d, fn.kPID))),
			Layer: int(num(fn.get(d, fn.kLayer)))}
		if b := fn.get(d, fn.kOnScreen); b != 0 && fn.typeID(b) == fn.boolTID() {
			w.OnScreen = fn.boolGet(b)
		} else if b != 0 && fn.typeID(b) == fn.numTID() {
			w.OnScreen = num(b) != 0
		}
		if r := fn.get(d, fn.kBounds); r == 0 || fn.typeID(r) != fn.dictTID() || !fn.rectDict(r, &w.Bounds) {
			w.Bounds = objc.CGRect{}
		}
		if w.ID != 0 {
			out = append(out, w)
		}
	}
	return out
}

// num CFNumber/CFBoolean → int64 (tür farklıysa 0).
func num(n uintptr) int64 {
	if n == 0 {
		return 0
	}
	switch fn.typeID(n) {
	case fn.numTID():
		var v int64
		if fn.numGet(n, cfNumberSInt64, &v) {
			return v
		}
	case fn.boolTID():
		if fn.boolGet(n) {
			return 1
		}
	}
	return 0
}
