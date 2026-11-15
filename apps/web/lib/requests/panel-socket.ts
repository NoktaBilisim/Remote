import { parsePanelRetry } from "@remote/contracts/ws-request";
import { PANEL_CLOSE_TOO_MANY, PANEL_CLOSE_UNAUTH } from "./contract";

/*
 * /ws/panel yeniden bağlanma kararı (mimari-protokol §5.3, P14a AC-216): 4401 → yeniden dene (yetki/oturum yeniden
 * doğrulanır); upgrade 403 tarayıcıda açılmadan kapanma (1006) olarak görünür → art arda 3 açılamayan denemeden sonra dur;
 * 4429 + gerekçe `retry=<sn>` (oturum başına upgrade hız sınırı) → o kadar bekle (± %20 jitter) ve sessizce yeniden dene;
 * 4429 gerekçesiz / `too_many` (kullanıcı başına soket sınırı) ve 1008 (protokol) → dur. Diğer kopmalar → üstel geri çekilme.
 */
export const MAX_UNOPENED = 3;

export function panelCloseAction(code: number, everOpened: boolean, unopenedAttempts: number, reason = ""): "retry" | "stop" {
  if (code === PANEL_CLOSE_TOO_MANY) return parsePanelRetry(reason) === null ? "stop" : "retry";
  if (code === 1008) return "stop";
  if (code === PANEL_CLOSE_UNAUTH) return "retry";
  if (!everOpened && unopenedAttempts >= MAX_UNOPENED) return "stop";
  return "retry";
}

/** 1, 2, 4, 8, 16 sn … en çok 30 sn. */
export const panelBackoff = (attempt: number): number => Math.min(1000 * 2 ** attempt, 30_000);

/** AC-216: jitter oranı (± %20) — aynı anda sınıra takılan sekmeler aynı saniyede geri gelmesin. */
const PANEL_RETRY_JITTER = 0.2;

/**
 * Kapanıştan sonraki bekleme (ms). 4429 `retry=<sn>` → sunucunun söylediği süre ± %20 (`rand` ∈ [0,1)); diğer
 * durumlarda üstel geri çekilme. Yalnız `panelCloseAction` "retry" dediğinde çağrılır.
 */
export function panelRetryDelay(code: number, reason: string, attempt: number, rand: number = Math.random()): number {
  const sec = code === PANEL_CLOSE_TOO_MANY ? parsePanelRetry(reason) : null;
  if (sec === null) return panelBackoff(attempt);
  const factor = 1 - PANEL_RETRY_JITTER + 2 * PANEL_RETRY_JITTER * Math.min(Math.max(rand, 0), 1);
  return Math.round(sec * 1000 * factor);
}

const PREFIX = /^\(\d+\) /;

/** Sekme başlığına bekleyen sayısı: "(3) Talepler · …"; 0 → önek kaldırılır. */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(PREFIX, "");
  return count > 0 ? `(${count}) ${base}` : base;
}
