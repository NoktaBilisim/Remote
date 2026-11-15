// Package proclimit kısıtlı yardımcı süreç başlatmanın ortak Windows kodudur (mimari-p28 §5.2): kısıtlı jeton
// (`CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)`, isteğe bağlı düşük bütünlük), job (tek süreç, kill-on-close,
// işlenmeyen istisnada ölüm, isteğe bağlı bellek ve UI sınırı) ve öznitelik listesi (HANDLE_LIST, alt süreç yasağı,
// mitigation). İki çağıran vardır: servis yardımcısı (`internal/servis`, P27) ve PDF işleyici (`internal/printing`).
package proclimit
