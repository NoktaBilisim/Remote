// Talep hız sınırları (mimari-e9 §5.4 + §13.6; AC-132, 143, 144). Bellek içi (ADR-0005). Aşımda o anahtar 15 dk 429.
// `FixedWindowCounter(limit+1, …)`: N. olay serbest, N+1. kilidi başlatır (auth/public kalıbı).
import { WS_PANEL_UPGRADES_PER_MIN } from "@remote/contracts/ws-request";
import { AppError } from "../lib/errors.ts";
import { FixedWindowCounter } from "../lib/rate.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const BLOCK = 15 * MIN;
export const RATE_BLOCK_SEC = BLOCK / 1000;

/** Tenant saatlik sayacı (kilit yok; §13.6 tenant kilitlenmez). */
export class HourCounter {
  private readonly m = new Map<string, { ends: number; n: number }>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }
  count(key: string): number {
    const e = this.m.get(key);
    return e && e.ends > this.now() ? e.n : 0;
  }
  windowEnds(key: string): number {
    const e = this.m.get(key);
    return e && e.ends > this.now() ? e.ends : this.now() + HOUR;
  }
  add(key: string): number {
    const t = this.now();
    let e = this.m.get(key);
    if (!e || e.ends <= t) {
      if (this.m.size > 20_000) this.m.clear();
      e = { ends: t + HOUR, n: 0 };
      this.m.set(key, e);
    }
    e.n += 1;
    return e.n;
  }
}

export interface RequestLimits {
  refInvalid: FixedWindowCounter;
  createIp: FixedWindowCounter;
  createPrefix: FixedWindowCounter;
  createNet48: FixedWindowCounter;
  download: FixedWindowCounter;
  info: FixedWindowCounter;
  /** S-P19-K1: web formu token verme ucu IPv6 ağ kovaları — /56 120/dk, /48 240/dk (IPv4'te yalnız `info` /32). */
  webFormPrefix: FixedWindowCounter;
  webFormNet48: FixedWindowCounter;
  cancel: FixedWindowCounter;
  waTest: FixedWindowCounter;
  accept: FixedWindowCounter;
  /** Tenant: tüm talepler (60/sa sonrası bilinmeyen kaynak reddi) ve bilinen kaynak tavanı (120/sa). */
  tenantAll: HourCounter;
  tenantKnown: HourCounter;
  /** P19 (S-P19-15, K-P19-8): WEB talepleri için ayrı firma kovası (60/sa); AGENT kovalarına dokunmaz (ve tersi). */
  tenantWebAll: HourCounter;
  /** `request.rate_limited` audit'i kaynak başına dakikada en çok 1 (AC-144). */
  rateAudit: FixedWindowCounter;
  /** `/ws/request` upgrade 31/dk/ipKey. */
  wsUpgrade: FixedWindowCounter;
  /** `/ws/panel` upgrade 31/dk/ipKey. */
  panelUpgrade: FixedWindowCounter;
  /** P14a (AC-216): `/ws/panel` upgrade 30/dk/kimlik oturumu (anahtar: oturum token'ının SHA-256'sı); aşımda 4429 `retry=`. */
  panelSession: FixedWindowCounter;
  /** P8c (mimari-e10 §5.3): geçerli kayıt durum sorgusu 60/dk/ipKey. */
  bindingStatus: FixedWindowCounter;
  /** P8c: kayıt iptali ("Bu bilgisayarı unut") 30/dk/ipKey. */
  bindingRevoke: FixedWindowCounter;
  /** P8c: kayıtla talep 6/sa/kayıt (E9 ip/önek/net48/tenant kovalarına EK — K20). */
  createBinding: FixedWindowCounter;
  /** P8c: müşteri yazma uçları + tek kayıt iptali 30/dk/kullanıcı. */
  customersWrite: FixedWindowCounter;
}

export const TENANT_UNKNOWN_PER_HOUR = 60;
export const TENANT_KNOWN_PER_HOUR = 120;
/** P19 (S-P19-15): WEB firma kovası ve WEB bekleyen alt tavanı (toplam 50 aynı; AGENT'a en az 20 yer kalır). */
export const TENANT_WEB_PER_HOUR = 60;
export const WEB_PENDING_MAX = 30;
/** S-P19-K1: `GET /public/web-requests/form` önek ve /48 kovaları (dakikalık; aşımda 15 dk 429). */
export const WEB_FORM_PREFIX_PER_MIN = 120;
export const WEB_FORM_NET48_PER_MIN = 240;

export function createRequestLimits(): RequestLimits {
  return {
    refInvalid: new FixedWindowCounter(11, MIN, BLOCK),
    createIp: new FixedWindowCounter(6, HOUR, BLOCK),
    createPrefix: new FixedWindowCounter(21, HOUR, BLOCK),
    createNet48: new FixedWindowCounter(41, HOUR, BLOCK),
    download: new FixedWindowCounter(31, HOUR, BLOCK),
    info: new FixedWindowCounter(61, MIN, BLOCK),
    webFormPrefix: new FixedWindowCounter(WEB_FORM_PREFIX_PER_MIN + 1, MIN, BLOCK),
    webFormNet48: new FixedWindowCounter(WEB_FORM_NET48_PER_MIN + 1, MIN, BLOCK),
    cancel: new FixedWindowCounter(31, MIN, BLOCK),
    waTest: new FixedWindowCounter(6, MIN, MIN),
    accept: new FixedWindowCounter(31, MIN, MIN),
    tenantAll: new HourCounter(),
    tenantKnown: new HourCounter(),
    tenantWebAll: new HourCounter(),
    rateAudit: new FixedWindowCounter(2, MIN, MIN),
    wsUpgrade: new FixedWindowCounter(31, MIN, MIN),
    panelUpgrade: new FixedWindowCounter(31, MIN, MIN),
    panelSession: new FixedWindowCounter(WS_PANEL_UPGRADES_PER_MIN + 1, MIN, MIN),
    bindingStatus: new FixedWindowCounter(61, MIN, BLOCK),
    bindingRevoke: new FixedWindowCounter(31, MIN, BLOCK),
    createBinding: new FixedWindowCounter(7, HOUR, BLOCK),
    customersWrite: new FixedWindowCounter(31, MIN, MIN),
  };
}

export function closeRequestLimits(l: RequestLimits): void {
  for (const v of Object.values(l)) if (v instanceof FixedWindowCounter) v.close();
}

export const rateLimited = (sec: number, message?: string): AppError =>
  new AppError("RATE_LIMITED", { retryAfterSec: Math.max(1, Math.ceil(sec)), ...(message ? { message } : {}) });

/** Kilitliyse kalan saniye; değilse 0 (sayım yok). */
export const blocked = (c: FixedWindowCounter, key: string): number => c.blockedFor(key);

/** Sayar; kilitliyse veya bu olayla kilit başladıysa true. */
export function hitBlocked(c: FixedWindowCounter, key: string): number {
  const wait = c.blockedFor(key);
  if (wait > 0) return wait;
  return c.hit(key) ? RATE_BLOCK_SEC : 0;
}
