// P21 müşteri portalı hız kovaları (mimari-p21 §5.1, r2 S-P21-4/S-P21-7). Tek instance (ADR-0005) → bellek; hesap geneli
// kilit DB'de (`portal_users.failed_login_count` / `locked_until`). Panel kovalarından AYRI örnekler (aynı sınıf, aynı eşikler):
// portal denemesi panel kullanıcısını, panel denemesi portal hesabını kilitleyemez.
// `FixedWindowCounter(limit+1, …)`: N. olay serbest, N+1. kilidi başlatır (auth/public kalıbı).
import { PORTAL_REQUESTS_PER_CUSTOMER_HOUR } from "@remote/contracts/api/portal";
import { FixedWindowCounter } from "../lib/rate.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Hesap geneli 1 sa'de 20 hatalı → 15 dk kilit (panel G-23 kalıbı). */
export const PORTAL_ACCOUNT_FAIL_LIMIT = 20;
export const PORTAL_LOCK_MIN = 15;
const LOCK_MS = PORTAL_LOCK_MIN * MIN;
/** Panel tarafı hesap oluşturma: firma başına saatte 30 (`users` oluşturma kovası kalıbı, §4.3). */
export const PORTAL_ACCOUNT_CREATES_PER_HOUR = 30;

export interface PortalLimits {
  /** IP başına 20 giriş denemesi/dk (21. → 429). */
  ip: FixedWindowCounter;
  /** (firma kısa adı | e-posta) + IP: 15 dk'da 5 deneme → 15 dk kilit (doğrulamadan ÖNCE sayılır). */
  pair: FixedWindowCounter;
  /** Olmayan hesap (bilinmeyen firma dahil; anahtar `slug|e-posta`): hesap geneli eşiğin bellek karşılığı. */
  ghostAccount: FixedWindowCounter;
  /** Var olan hesap için yedek kova (DB sayacı yazılamadığında; fail-closed). */
  accountFallback: FixedWindowCounter;
  /** Oturum başına hatalı mevcut şifre (5 → oturum iptal). */
  passwordChange: FixedWindowCounter;
  /** r2 S-P21-7: girişte TOTP kodu geldiğinde e-posta+IP 5/5 dk ve hesap 15/15 dk. */
  mfaPair: FixedWindowCounter;
  mfaUser: FixedWindowCounter;
  /** TOTP kur/aç/kapat: kullanıcı başına 5 deneme / 5 dk. */
  totpAccount: FixedWindowCounter;
  /** r2 S-P21-4: müşterinin TÜM portal hesapları toplamı, saatte 10 talep. */
  requestsCustomer: FixedWindowCounter;
  /** Panel: firma başına saatte 30 hesap oluşturma. */
  accountCreates: FixedWindowCounter;
}

export const createPortalLimits = (): PortalLimits => ({
  ip: new FixedWindowCounter(21, MIN, MIN),
  pair: new FixedWindowCounter(5, LOCK_MS, LOCK_MS),
  ghostAccount: new FixedWindowCounter(PORTAL_ACCOUNT_FAIL_LIMIT, HOUR, LOCK_MS),
  accountFallback: new FixedWindowCounter(PORTAL_ACCOUNT_FAIL_LIMIT, HOUR, LOCK_MS),
  passwordChange: new FixedWindowCounter(5, LOCK_MS, LOCK_MS),
  mfaPair: new FixedWindowCounter(6, 5 * MIN, 5 * MIN),
  mfaUser: new FixedWindowCounter(16, 15 * MIN, 15 * MIN),
  totpAccount: new FixedWindowCounter(6, 5 * MIN, 5 * MIN),
  requestsCustomer: new FixedWindowCounter(PORTAL_REQUESTS_PER_CUSTOMER_HOUR + 1, HOUR, HOUR),
  accountCreates: new FixedWindowCounter(PORTAL_ACCOUNT_CREATES_PER_HOUR + 1, HOUR, HOUR),
});

export const closePortalLimits = (l: PortalLimits): void => Object.values(l).forEach((c: FixedWindowCounter) => c.close());
