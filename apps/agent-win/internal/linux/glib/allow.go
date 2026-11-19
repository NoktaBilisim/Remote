package glib

import (
	"errors"
	"path"
	"strings"
)

// LibDir izin verilen tek kitaplık dizini (Ubuntu x86_64 multiarch; mimari-p28g §1 kısıtlar, ADR-0038 m.1).
const LibDir = "/usr/lib/x86_64-linux-gnu/"

// Kitaplık adları (soname). İzin listesi ADR-0038 m.1 + r2 (libX11/libXi/libXtst) ile birebirdir.
const (
	LibGLib        = "libglib-2.0.so.0"
	LibGObject     = "libgobject-2.0.so.0"
	LibGIO         = "libgio-2.0.so.0"
	LibGTK         = "libgtk-3.so.0"
	LibGDK         = "libgdk-3.so.0"
	LibPango       = "libpango-1.0.so.0"
	LibCairo       = "libcairo.so.2"
	LibGStreamer   = "libgstreamer-1.0.so.0"
	LibGstApp      = "libgstapp-1.0.so.0"
	LibGstVideo    = "libgstvideo-1.0.so.0"
	LibPulseSimple = "libpulse-simple.so.0"
	LibX11         = "libX11.so.6"
	LibXi          = "libXi.so.6"
	LibXtst        = "libXtst.so.6"
)

var allowed = map[string]bool{
	LibGLib: true, LibGObject: true, LibGIO: true, LibGTK: true, LibGDK: true, LibPango: true, LibCairo: true,
	LibGStreamer: true, LibGstApp: true, LibGstVideo: true, LibPulseSimple: true, LibX11: true, LibXi: true, LibXtst: true,
}

// ErrNotAllowed yol izin listesinde değil.
var ErrNotAllowed = errors.New("glib: kütüphane yolu izin listesinde değil")

// Allowed yol izin listesinde mi: tam olarak LibDir + izinli soname (temizlenmiş, mutlak, alt dizin yok). Yol POSIX
// yoludur: path.Clean (filepath.Clean Windows'ta "/" → "\\" çevirir; K10 qa m.1).
func Allowed(p string) bool {
	name, ok := strings.CutPrefix(p, LibDir)
	return ok && path.Clean(p) == p && allowed[name]
}

// Path izinli soname'in mutlak yolu.
func Path(soname string) string { return LibDir + soname }
