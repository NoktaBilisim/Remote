// P27a "Bu cihazı 30 gün hatırla" (mimari-p27a §2, §5; AC-325..333, AC-335a, AC-335b). K2: çerez değeri
// üretimi/biçimi/ayrıştırma ve gizli değerin özeti. K3: politika (`rememberAllowed`), `issue` (verify TX'i),
// `consumeAtLogin` (login TX'i; döndürme + yeniden kullanım), `uaSummary`, çerez ayarları, commit sonrası bildirimler.
// Gizli değer DB'de, logda, audit'te ve yanıt gövdesinde yer almaz; yalnız `Set-Cookie`'de (AC-333).
import {
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_COOKIE_PATH,
  TRUSTED_DEVICE_COOKIE_VALUE_RE,
  TRUSTED_DEVICE_DAYS,
} from "@remote/contracts/api/auth";
import { AUTH_AUDIT } from "@remote/contracts/audit";
import type { FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { newSecretToken, sha256Hex } from "../lib/ids.ts";
import { trustedDeviceCreatedMail, trustedDeviceReuseMail } from "../mail/templates.ts";
import type { MailService } from "../mail/service.ts";
import { findUserById, revokeUserSessions } from "./repo.ts";
import * as tdRepo from "./trusted-device-repo.ts";

/** Aynı adlı çerezden denenen en çok değer (D-P27a-2: cookie tossing / aynı host'ta başka port gölgelemesi). */
export const TRUSTED_DEVICE_COOKIE_MAX_VALUES = 2;
const TRUSTED_DEVICE_TTL_MS = TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000;

export interface TrustedDeviceCookieValue {
  /** Satır id'si (ULID); gizli değildir. */
  id: string;
  /** 32 bayt base64url (43 karakter); yalnız çerezde. */
  secret: string;
}

/** Yeni gizli değer: `crypto.randomBytes(32)` base64url (43 karakter; AC-333). */
export const newTrustedDeviceSecret = (): string => newSecretToken();

/** DB'ye yazılan tek değer: gizlinin SHA-256 hex'i (küçük harf, 64; DB CHECK ile aynı biçim). */
export const hashTrustedDeviceSecret = (secret: string): string => sha256Hex(secret);

/** Sabit zamanlı karşılaştırma (`timingSafeEqual`): gizlinin özeti satırdaki `token_hash` ile aynı mı. */
export function trustedDeviceSecretMatches(secret: string, tokenHash: string): boolean {
  const a = Buffer.from(hashTrustedDeviceSecret(secret), "hex");
  const b = Buffer.from(tokenHash, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

/** Çerez değeri `<id>.<gizli>` (mimari-p27a §5.3). */
export const formatTrustedDeviceCookie = (v: TrustedDeviceCookieValue): string => `${v.id}.${v.secret}`;

/** Biçime uymayan değer `null` ("bilinmeyen": hiçbir satıra dokunulmaz). */
export function parseTrustedDeviceCookie(value: string): TrustedDeviceCookieValue | null {
  const m = TRUSTED_DEVICE_COOKIE_VALUE_RE.exec(value);
  return m?.[1] && m[2] ? { id: m[1], secret: m[2] } : null;
}

/**
 * Ham `Cookie` başlığından aynı addaki değerler, geliş sırasıyla en çok `TRUSTED_DEVICE_COOKIE_MAX_VALUES` tane
 * (`@fastify/cookie` aynı adda yalnız birini verir). Değer ayrıştırılmaz; biçim denetimi `parseTrustedDeviceCookie`.
 */
export function readTrustedDeviceCookies(cookieHeader: string | undefined): string[] {
  if (!cookieHeader) return [];
  const out: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== TRUSTED_DEVICE_COOKIE) continue;
    out.push(part.slice(eq + 1).trim());
    if (out.length === TRUSTED_DEVICE_COOKIE_MAX_VALUES) break;
  }
  return out;
}

/** Sabit bitiş (K-P27a-3): oluşturma + 30 gün; döndürmede değişmez. */
export const trustedDeviceExpiresAt = (createdAt: Date): Date => new Date(createdAt.getTime() + TRUSTED_DEVICE_TTL_MS);

/** Döndürmede `Max-Age`: kalan tam saniye (en az 0). */
export const trustedDeviceRemainingSec = (expiresAt: Date, now: Date): number =>
  Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

// ---------------------------------------------------------------------------------------------------------------
// K3: politika, UA özeti, çerez ayarları
// ---------------------------------------------------------------------------------------------------------------

/** `rememberAllowed` girdisi: `LoginUser` bu biçimi taşır (repo `settings.mfaRememberDevice`). */
export interface RememberPolicySubject {
  role: string;
  tenantId: string | null;
  tenant: { settings: { mfaRememberDevice: boolean } | null } | null;
}

/**
 * K-P27a-1/2: Super Admin (ve firmasız hesap) asla; diğerleri firma anahtarı `mfa_remember_device` (ayar satırı yoksa DB
 * varsayılanı: açık). İzin yoksa `rememberDevice:true` yok sayılır, mevcut çerez TOTP'yi atlatmaz (AC-331).
 */
export function rememberAllowed(u: RememberPolicySubject): boolean {
  if (u.role === "SUPER_ADMIN" || u.tenantId === null) return false;
  return u.tenant?.settings?.mfaRememberDevice ?? true;
}

export const UNKNOWN_BROWSER = "Bilinmeyen tarayıcı";
// Sıra önemli: Edge/Opera/Samsung UA'ları "Chrome/", Chrome UA'sı "Safari/" da içerir.
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+ (?:Mobile\/\w+ )?Safari\//, "Safari"],
];
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMacintosh\b|\bMac OS X\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * AC-333: tam UA saklanmaz; yalnız sabit etiketlerden kurulan "Tarayıcı · İşletim sistemi" (≤ 80 karakter, kontrol
 * karakteri yok — DB CHECK). Bağımlılıksız regex; girdi 512 karakterle sınırlanır.
 */
export function uaSummary(ua: string): string {
  const s = ua.slice(0, 512);
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1] ?? UNKNOWN_BROWSER;
  const os = SYSTEMS.find(([re]) => re.test(s))?.[1];
  return os ? `${browser} · ${os}` : browser;
}

/** Yanıta yazılacak çerez: değer `<id>.<gizli>`, `Max-Age` kalan saniye. */
export interface TrustedDeviceCookieOut {
  value: string;
  maxAgeSec: number;
}

// K-P27a-7, §5.3: host-only (`Domain` yok), yalnız auth yolu.
const cookieBase = { path: TRUSTED_DEVICE_COOKIE_PATH, httpOnly: true, secure: true, sameSite: "strict" } as const;

export function setTrustedDeviceCookie(reply: FastifyReply, c: TrustedDeviceCookieOut): void {
  void reply.setCookie(TRUSTED_DEVICE_COOKIE, c.value, { ...cookieBase, maxAge: c.maxAgeSec });
}

export function clearTrustedDeviceCookie(reply: FastifyReply): void {
  void reply.clearCookie(TRUSTED_DEVICE_COOKIE, cookieBase);
}

// ---------------------------------------------------------------------------------------------------------------
// K3: oluşturma (verify TX'i) ve girişte tüketim (login TX'i)
// ---------------------------------------------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/** Audit/e-posta kimliği. */
export interface TrustedDeviceOwner {
  id: string;
  tenantId: string | null;
  email: string;
}

const whoOf = (u: TrustedDeviceOwner) => ({ tenantId: u.tenantId, userId: u.id, username: u.email });

export interface IssuedTrustedDevice {
  id: string;
  cookie: TrustedDeviceCookieOut;
  uaSummary: string;
  ip: string;
}

/**
 * §5.2 (AC-325, 332): `mfaVerify` TX'i içinde; çağıran `rememberDevice` + TOTP + `rememberAllowed` denetimini yapmıştır.
 * Kullanıcı satırı kilidi + sınır repo'da (`createTrustedDevice`). Aynı tarayıcının eski çerezindeki satır (kullanıcıya
 * aitse) silinir: bir tarayıcı = bir satır. Audit `created` (+ sınırdan düşen varsa `revoked {reason:"limit"}`).
 */
export async function issue(
  tx: Tx,
  ctx: AuditContext,
  user: TrustedDeviceOwner,
  existingCookies: readonly string[],
  now: Date,
): Promise<IssuedTrustedDevice> {
  const secret = newTrustedDeviceSecret();
  const summary = uaSummary(ctx.userAgent);
  const ip = ctx.ip.slice(0, 45);
  const replaceId = existingCookies.map(parseTrustedDeviceCookie).find((v) => v !== null)?.id;
  const created = await tdRepo.createTrustedDevice(tx, {
    userId: user.id,
    tokenHash: hashTrustedDeviceSecret(secret),
    uaSummary: summary,
    ip,
    now,
    ...(replaceId ? { replaceId } : {}),
  });
  const base = { ...whoOf(user), result: "success" as const };
  await writeAudit(tx, ctx, {
    ...base,
    action: AUTH_AUDIT.TRUSTED_DEVICE_CREATED,
    entity: "trusted_devices",
    entityId: created.id,
    newValue: { uaSummary: summary, expiresAt: created.expiresAt.toISOString() },
  });
  if (created.evicted > 0)
    await writeAudit(tx, ctx, {
      ...base,
      action: AUTH_AUDIT.TRUSTED_DEVICE_REVOKED,
      entity: "users",
      entityId: user.id,
      newValue: { reason: "limit", count: created.evicted },
    });
  const value = formatTrustedDeviceCookie({ id: created.id, secret });
  return { id: created.id, cookie: { value, maxAgeSec: trustedDeviceRemainingSec(created.expiresAt, now) }, uaSummary: summary, ip };
}

/** `consumeAtLogin` girdisi: `LoginUser` bu biçimi taşır. */
export interface TrustedLoginSubject extends TrustedDeviceOwner, RememberPolicySubject {
  totpEnabled: boolean;
}

export type TrustedLoginOutcome =
  | { kind: "none"; clearCookie: boolean }
  | { kind: "used"; cookie: TrustedDeviceCookieOut }
  | { kind: "reuse"; count: number; revokedSessions: number };

type Classified = { cls: "unknown" } | { cls: "reuse" } | { cls: "valid"; row: tdRepo.TrustedDeviceRow };

/** §5.1 sınıfları: satır yok / başka kullanıcının / biçimsiz → bilinmeyen; kullanıcınınsa özet tutmuyor → yeniden kullanım. */
async function classify(tx: Tx, user: TrustedLoginSubject, raw: string): Promise<Classified> {
  const v = parseTrustedDeviceCookie(raw);
  if (!v) return { cls: "unknown" };
  const row = await tdRepo.findById(tx, v.id);
  if (!row || row.userId !== user.id || row.tenantId !== user.tenantId) return { cls: "unknown" };
  return trustedDeviceSecretMatches(v.secret, row.tokenHash) ? { cls: "valid", row } : { cls: "reuse" };
}

const isValid = (c: Classified): c is Extract<Classified, { cls: "valid" }> => c.cls === "valid";

/**
 * §5.1 adım 5 (login TX'i, şifre + kilit + geçici şifre denetiminden SONRA, `openSession`'dan ÖNCE). En çok 2 değer
 * denenir. Herhangi biri yeniden kullanımsa: kullanıcının tüm cihazları + tüm açık oturumları iptal, audit `reuse`
 * (fail). Aksi halde ilk geçerli değer TOTP etkin + süresi dolmamış + izinliyse döndürülür (koşullu UPDATE; 0 satır =
 * aynı nesil yarışı → yeniden kullanım) ve `used` audit'i yazılır. Diğer her durumda yalnız çerez silinir.
 */
export async function consumeAtLogin(
  tx: Tx,
  ctx: AuditContext,
  user: TrustedLoginSubject,
  raws: readonly string[],
  now: Date,
): Promise<TrustedLoginOutcome> {
  if (raws.length === 0) return { kind: "none", clearCookie: false };
  const found: Classified[] = [];
  for (const raw of raws.slice(0, TRUSTED_DEVICE_COOKIE_MAX_VALUES)) found.push(await classify(tx, user, raw));
  if (found.some((c) => c.cls === "reuse")) return reuseTx(tx, ctx, user, now);
  const valid = found.find(isValid);
  if (!valid || !user.totpEnabled || valid.row.expiresAt <= now || !rememberAllowed(user)) return { kind: "none", clearCookie: true };
  const secret = newTrustedDeviceSecret();
  const { id, tokenHash, expiresAt, uaSummary: summary } = valid.row;
  const rotated = await tdRepo.rotate(tx, {
    id,
    oldHash: tokenHash,
    newHash: hashTrustedDeviceSecret(secret),
    ip: ctx.ip.slice(0, 45),
    now,
  });
  if (!rotated) return reuseTx(tx, ctx, user, now);
  await writeAudit(tx, ctx, {
    ...whoOf(user),
    action: AUTH_AUDIT.TRUSTED_DEVICE_USED,
    entity: "trusted_devices",
    entityId: id,
    result: "success",
    newValue: { uaSummary: summary },
  });
  return {
    kind: "used",
    cookie: { value: formatTrustedDeviceCookie({ id, secret }), maxAgeSec: trustedDeviceRemainingSec(expiresAt, now) },
  };
}

/** K-P27a-11 / O-P27a-r2-1: aile iptali — tüm cihazlar + tüm açık oturumlar (bu girişin oturumu henüz açılmadı). */
async function reuseTx(tx: Tx, ctx: AuditContext, user: TrustedDeviceOwner, now: Date): Promise<TrustedLoginOutcome> {
  const count = await tdRepo.deleteForUser(tx, user.id);
  const revokedSessions = await revokeUserSessions(tx, user.id, now);
  await writeAudit(tx, ctx, {
    ...whoOf(user),
    action: AUTH_AUDIT.TRUSTED_DEVICE_REUSE,
    entity: "users",
    entityId: user.id,
    result: "fail",
    newValue: { count, revokedSessions },
  });
  return { kind: "reuse", count, revokedSessions };
}

/** `GET /auth/me` `rememberDeviceAvailable`: TOTP etkin + `rememberAllowed` (güncel firma anahtarı). */
export async function rememberAvailable(db: Parameters<typeof findUserById>[0], userId: string): Promise<boolean> {
  const u = await findUserById(db, userId);
  return u !== null && u.totpEnabled && rememberAllowed(u);
}

/**
 * Profil listesi "Bu cihaz" ve silmede çerez temizliği (AC-329): istek çerezlerinden kullanıcıya ait, özeti tutan satırın
 * id'si; yoksa null.
 */
export async function currentTrustedDeviceId(
  db: Parameters<typeof tdRepo.findById>[0],
  userId: string,
  raws: readonly string[],
): Promise<string | null> {
  for (const raw of raws.slice(0, TRUSTED_DEVICE_COOKIE_MAX_VALUES)) {
    const v = parseTrustedDeviceCookie(raw);
    const row = v ? await tdRepo.findById(db, v.id) : null;
    if (v && row && row.userId === userId && trustedDeviceSecretMatches(v.secret, row.tokenHash)) return row.id;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// K3: commit sonrası bildirimler (K-P27a-10; akışı bekletmez, hata yanıtı bozmaz)
// ---------------------------------------------------------------------------------------------------------------

export interface TrustedDeviceNotifyDeps {
  mail: MailService;
  log: { error(o: object, m: string): void };
  /** Yeniden kullanımda iptal edilen oturumların canlı odaları + panel soketleri (logout-all kalıbı). */
  endLive(userId: string): Promise<void>;
}

const mailMeta = (u: TrustedDeviceOwner, kind: string) => ({ ...whoOf(u), kind, entity: "users", entityId: u.id });

/** AC-335a: "Yeni cihaz hatırlandı" (SMTP yoksa `mail.sent{not_configured}` audit'i). */
export function notifyTrustedDeviceCreated(
  d: TrustedDeviceNotifyDeps,
  ctx: AuditContext,
  user: TrustedDeviceOwner,
  dev: IssuedTrustedDevice,
): void {
  const content = trustedDeviceCreatedMail({ uaSummary: dev.uaSummary, ip: dev.ip, at: new Date() });
  void d.mail
    .sendForTenant(ctx, mailMeta(user, "trusted_device_created"), user.email, content)
    .catch((err: unknown) => d.log.error({ err, event: "trusted_device_notify_failed" }, "yeni cihaz bildirimi gönderilemedi"));
}

/** AC-335b: yeniden kullanım e-postası + iptal edilen oturumların canlı etkisi. */
export function afterTrustedDeviceReuse(d: TrustedDeviceNotifyDeps, ctx: AuditContext, user: TrustedDeviceOwner): void {
  void d.mail
    .sendForTenant(ctx, mailMeta(user, "trusted_device_reuse"), user.email, trustedDeviceReuseMail({ at: new Date() }))
    .catch((err: unknown) => d.log.error({ err, event: "trusted_device_notify_failed" }, "yeniden kullanım bildirimi gönderilemedi"));
  void d
    .endLive(user.id)
    .catch((err: unknown) => d.log.error({ err, alarm: "user_live_effect" }, "yeniden kullanım iptali canlı oturuma yansıtılamadı"));
}
