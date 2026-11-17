//go:build darwin

package objc

import (
	"errors"
	"fmt"
	"regexp"
	"sync"

	"github.com/ebitengine/purego"
)

// İzin listesindeki kütüphaneler (FFI kuralı 7; mimari-p28f §5.1 T5).
const (
	LibObjC   = "/usr/lib/libobjc.A.dylib"
	LibSystem = "/usr/lib/libSystem.B.dylib"
)

var frameworkPath = regexp.MustCompile(`^/System/Library/Frameworks/([A-Za-z][A-Za-z0-9]*)\.framework/([A-Za-z][A-Za-z0-9]*)$`)

// ErrNotAllowed yol izin listesinde değil.
var ErrNotAllowed = errors.New("objc: kütüphane yolu izin listesinde değil")

var (
	libMu  sync.Mutex
	loaded = map[string]uintptr{}
)

// Allowed yol izin listesinde mi: yalnız mutlak sistem çerçevesi ikilisi (`<Ad>.framework/<Ad>`) ya da iki sistem
// kütüphanesi.
func Allowed(path string) bool {
	if path == LibObjC || path == LibSystem {
		return true
	}
	m := frameworkPath.FindStringSubmatch(path)
	return m != nil && m[1] == m[2]
}

// Open izin listesindeki kütüphaneyi bir kez açar (RTLD_NOW | RTLD_GLOBAL) ve tutamacını döner.
func Open(path string) (uintptr, error) {
	if !Allowed(path) {
		return 0, fmt.Errorf("%w: %q", ErrNotAllowed, path)
	}
	libMu.Lock()
	defer libMu.Unlock()
	if h, ok := loaded[path]; ok {
		return h, nil
	}
	h, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_GLOBAL)
	if err != nil {
		return 0, fmt.Errorf("objc: %s açılamadı: %w", path, err)
	}
	loaded[path] = h
	return h, nil
}

// Framework sistem çerçevesini adıyla açar (ör. "AppKit" → /System/Library/Frameworks/AppKit.framework/AppKit).
func Framework(name string) (uintptr, error) {
	return Open("/System/Library/Frameworks/" + name + ".framework/" + name)
}

// Func h kütüphanesindeki C işlevini fptr'ye bağlar; sembol yoksa hata (purego.RegisterLibFunc'ın paniği yerine,
// FFI kuralı 5).
func Func(fptr any, h uintptr, name string) error {
	sym, err := purego.Dlsym(h, name)
	if err != nil {
		return fmt.Errorf("objc: %s sembolü yok: %w", name, err)
	}
	purego.RegisterFunc(fptr, sym)
	return nil
}
