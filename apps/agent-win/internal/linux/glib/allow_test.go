package glib

import "testing"

// mimari-p28g §5.1 T5 / ADR-0038 m.1: yalnız sabit dizin + izinli soname; göreli, başka dizin, `..`, `//` ret.
func TestP28gK1AllowedLibraries(t *testing.T) {
	for _, ok := range []string{LibGLib, LibGObject, LibGIO, LibGTK, LibGDK, LibPango, LibCairo, LibGStreamer, LibGstApp,
		LibGstVideo, LibPulseSimple, LibX11, LibXi, LibXtst} {
		if !Allowed(Path(ok)) {
			t.Errorf("izinli olmalı: %s", ok)
		}
	}
	for _, bad := range []string{
		"libglib-2.0.so.0", "./libglib-2.0.so.0", "/usr/lib/libglib-2.0.so.0",
		"/usr/lib/aarch64-linux-gnu/libglib-2.0.so.0", "/usr/local/lib/x86_64-linux-gnu/libglib-2.0.so.0",
		"/usr/lib/x86_64-linux-gnu//libglib-2.0.so.0", "/usr/lib/x86_64-linux-gnu/../x86_64-linux-gnu/libglib-2.0.so.0",
		"/usr/lib/x86_64-linux-gnu/gstreamer-1.0/libgstximagesrc.so", "/usr/lib/x86_64-linux-gnu/libc.so.6",
		"/usr/lib/x86_64-linux-gnu/libglib-2.0.so", "/usr/lib/x86_64-linux-gnu/libX11.so.6 ", "/tmp/libX11.so.6", "",
	} {
		if Allowed(bad) {
			t.Errorf("izinli olmamalı: %q", bad)
		}
	}
}

// FFI kuralı 6: C'ye giden dizgi sınırlı, UTF-8, gömülü NUL yok; NUL sonlu kopya.
func TestP28gK1CString(t *testing.T) {
	p, err := CString("çğış")
	if err != nil {
		t.Fatal(err)
	}
	b := []byte("çğış")
	for i, c := range b {
		if got := *(*byte)(ptrAdd(p, i)); got != c {
			t.Fatalf("bayt %d: %x", i, got)
		}
	}
	if *(*byte)(ptrAdd(p, len(b))) != 0 {
		t.Fatal("NUL sonlu olmalı")
	}
	for _, bad := range []string{"a\x00b", "\xff", string(make([]byte, MaxStringBytes+1))} {
		if _, err := CString(bad); err == nil {
			t.Errorf("ret beklenirdi: %q", bad[:min(len(bad), 8)])
		}
	}
}
