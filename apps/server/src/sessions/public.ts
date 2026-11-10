// Public müşteri uçlarının servis katmanı (P2 kısmı: resolve + 410 durumları + iptal yoklaması).
// Limitler (G-02, G-11, AC-3): başarısız kod ipKey 10/dk + prefixKey 30/dk, aşımda o anahtar 15 dk 429;
// token yolu 30/dk/ipKey; durum yoklaması 60/dk/ipKey. Resolve oturumu tüketmez (tüketim P3 admit TX'i).
// Global başarısız kod sayacı yalnız alarm üretir, engellemez (G-02, mimari §11: > 100/dk).
import type { FastifyBaseLogger } from "fastify";
import type { PublicSessionStatusResponse, ResolveSessionInput, ResolveSessionResponse, SessionStatus } from "@remote/contracts/api/sessions";
import type { ErrorCode } from "@remote/contracts/errors";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { cidrMatcher, ipKey, prefixKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { parseSessionRef, sessionRef } from "./codes.ts";
import * as repo from "./repo.ts";
import { expireSession } from "./service.ts";

const MIN = 60_000;

interface ResolveFailedStats {
  failed: number;
  /** Penceredeki farklı önek sayısı (üst sınırlı); IP/önek değeri loga yazılmaz. */
  prefixes: number;
  windowSec: number;
}

interface AlarmOptions {
  threshold?: number;
  windowMs?: number;
  maxPrefixes?: number;
  now?: () => number;
}

/**
 * Global başarısız kod çözümleme sayacı (G-02, S-P2-3). Sabit pencerede `threshold` aşılınca pencere başına
 * bir kez `onAlarm` çağrılır; hiçbir isteği engellemez. Bellek: tek sayaç + en çok `maxPrefixes` önek.
 */
export class ResolveFailedAlarm {
  private readonly onAlarm: (s: ResolveFailedStats) => void;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly maxPrefixes: number;
  private readonly now: () => number;
  private readonly prefixes = new Set<string>();
  private windowEnds = 0;
  private failed = 0;
  private alarmed = false;

  constructor(onAlarm: (s: ResolveFailedStats) => void, opts: AlarmOptions = {}) {
    this.onAlarm = onAlarm;
    this.threshold = opts.threshold ?? 100;
    this.windowMs = opts.windowMs ?? MIN;
    this.maxPrefixes = opts.maxPrefixes ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  record(prefix: string): void {
    const t = this.now();
    if (t >= this.windowEnds) {
      this.windowEnds = t + this.windowMs;
      this.failed = 0;
      this.alarmed = false;
      this.prefixes.clear();
    }
    this.failed += 1;
    if (this.prefixes.size < this.maxPrefixes) this.prefixes.add(prefix);
    if (!this.alarmed && this.failed > this.threshold) {
      this.alarmed = true;
      this.onAlarm({ failed: this.failed, prefixes: this.prefixes.size, windowSec: this.windowMs / 1000 });
    }
  }
}

/**
 * S-P2-T2-1: çözümlenen istemci IP'si güvenilen proxy CIDR'ı içindeyse XFF gelmemiştir (ör. Caddy↔web edge
 * sırrı uyuşmazlığı) ve tüm müşteriler tek proxy IP'si altında sayılır. Bunu görünür kılar: en çok
 * `intervalMs`'de bir `onAlarm`. Engelleme yapmaz; loga IP/token yazılmaz.
 */
export class ClientIpIsProxyAlarm {
  private readonly isProxy: (ip: string) => boolean;
  private readonly onAlarm: () => void;
  private readonly throttle: FixedWindowCounter;

  constructor(trustedProxyCidr: string | undefined, onAlarm: () => void, opts: { intervalMs?: number; now?: () => number } = {}) {
    this.isProxy = cidrMatcher(trustedProxyCidr);
    this.onAlarm = onAlarm;
    const every = opts.intervalMs ?? MIN;
    // limit 1: ilk olay kilidi başlatır; kilit süresince yeni alarm yok (tek anahtar, zamanlayıcı yok).
    this.throttle = new FixedWindowCounter(1, every, every, { sweepIntervalMs: 0, ...(opts.now ? { now: opts.now } : {}) });
  }

  check(ip: string): void {
    if (!this.isProxy(ip) || this.throttle.blockedFor("proxy") > 0) return;
    this.throttle.hit("proxy");
    this.onAlarm();
  }
}

export interface PublicLimits {
  codeIp: FixedWindowCounter;
  codePrefix: FixedWindowCounter;
  tokenIp: FixedWindowCounter;
  statusIp: FixedWindowCounter;
  /** Aynı oturum + 410 sebebi için 10 dk'da tek audit satırı (S-P2-6). */
  goneAudit: FixedWindowCounter;
  resolveFailed: ResolveFailedAlarm;
  clientIpIsProxy: ClientIpIsProxyAlarm;
}

// limit N+1: N. olay serbest, N+1. olay kilidi başlatır (auth limitleriyle aynı kalıp).
export const createPublicLimits = (log: FastifyBaseLogger, trustedProxyCidr?: string): PublicLimits => ({
  codeIp: new FixedWindowCounter(11, MIN, 15 * MIN),
  codePrefix: new FixedWindowCounter(31, MIN, 15 * MIN),
  tokenIp: new FixedWindowCounter(31, MIN, MIN),
  statusIp: new FixedWindowCounter(61, MIN, MIN),
  goneAudit: new FixedWindowCounter(2, 10 * MIN, 10 * MIN),
  resolveFailed: new ResolveFailedAlarm((s) => log.warn({ alarm: "resolve_failed", ...s }, "global başarısız kod eşiği aşıldı")),
  clientIpIsProxy: new ClientIpIsProxyAlarm(trustedProxyCidr, () =>
    log.warn({ alarm: "client_ip_is_proxy" }, "public resolve istemci IP'si güvenilen proxy adresi: X-Forwarded-For gelmiyor (edge sırrı?)"),
  ),
});

export const closePublicLimits = (l: PublicLimits): void =>
  [l.codeIp, l.codePrefix, l.tokenIp, l.statusIp, l.goneAudit].forEach((c) => c.close());

const rateLimited = (sec: number) => new AppError("RATE_LIMITED", { retryAfterSec: Math.max(1, sec) });

/** Limit kontrolü + sayım; kilitliyse veya bu olayla kilit başladıysa 429. */
function consume(counter: FixedWindowCounter, key: string, blockSec: number): void {
  const wait = counter.blockedFor(key);
  if (wait > 0) throw rateLimited(wait);
  if (counter.hit(key)) throw rateLimited(blockSec);
}

const GONE: Partial<Record<string, ErrorCode>> = {
  ACTIVE: "SESSION_CONSUMED",
  ENDED: "SESSION_CONSUMED",
  EXPIRED: "SESSION_EXPIRED",
  CANCELLED: "SESSION_CANCELLED",
};

/** 410 audit'i; aynı oturum + sebep için pencerede yalnız ilki yazılır (S-P2-6). Kayıtta token/kod yok. */
async function goneAudit(db: Db, limits: PublicLimits, ctx: AuditContext, s: repo.PublicSessionRow, code: ErrorCode): Promise<void> {
  const key = `${s.id}:${code}`;
  if (limits.goneAudit.blockedFor(key) > 0 || limits.goneAudit.hit(key)) return;
  await writeAudit(db, ctx, { tenantId: s.tenantId, action: "session.resolve", entity: "support_sessions", entityId: s.id, result: "fail", newValue: { reason: code } });
}

export async function resolvePublicSession(db: Db, limits: PublicLimits, refKey: string, ctx: AuditContext, input: ResolveSessionInput): Promise<ResolveSessionResponse> {
  limits.clientIpIsProxy.check(ctx.ip);
  const ip = ipKey(ctx.ip);
  let row: repo.PublicSessionRow | null;
  if ("token" in input) {
    consume(limits.tokenIp, ip, 60);
    row = await repo.findByTokenHash(db, sha256Hex(input.token));
    if (!row) throw new AppError("NOT_FOUND", { message: "Bağlantı geçersiz." });
  } else {
    const prefix = prefixKey(ctx.ip);
    const wait = Math.max(limits.codeIp.blockedFor(ip), limits.codePrefix.blockedFor(prefix));
    if (wait > 0) throw rateLimited(wait);
    row = await repo.findByActiveCode(db, input.code);
    if (!row) {
      limits.resolveFailed.record(prefix);
      // Yalnız başarısız çözümleme sayılır; aşımda yalnız bu ip/önek kilitlenir (G-02).
      const ipHit = limits.codeIp.hit(ip);
      const prefixHit = limits.codePrefix.hit(prefix);
      if (ipHit || prefixHit) throw rateLimited(15 * 60);
      throw new AppError("NOT_FOUND", { message: "Kod bulunamadı. Kodu kontrol edip tekrar deneyin." });
    }
  }

  const now = new Date();
  if (row.status === "PENDING" && row.expiresAt <= now) {
    await expireSession(db, ctx, row, now); // iş gecikse bile aynı istekte EXPIRED (AC-5)
    await goneAudit(db, limits, ctx, row, "SESSION_EXPIRED");
    throw new AppError("SESSION_EXPIRED");
  }
  const gone = GONE[row.status];
  if (gone) {
    await goneAudit(db, limits, ctx, row, gone);
    throw new AppError(gone);
  }
  return {
    sessionRef: sessionRef(refKey, row.id),
    tenant: { name: row.tenant.name, logoUrl: null }, // logo servisi P9
    technician: { name: row.technician.fullName, avatarUrl: null },
    techVerifyCode: row.techVerifyCode,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Karşılama sayfası iptal/expiry yoklaması (AC-8). Geçersiz ref → 404. */
export async function publicSessionStatus(db: Db, limits: PublicLimits, refKey: string, ctx: AuditContext, ref: string): Promise<PublicSessionStatusResponse> {
  consume(limits.statusIp, ipKey(ctx.ip), 60);
  const id = parseSessionRef(refKey, ref);
  const row = id ? await repo.findStatus(db, id) : null;
  if (!row) throw new AppError("NOT_FOUND");
  const now = new Date();
  if (row.status === "PENDING" && row.expiresAt <= now) {
    await expireSession(db, ctx, row, now);
    return { status: "EXPIRED" };
  }
  return { status: row.status as SessionStatus };
}
