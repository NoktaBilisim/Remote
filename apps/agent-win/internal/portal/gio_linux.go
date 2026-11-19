//go:build linux

package portal

import (
	"errors"
	"sync"
	"unsafe"

	"remote-support/agent-win/internal/linux/glib"
)

// libgio GSettings yedeği (mimari-p28g §13 S-P28g-1 m.2): portal Settings arayüzü yoksa ya da şemayı sunmuyorsa değer
// doğrudan GSettings'ten okunur (dconf: yalnız okuma). Şema yoksa g_settings_new abort eder; bu yüzden önce
// g_settings_schema_source_lookup + g_settings_schema_has_key. Çağrılar ana iş parçacığında yapılır (onMain).
var gio struct {
	once sync.Once
	err  error

	sourceDefault func() uintptr
	sourceLookup  func(src uintptr, id *byte, recursive int32) uintptr
	schemaHasKey  func(schema uintptr, key *byte) int32
	schemaUnref   func(schema uintptr)
	settingsNew   func(id *byte) uintptr
	getValue      func(s uintptr, key *byte) uintptr
	typeString    func(v uintptr) uintptr
	getBoolean    func(v uintptr) int32
	getString     func(v uintptr, n uintptr) uintptr
	getStrv       func(v uintptr, n *uint64) unsafe.Pointer
	variantUnref  func(v uintptr)
	objectUnref   func(o uintptr)
	free          func(p unsafe.Pointer)
}

func bindGIO() error {
	gio.once.Do(func() {
		h, err := glib.Open(glib.Path(glib.LibGIO))
		hg, err2 := glib.Open(glib.Path(glib.LibGLib))
		ho, err3 := glib.Open(glib.Path(glib.LibGObject))
		if gio.err = errors.Join(err, err2, err3); gio.err != nil {
			return
		}
		gio.err = errors.Join(
			glib.Func(&gio.sourceDefault, h, "g_settings_schema_source_get_default"),
			glib.Func(&gio.sourceLookup, h, "g_settings_schema_source_lookup"),
			glib.Func(&gio.schemaHasKey, h, "g_settings_schema_has_key"),
			glib.Func(&gio.schemaUnref, h, "g_settings_schema_unref"),
			glib.Func(&gio.settingsNew, h, "g_settings_new"),
			glib.Func(&gio.getValue, h, "g_settings_get_value"),
			glib.Func(&gio.typeString, hg, "g_variant_get_type_string"),
			glib.Func(&gio.getBoolean, hg, "g_variant_get_boolean"),
			glib.Func(&gio.getString, hg, "g_variant_get_string"),
			glib.Func(&gio.getStrv, hg, "g_variant_get_strv"),
			glib.Func(&gio.variantUnref, hg, "g_variant_unref"),
			glib.Func(&gio.objectUnref, ho, "g_object_unref"),
			glib.Func(&gio.free, hg, "g_free"),
		)
	})
	return gio.err
}

// GIOReader libgio okuyucusu; her okuma onMain ile ana iş parçacığında yapılır.
func GIOReader(onMain func(func()) error) Reader {
	return func(ns, key string) (any, error) {
		if bindGIO() != nil {
			return nil, errSetting
		}
		var v any
		var rerr error = errSetting
		if err := onMain(func() { v, rerr = gioRead(ns, key) }); err != nil {
			return nil, errSetting
		}
		return v, rerr
	}
}

// strvMax okunan dizi uzunluğu üst sınırı (kısayol listesi birkaç öğedir).
const strvMax = 64

func gioRead(ns, key string) (any, error) {
	cns, err1 := glib.CString(ns)
	ckey, err2 := glib.CString(key)
	if err1 != nil || err2 != nil {
		return nil, errSetting
	}
	src := gio.sourceDefault()
	if src == 0 {
		return nil, errSetting
	}
	schema := gio.sourceLookup(src, cns, 1)
	if schema == 0 {
		return nil, errSetting
	}
	has := gio.schemaHasKey(schema, ckey) != 0
	gio.schemaUnref(schema)
	if !has {
		return nil, errSetting
	}
	s := gio.settingsNew(cns)
	if s == 0 {
		return nil, errSetting
	}
	defer gio.objectUnref(s)
	v := gio.getValue(s, ckey)
	if v == 0 {
		return nil, errSetting
	}
	defer gio.variantUnref(v)
	switch glib.GoString(gio.typeString(v)) {
	case "b":
		return gio.getBoolean(v) != 0, nil
	case "s":
		return glib.GoString(gio.getString(v, 0)), nil
	case "as":
		var n uint64
		arr := gio.getStrv(v, &n) // kapsayıcı g_free; dizgiler varyantın
		if arr == nil {
			return nil, errSetting
		}
		defer gio.free(arr)
		out := make([]string, 0, min(n, strvMax))
		for _, p := range unsafe.Slice((*uintptr)(arr), min(n, strvMax)) {
			out = append(out, glib.GoString(p))
		}
		return out, nil
	}
	return nil, errSetting
}
