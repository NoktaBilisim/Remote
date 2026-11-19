package glib

import (
	"strings"
	"unsafe"
)

// GoString C'den okunan NUL sonlu dizginin sınırlı, UTF-8 doğrulanmış kopyası (FFI kuralı 6): en çok MaxStringBytes
// bayt okunur, geçersiz UTF-8 "�" ile değiştirilir. p == 0 → "". p yalnız çağrı süresince geçerli C belleğidir.
func GoString(p uintptr) string {
	if p == 0 {
		return ""
	}
	base := *(*unsafe.Pointer)(unsafe.Pointer(&p))
	n := 0
	for n < MaxStringBytes && *(*byte)(unsafe.Add(base, n)) != 0 {
		n++
	}
	return strings.ToValidUTF8(string(unsafe.Slice((*byte)(base), n)), "�")
}
