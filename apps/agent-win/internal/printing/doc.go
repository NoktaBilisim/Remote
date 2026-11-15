// Package printing uzaktan yazdırmanın Windows tarafıdır (P28a, mimari-p28 §5, ADR-0031). PDF yalnız bellekte,
// ayrı ve kısıtlı bir işleyici süreçte (`--pdf-isleyici`; jeton/job internal/proclimit) Windows.Data.Pdf ile sayfa
// bitmap'ine çevrilir; GDI ile varsayılan yazıcıya basma (sayfa yönü ResetDCW) üst süreçtedir. Üst süreç işleyici
// çıktısını güvenilmeyen girdi sayar (r2 O-P28a-3). flow uyarlaması internal/clipprint'tedir.
package printing
