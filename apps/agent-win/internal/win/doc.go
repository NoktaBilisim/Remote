// Package win CGO'suz Win32 bağlamalarıdır (user32/gdi32/shell32). DLL'ler yalnız System32'den yüklenir
// (NewLazySystemDLL, G-08). Yalnız istemcinin kullandığı çağrılar vardır.
//
// Bellek kuralı (S6-1, unsafe.Pointer kural 4): Go belleğine işaret eden `uintptr(unsafe.Pointer(x))` dönüşümü
// yalnız `//go:uintptrescapes` işaretli bir çağrının (`LazyProc.Call`, capture `call`/`procHR`) argüman ifadesinde
// yazılır; yardımcı fonksiyonda dönüştürülüp döndürülmez. Kural `unsafeptr_test.go` ile tüm `internal/**` ve `cmd/**`
// için denetlenir.
package win
