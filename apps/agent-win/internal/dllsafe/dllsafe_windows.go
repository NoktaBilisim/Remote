//go:build windows

// Package dllsafe DLL arama sırasını System32 ile sınırlar (G-08, AC-118). İmzasız exe Downloads klasöründen
// çalıştığı için aynı klasöre bırakılan sahte DLL'in (DLL hijacking) yüklenmemesi gerekir. `main`'in ilk işidir.
package dllsafe

import "golang.org/x/sys/windows"

// Harden uygulama klasörünü ve CWD'yi DLL aramasından çıkarır; sonraki tüm LoadLibrary çağrıları yalnız System32'ye
// bakar. Üçüncü parti DLL yükleme yolu yalnız `windows.NewLazySystemDLL` olmalıdır (ADR-0010).
func Harden() error {
	if err := windows.SetDefaultDllDirectories(windows.LOAD_LIBRARY_SEARCH_SYSTEM32); err != nil {
		return err
	}
	// Eski API yolu (SearchPath/LoadLibrary bayraksız) için CWD'yi de kaldır.
	return windows.SetDllDirectory("")
}
