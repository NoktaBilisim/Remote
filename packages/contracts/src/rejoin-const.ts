// P28u oturum kapatma sonrası yeniden katılım sürelerinin TEK tanımı (mimari-p28u §7.5, §8.3; K-P28u-5, D-P28u-2; AC-443).
// Sunucu (`unattended/rejoin-*`, K4) buradan alır, yeniden tanımlamaz; Go eşi `internal/servis/rejoin.go` (K5) aynı değerleri
// `fixtures/ws-device.json` `constants` bloğuna karşı test eder. Yaprak modül (import yok).

/** Pencere: sunucunun `intervene{logoff}`'u gönderdiği / servisin kabul ettiği andan itibaren (sn). Sonra `session_changed`. */
export const REJOIN_WINDOW_SEC = 45;
export const REJOIN_WINDOW_MS = REJOIN_WINDOW_SEC * 1000;
/** `rejoin` biletinin ömrü (sn) = `rejoin.expiresInSec` üst sınırı. */
export const REJOIN_TICKET_TTL_SEC = 30;
/** Servis: yeni konsol oturumunu bekleme bütçesi (sn; K6s ölçümüyle ayarlanır, pencereyi aşamaz). */
export const REJOIN_CONSOLE_WAIT_SEC = 20;
