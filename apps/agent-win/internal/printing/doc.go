// Package printing uzaktan yazdırmanın Windows tarafıdır (P28a, mimari-p28 §5, ADR-0031). PDF yalnız bellekte,
// ayrı ve kısıtlı bir işleyici süreçte (`--pdf-isleyici`) Windows.Data.Pdf ile sayfa bitmap'ine çevrilir; GDI ile
// varsayılan yazıcıya basma üst süreçtedir.
//
// P28a-K0 prototip durumu: işleyici başlatma, boru protokolü, WinRT render ve GDI basma taslağıdır. Ortak
// job/jeton kodu (`internal/proclimit`), onay/akış bağlantısı ve sınır testi K4'ün işidir.
package printing
