import { PANEL_CLOSE_TOO_MANY, PANEL_CLOSE_UNAUTH } from "./contract";

/*
 * /ws/panel yeniden bağlanma kararı (mimari-protokol §5.3): 4401 → yeniden dene (yetki/oturum yeniden doğrulanır);
 * upgrade 403 tarayıcıda açılmadan kapanma (1006) olarak görünür → art arda 3 açılamayan denemeden sonra dur;
 * 4429 (soket sınırı) ve 1008 (protokol) → dur. Diğer kopmalar → üstel geri çekilmeyle yeniden dene.
 */
export const MAX_UNOPENED = 3;

export function panelCloseAction(code: number, everOpened: boolean, unopenedAttempts: number): "retry" | "stop" {
  if (code === PANEL_CLOSE_TOO_MANY || code === 1008) return "stop";
  if (code === PANEL_CLOSE_UNAUTH) return "retry";
  if (!everOpened && unopenedAttempts >= MAX_UNOPENED) return "stop";
  return "retry";
}

/** 1, 2, 4, 8, 16 sn … en çok 30 sn. */
export const panelBackoff = (attempt: number): number => Math.min(1000 * 2 ** attempt, 30_000);

const PREFIX = /^\(\d+\) /;

/** Sekme başlığına bekleyen sayısı: "(3) Talepler · …"; 0 → önek kaldırılır. */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(PREFIX, "");
  return count > 0 ? `(${count}) ${base}` : base;
}
