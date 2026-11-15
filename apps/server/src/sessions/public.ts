// Public müşteri uçlarının servis katmanı (P2 kısmı: resolve + 410 durumları + iptal yoklaması).
// Limitler (G-02, G-11, AC-3): başarısız kod ipKey 10/dk + prefixKey 30/dk, aşımda o anahtar 15 dk 429;
// token yolu 30/dk/ipKey; durum yoklaması 60/dk/ipKey. Resolve oturumu tüketmez (tüketim P3 admit TX'i).
// Global başarısız kod sayacı yalnız alarm üretir, engellemez (G-02, mimari §11: > 100/dk).
import type { SecretBox } from "../lib/crypto.ts";
import { techAvatarSignedUrl } from "../uploads/tech-avatar.ts";
import type { FastifyBaseLogger } from "fastify";
import type {
  PublicSessionStatusResponse,
  ResolveSessionInput,
  ResolveSessionResponse,
  SessionStatus,
} from "@remote/contracts/api/sessions";
import type { ErrorCode } from "@remote/contracts/errors";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { abuseEmail, currentConsentText, type AbuseEmailSource } from "../public/consent.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { sha256Hex } from "../lib/ids.ts";
import { cidrMatcher, ipKey, prefixKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import type { Metrics } from "../ops/metrics.ts";
import { isOutdated } from "../lib/version.ts";
import { parseSessionRef, sessionRef } from "./codes.ts";
import { effectiveLogoUrl } from "../uploads/urls.ts";
import * as repo from "./repo.ts";
import { expireSession } from "./service.ts";

const MIN = 60_000;

/** 426 CLIENT_OUTDATED (`fields.minVersion`). */
export const outdated = (min: string | undefined): AppError => new AppError("CLIENT_OUTDATED", { fields: { minVersion: min ?? "" } });

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
  /** Süreç başından beri başarısız kod çözümleme sayısı (/metrics `rs_resolve_failed`). */
  total = 0;

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
    this.total += 1;
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
  /** join: 20/dk/ipKey (P3). */
  joinIp: FixedWindowCounter;
  /** Agent indirme ucu, tüm istekler: 20/dk/ipKey (P6, mimari-api). Başarısızlar ayrıca codeIp/codePrefix'e sayılır. */
  downloadIp: FixedWindowCounter;
  /** Aynı oturum + 410 sebebi için 10 dk'da tek audit satırı (S-P2-6). */
  goneAudit: FixedWindowCounter;
  resolveFailed: ResolveFailedAlarm;
  clientIpIsProxy: ClientIpIsProxyAlarm;
  /** P14a (AC-208): kod yolu kovası kilitlenince → `rs_guest_code_rate_limited_total{scope}` (kilit başına bir; S14-6). */
  codeLimited: (scope: "ip" | "prefix") => void;
}

// limit N+1: N. olay serbest, N+1. olay kilidi başlatır (auth limitleriyle aynı kalıp).
export const createPublicLimits = (log: FastifyBaseLogger, trustedProxyCidr?: string, metrics?: Pick<Metrics, "inc">): PublicLimits => ({
  codeIp: new FixedWindowCounter(11, MIN, 15 * MIN),
  codePrefix: new FixedWindowCounter(31, MIN, 15 * MIN),
  tokenIp: new FixedWindowCounter(31, MIN, MIN),
  statusIp: new FixedWindowCounter(61, MIN, MIN),
  joinIp: new FixedWindowCounter(21, MIN, MIN),
  downloadIp: new FixedWindowCounter(21, MIN, MIN),
  goneAudit: new FixedWindowCounter(2, 10 * MIN, 10 * MIN),
  resolveFailed: new ResolveFailedAlarm((s) => log.warn({ alarm: "resolve_failed", ...s }, "global başarısız kod eşiği aşıldı")),
  clientIpIsProxy: new ClientIpIsProxyAlarm(trustedProxyCidr, () =>
    log.warn(
      { alarm: "client_ip_is_proxy" },
      "public resolve istemci IP'si güvenilen proxy adresi: X-Forwarded-For gelmiyor (edge sırrı?)",
    ),
  ),
  codeLimited: (scope) => metrics?.inc("rs_guest_code_rate_limited_total", { scope }),
});

export const closePublicLimits = (l: PublicLimits): void =>
  [l.codeIp, l.codePrefix, l.tokenIp, l.statusIp, l.joinIp, l.downloadIp, l.goneAudit].forEach((c) => c.close());

const rateLimited = (sec: number) => new AppError("RATE_LIMITED", { retryAfterSec: Math.max(1, sec) });

/** Limit kontrolü + sayım; kilitliyse veya bu olayla kilit başladıysa 429. */
export function consume(counter: FixedWindowCounter, key: string, blockSec: number): void {
  const wait = counter.blockedFor(key);
  if (wait > 0) throw rateLimited(wait);
  if (counter.hit(key)) throw rateLimited(blockSec);
}

/** Kod yolu kovaları (ipKey 10/dk + prefixKey 30/dk) kilitliyse 429; resolve (kod) ve agent indirme ortak (G-02). */
export function assertLookupAllowed(limits: PublicLimits, ip: string, prefix: string): void {
  // S14-6: kilitliyken gelen istekler metriği artırmaz (sayım kilit başlarken, countFailedLookup'ta — kova başına bir).
  const ipWait = limits.codeIp.blockedFor(ip);
  const prefixWait = limits.codePrefix.blockedFor(prefix);
  const wait = Math.max(ipWait, prefixWait);
  if (wait > 0) throw rateLimited(wait);
}

/** Başarısız çözümleme sayımı: global alarm + yalnız bu ip/önek; bu olayla kilit başladıysa 15 dk 429 fırlatır. */
export function countFailedLookup(limits: PublicLimits, ip: string, prefix: string): void {
  limits.resolveFailed.record(prefix);
  const ipHit = limits.codeIp.hit(ip);
  const prefixHit = limits.codePrefix.hit(prefix);
  if (ipHit) limits.codeLimited("ip");
  if (prefixHit) limits.codeLimited("prefix");
  if (ipHit || prefixHit) throw rateLimited(15 * 60);
}

export const GONE: Partial<Record<string, ErrorCode>> = {
  ACTIVE: "SESSION_CONSUMED",
  ENDED: "SESSION_CONSUMED",
  EXPIRED: "SESSION_EXPIRED",
  CANCELLED: "SESSION_CANCELLED",
};

/** 410 audit'i; aynı oturum + sebep için pencerede yalnız ilki yazılır (S-P2-6). Kayıtta token/kod yok. */
async function goneAudit(db: Db, limits: PublicLimits, ctx: AuditContext, s: repo.PublicSessionRow, code: ErrorCode): Promise<void> {
  const key = `${s.id}:${code}`;
  if (limits.goneAudit.blockedFor(key) > 0 || limits.goneAudit.hit(key)) return;
  await writeAudit(db, ctx, {
    tenantId: s.tenantId,
    username: "customer",
    action: "session.resolve",
    entity: "support_sessions",
    entityId: s.id,
    result: "fail",
    newValue: { reason: code },
  });
}

export async function resolvePublicSession(
  db: Db,
  limits: PublicLimits,
  refKey: string,
  ctx: AuditContext,
  input: ResolveSessionInput,
  issueNonce: (
    sessionId: string,
    kind: ResolveSessionInput["clientKind"],
    clientVersion?: string,
  ) => { joinNonce: string; nonceExpiresAt: string },
  abuseSrc: AbuseEmailSource,
  minAgentVersion?: string,
  secrets?: SecretBox,
): Promise<ResolveSessionResponse> {
  limits.clientIpIsProxy.check(ctx.ip);
  // P8b r2 (§13.4): AGENT sürümü düşükse 426 (yoksa 0.0.0 sayılır — 0.8.x MIN tanımlanınca güncellemeye zorlanır).
  if (input.clientKind === "AGENT" && isOutdated(input.clientVersion, minAgentVersion)) throw outdated(minAgentVersion);
  const ip = ipKey(ctx.ip);
  let row: repo.PublicSessionRow | null;
  if ("token" in input) {
    consume(limits.tokenIp, ip, 60);
    row = await repo.findByTokenHash(db, sha256Hex(input.token));
    if (row?.requestId) row = null; // P8b §3.3: talep oturumunun token'ı hiç dönmez; bu yol 404
    if (!row) throw new AppError("NOT_FOUND", { message: "Bağlantı geçersiz." });
  } else {
    const prefix = prefixKey(ctx.ip);
    assertLookupAllowed(limits, ip, prefix);
    row = await repo.findByActiveCode(db, input.code);
    if (!row) {
      // Yalnız başarısız çözümleme sayılır; aşımda yalnız bu ip/önek kilitlenir (G-02).
      countFailedLookup(limits, ip, prefix);
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
  const [consentText, abuse, logoUrl] = await Promise.all([
    currentConsentText(db, row.tenantId),
    abuseEmail(db, abuseSrc),
    effectiveLogoUrl(db, row.tenant.logoPath),
  ]);
  return {
    sessionRef: sessionRef(refKey, row.id),
    tenant: { name: row.tenant.name, logoUrl }, // P12: firma → sistem → Nokta logosu (public URL)
    // P15 (AC-236): avatar varsa oturuma bağlı imzalı URL (≤ 10 dk); yoksa null → baş harf rozeti.
    technician: {
      name: row.technician.fullName,
      avatarUrl: secrets && row.technician.avatarPath ? techAvatarSignedUrl(secrets, row.id, now.getTime()) : null,
    },
    techVerifyCode: row.techVerifyCode,
    expiresAt: row.expiresAt.toISOString(),
    ...issueNonce(row.id, input.clientKind, input.clientKind === "AGENT" ? (input.clientVersion ?? "0.0.0") : undefined), // resolve tüketmez; nonce join içindir (P3)
    consentText, // P4: karşılamada gösterilir, join'de id'si geri gelir (G-24)
    abuseEmail: abuse,
  };
}

/** Karşılama sayfası iptal/expiry yoklaması (AC-8). Geçersiz ref → 404. */
export async function publicSessionStatus(
  db: Db,
  limits: PublicLimits,
  refKey: string,
  ctx: AuditContext,
  ref: string,
): Promise<PublicSessionStatusResponse> {
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
