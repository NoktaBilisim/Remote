//go:build darwin

// Package mac P33 K0s spike'ının ortak yardımcıları: C belleği (malloc/free), CoreFoundation okuma işlevleri,
// App Nap kapatma. Ürün koduna girmez; çerçeveler internal/darwin/objc izin listesinden açılır.
package mac

import (
	"fmt"
	"os"
	"runtime"
	"unsafe"

	pobjc "github.com/ebitengine/purego/objc"

	"remote-support/agent-win/internal/darwin/objc"
)

func init() { runtime.LockOSThread() }

var (
	malloc func(n uintptr) uintptr
	free   func(p uintptr)

	CFRelease          func(p uintptr)
	CFArrayCount       func(a uintptr) int
	CFArrayAt          func(a uintptr, i int) uintptr
	CFDictGet          func(d, k uintptr) uintptr
	CFNumberGet        func(n uintptr, typ int, out unsafe.Pointer) bool
	CFBooleanValue     func(b uintptr) bool
	CFGetTypeID        func(p uintptr) uintptr
	CFNumberTypeID     func() uintptr
	CFBooleanTypeID    func() uintptr
	CFStringTypeID     func() uintptr
	CFDictionaryTypeID func() uintptr
	CFPrefsCopyApp     func(key, app uintptr) uintptr
	CFPrefsSync        func(app uintptr) bool
)

// Must sembol bağlama hatasında çıkar (spike).
func Must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "bağlama:", err)
		os.Exit(2)
	}
}

func init() {
	sys, err := objc.Open(objc.LibSystem)
	Must(err)
	Must(objc.Func(&malloc, sys, "malloc"))
	Must(objc.Func(&free, sys, "free"))
	cf, err := objc.Framework("CoreFoundation")
	Must(err)
	Must(objc.Func(&CFRelease, cf, "CFRelease"))
	Must(objc.Func(&CFArrayCount, cf, "CFArrayGetCount"))
	Must(objc.Func(&CFArrayAt, cf, "CFArrayGetValueAtIndex"))
	Must(objc.Func(&CFDictGet, cf, "CFDictionaryGetValue"))
	Must(objc.Func(&CFNumberGet, cf, "CFNumberGetValue"))
	Must(objc.Func(&CFBooleanValue, cf, "CFBooleanGetValue"))
	Must(objc.Func(&CFGetTypeID, cf, "CFGetTypeID"))
	Must(objc.Func(&CFNumberTypeID, cf, "CFNumberGetTypeID"))
	Must(objc.Func(&CFBooleanTypeID, cf, "CFBooleanGetTypeID"))
	Must(objc.Func(&CFStringTypeID, cf, "CFStringGetTypeID"))
	Must(objc.Func(&CFDictionaryTypeID, cf, "CFDictionaryGetTypeID"))
	Must(objc.Func(&CFPrefsCopyApp, cf, "CFPreferencesCopyAppValue"))
	Must(objc.Func(&CFPrefsSync, cf, "CFPreferencesAppSynchronize"))
	_, err = objc.Framework("Foundation")
	Must(err)
}

// CMem C yığınında ayrılmış bellek (C'nin çağrı sonrasında da tuttuğu tamponlar için; Go işaretçisi C'ye bırakılmaz).
type CMem struct {
	P uintptr
	N int
}

// Alloc n baytlık sıfırlanmış C belleği.
func Alloc(n int) CMem {
	p := malloc(uintptr(n))
	if p == 0 {
		panic("malloc")
	}
	m := CMem{P: p, N: n}
	clear(m.Bytes())
	return m
}

// Bytes C belleğinin Go görünümü (yalnız yaşam süresi boyunca).
func (m CMem) Bytes() []byte { return unsafe.Slice((*byte)(ptr(m.P)), m.N) }

// Free belleği bırakır.
func (m CMem) Free() { free(m.P) }

// ptr uintptr → unsafe.Pointer (C belleği; Go GC'si taşımaz). Spike: vet uyarısı bilinçli.
func ptr(p uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&p)) }

// Ptr dışa açık sarmalayıcı.
func Ptr(p uintptr) unsafe.Pointer { return ptr(p) }

// NoAppNap UserInitiated + LatencyCritical etkinliği (P28f K0s-1 bulgusu: arka planda 7,6 fps).
func NoAppNap(reason string) objc.ID {
	var act objc.ID
	objc.Pool(func() {
		pi, _ := objc.GetClass("NSProcessInfo")
		info := objc.ID(pi).Send(objc.Sel("processInfo"))
		r, _ := objc.NSString(reason)
		const opts = uint64(0x00FFFFFF) | uint64(0xFF00000000) // UserInitiated | LatencyCritical
		act = info.Send(objc.Sel("beginActivityWithOptions:reason:"), opts, r)
		act.Send(objc.Sel("retain"))
	})
	return act
}

// CFNum CFNumber → float64 (ok=false değilse).
func CFNum(n uintptr) (float64, bool) {
	if n == 0 {
		return 0, false
	}
	switch CFGetTypeID(n) {
	case CFNumberTypeID():
		var d float64
		if CFNumberGet(n, 13, unsafe.Pointer(&d)) { // kCFNumberDoubleType
			return d, true
		}
		var i int64
		CFNumberGet(n, 4, unsafe.Pointer(&i)) // kCFNumberSInt64Type
		return float64(i), true
	case CFBooleanTypeID():
		if CFBooleanValue(n) {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}

// CFStr CFString → Go (köprülü NSString).
func CFStr(s uintptr) string {
	if s == 0 || CFGetTypeID(s) != CFStringTypeID() {
		return ""
	}
	g, _ := objc.GoString(objc.ID(s))
	return g
}

// Describe herhangi bir CF/NS nesnesinin `description` metni (yalnız tanı).
func Describe(id uintptr) string {
	if id == 0 {
		return "<nil>"
	}
	var out string
	objc.Pool(func() {
		d := objc.ID(id).Send(objc.Sel("description"))
		out, _ = objc.GoString(d)
	})
	return out
}

// Send kısaltması.
func Send[T any](id objc.ID, sel string, args ...any) T {
	return pobjc.Send[T](id, objc.Sel(sel), args...)
}

// NSStr CF anahtarı için kalıcı NSString (retain edilir; spike süreç ömrü).
func NSStr(s string) uintptr {
	var id objc.ID
	objc.Pool(func() {
		id, _ = objc.NSString(s)
		id.Send(objc.Sel("retain"))
	})
	return uintptr(id)
}

// Pref CFPreferencesCopyAppValue(key, app); (değer açıklaması, var mı).
func Pref(app, key string) (string, bool) {
	a, k := NSStr(app), NSStr(key)
	CFPrefsSync(a)
	v := CFPrefsCopyApp(k, a)
	if v == 0 {
		return "", false
	}
	defer CFRelease(v)
	return Describe(v), true
}
