// Sistem ayarları servisi (P11; ADR-0003, G-13; AC-77, AC-78; P12b AC-196). Tablo `system_settings` (anahtar `mysql` |
// `turn` | `whatsapp`). WhatsApp servisi ayrı dosyada: `settings/whatsapp.ts` (ortak `SystemDeps`, `who`, `GLOBAL_KEY` buradan).
// Gizliler AES-256-GCM (`aadFor.systemSecret`), asla dönmez ve loga/audit'e yazılmaz. Yazım upsert (eşzamanlı ilk
// yazım P2002 yarışı yok), eski değer + yazım + audit tek TX.
import {
  MYSQL_APPLY_NOTE,
  MYSQL_DEFAULT_PORT,
  MYSQL_PASSWORD_REQUIRED_MESSAGE,
  MYSQL_TEST_MESSAGES,
  TURN_SECRET_REQUIRED_MESSAGE,
  type MysqlSettingsData,
  type MysqlSettingsSaveResponse,
  type MysqlSettingsView,
  type MysqlTestReason,
  type MysqlTestResponse,
  type TurnSettingsData,
  type TurnSettingsView,
} from "@remote/contracts/api/system-settings";
import { SYSTEM_AUDIT } from "@remote/contracts/audit";
import type { JsonObject } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { TurnConfig } from "../signaling/turn.ts";
import { probeMysql, type ProbeResult, type ProbeTarget } from "./mysql-probe.ts";

export interface SystemDeps {
  db: Db;
  secrets: SecretBox;
  log: { warn(o: object, m: string): void; error(o: object, m: string): void };
  /** Çalışan bağlantı (env). */
  databaseUrl: string;
  turnEnv: { urls: readonly string[]; secret: string | undefined; ttlMin: number };
  /** P12b: `WHATSAPP_SERVICE_URL` (boş → yapılandırılmamış) ve güvensiz adres kuralı için ortam. */
  whatsappEnvUrl: string;
  /** S-P13b-3: `WHATSAPP_SERVICE_API_KEY` (yalnız env adresiyle birlikte gönderilir). */
  whatsappEnvApiKey: string | undefined;
  /** K13 geçici çözümü: `WHATSAPP_ALLOW_INSECURE_HTTP` (yalnız WhatsApp; düz http güvensiz sayılmaz). */
  whatsappAllowInsecureHttp: boolean;
  production: boolean;
  /** P14a (AC-212): `rs_mysql_test_failed_total{class}`. */
  metrics: Pick<Metrics, "inc">;
}

export const who = (auth: AuthContext) => ({ tenantId: null, userId: auth.user.id, username: auth.user.email });

// ---- MySQL ----

interface MysqlTarget {
  host: string;
  port: number;
  database: string;
  user: string;
}
/** Saklanan değer: hedef + P14a (AC-211) "TLS gerekli" (eski satırlarda yok → false). */
interface MysqlCore extends MysqlTarget {
  requireTls: boolean;
}

export function mysqlFromUrl(databaseUrl: string): MysqlTarget & { password: string } {
  const u = new URL(databaseUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : MYSQL_DEFAULT_PORT,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

function asMysqlCore(v: unknown): MysqlCore | null {
  const o = v as Partial<MysqlCore> | null;
  if (!o || typeof o.host !== "string" || typeof o.port !== "number" || typeof o.database !== "string" || typeof o.user !== "string")
    return null;
  return { host: o.host, port: o.port, database: o.database, user: o.user, requireTls: o.requireTls === true };
}

/** Şifrenin bağlı olduğu hedef: host + port + kullanıcı (veritabanı adı değil). */
const sameTarget = (a: MysqlTarget, b: MysqlTarget): boolean =>
  a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port && a.user === b.user;
const sameDb = (a: MysqlTarget, b: MysqlTarget): boolean => sameTarget(a, b) && a.database === b.database;
const sameCore = (a: MysqlCore, b: MysqlCore): boolean => sameDb(a, b) && a.requireTls === b.requireTls;

/**
 * Kayıtlı şifreyi kaydedildiği hedefin AAD'siyle çözer (B-P11-1). Çözülemezse (anahtar rotasyonu, eski AAD biçimi, hedefi
 * DB'de değiştirilmiş satır) null + alarm logu — değer basılmaz; çağıran "kayıtlı şifre yok" sayar.
 */
function openMysqlSecret(d: SystemDeps, core: MysqlCore, secretEnc: Uint8Array): string | null {
  try {
    return d.secrets.decrypt(secretEnc, aadFor.mysqlSecret(core));
  } catch (err) {
    d.log.error({ err, alarm: "system_secret_unreadable", key: "mysql" }, "kayıtlı MySQL şifresi çözülemedi");
    return null;
  }
}

async function readMysql(db: Db) {
  const row = await db.systemSetting.findUnique({ where: { key: "mysql" }, select: { valueJson: true, secretEnc: true, updatedAt: true } });
  const core = row ? asMysqlCore(row.valueJson) : null;
  return row && core ? { core, secretEnc: row.secretEnc, updatedAt: row.updatedAt } : null;
}

export async function getMysqlSettings(d: SystemDeps): Promise<MysqlSettingsView> {
  const running = mysqlFromUrl(d.databaseUrl);
  const rec = await readMysql(d.db);
  if (!rec) {
    const { password, ...core } = running;
    return { ...core, requireTls: false, hasPassword: password !== "", updatedAt: null, source: "env", matchesRunning: true };
  }
  const hasPassword = rec.secretEnc !== null && openMysqlSecret(d, rec.core, rec.secretEnc) !== null;
  return { ...rec.core, hasPassword, updatedAt: rec.updatedAt.toISOString(), source: "panel", matchesRunning: sameDb(rec.core, running) };
}

/**
 * PUT. B-P11-1: kayıtlı şifre varken host/port/kullanıcı değişiyorsa şifre zorunlu (400 `fields.password`) — kayıtlı şifre
 * yeni hedefe taşınmaz. Şifre hedefe bağlı AAD ile saklanır (`aadFor.mysqlSecret`).
 */
export async function saveMysqlSettings(
  d: SystemDeps,
  ctx: AuditContext,
  auth: AuthContext,
  input: MysqlSettingsData,
): Promise<MysqlSettingsSaveResponse> {
  const core: MysqlCore = { host: input.host, port: input.port, database: input.database, user: input.user, requireTls: input.requireTls };
  await d.db.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key: "mysql" }, select: { valueJson: true, secretEnc: true } });
    const old = before ? asMysqlCore(before.valueJson) : null;
    if (input.password === undefined && before?.secretEnc && !(old && sameTarget(old, core)))
      throw new AppError("VALIDATION", { fields: { password: MYSQL_PASSWORD_REQUIRED_MESSAGE } });
    // P13a (B-P12b-5): değer değişmediyse (aynı hedef + veritabanı + TLS seçimi, yeni şifre yok) yazım ve audit yok.
    if (old && sameCore(old, core) && input.password === undefined) return;
    const secretEnc = input.password !== undefined ? d.secrets.encrypt(input.password, aadFor.mysqlSecret(core)) : undefined;
    await tx.systemSetting.upsert({
      where: { key: "mysql" },
      create: { key: "mysql", valueJson: { ...core }, secretEnc: secretEnc ?? null, updatedBy: auth.user.id },
      update: { valueJson: { ...core }, ...(secretEnc ? { secretEnc } : {}), updatedBy: auth.user.id },
    });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: SYSTEM_AUDIT.MYSQL_UPDATED,
      entity: "system_settings",
      entityId: "mysql",
      result: "success",
      ...(old ? { oldValue: { ...old } as JsonObject } : {}),
      newValue: { ...core, ...(input.password !== undefined ? { password: "changed" } : {}) },
    });
  });
  return { ...(await getMysqlSettings(d)), restartRequired: true, message: MYSQL_APPLY_NOTE };
}

/** P14a (AC-212) metrik sınıfı: connect|auth|tls|timeout; veritabanı yok / kayıtlı şifre okunamadı → other. */
export const mysqlFailureClass = (r: MysqlTestReason): "connect" | "auth" | "tls" | "timeout" | "other" =>
  r === "connect" || r === "auth" || r === "tls" || r === "timeout" ? r : "other";

/** Test hız kovaları: kişi başı (AC-77, 5/dk) + tüm Super Admin'ler için ortak (B-P11-4, 20/dk). */
interface MysqlTestLimits {
  perUser: FixedWindowCounter;
  global: FixedWindowCounter;
}
export const GLOBAL_KEY = "all";

/** Kişi başı + global test kovası (biri kilitliyse ya da bu istek doldurursa 429). */
function hitTestLimits(limits: MysqlTestLimits, userId: string): void {
  const wait = Math.max(limits.perUser.blockedFor(userId), limits.global.blockedFor(GLOBAL_KEY));
  if (wait > 0 || limits.perUser.hit(userId) || limits.global.hit(GLOBAL_KEY))
    throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
}

/** Boş şifre: yalnız aynı hedefe ait kayıtlı (panel) ya da env şifresi; ikisi de yoksa 400, çözülemezse `unreadable`. */
async function testPassword(
  d: SystemDeps,
  core: MysqlCore,
  given: string | undefined,
): Promise<{ password: string | undefined; unreadable: boolean }> {
  let password = given;
  let unreadable = false;
  if (password === undefined) {
    const rec = await readMysql(d.db);
    if (rec?.secretEnc) {
      if (sameTarget(rec.core, core)) {
        const stored = openMysqlSecret(d, rec.core, rec.secretEnc);
        if (stored === null) unreadable = true;
        else password = stored;
      }
    } else {
      const running = mysqlFromUrl(d.databaseUrl);
      if (sameTarget(running, core)) password = running.password;
    }
    if (password === undefined && !unreadable) throw new AppError("VALIDATION", { fields: { password: MYSQL_PASSWORD_REQUIRED_MESSAGE } });
  }
  return { password, unreadable };
}

/** Ham sürücü hatası yalnız loga (kısaltılmış mesaj + ref); şifre alanı yok. */
function logProbeFailure(d: SystemDeps, reason: MysqlTestReason, err: unknown): void {
  const e = err as { errno?: unknown; code?: unknown; message?: unknown };
  d.log.warn(
    {
      event: "mysql_test_failed",
      ref: newId(),
      reason,
      errno: e.errno,
      code: e.code,
      msg: typeof e.message === "string" ? e.message.slice(0, 300) : undefined,
    },
    "MySQL bağlantı testi başarısız",
  );
}

/**
 * POST /admin/settings/mysql/test. Şifre boşsa kayıtlı (panel) ya da env şifresi — YALNIZ hedef host/port/kullanıcı o
 * kaynağınkiyle aynıysa (şifre başka sunucuya gönderilmez; caching_sha2 açık anahtar akışında karşı taraf düz şifreyi
 * alabilir). Aksi 400 `fields.password`. Panel şifresi ayrıca hedefe bağlı AAD ile çözülür (B-P11-1); çözülemezse
 * `secret_unreadable`. Hız: 5/dk/kullanıcı + 20/dk global. Başarısızlıkta süre dönmez (B-P11-4: port tarama sinyali).
 * Sonuç ve sınıf audit'e, ham hata yalnız loga.
 */
export async function testMysql(
  d: SystemDeps,
  ctx: AuditContext,
  auth: AuthContext,
  input: MysqlSettingsData,
  limits: MysqlTestLimits,
  probe: (t: ProbeTarget) => Promise<ProbeResult> = probeMysql,
): Promise<MysqlTestResponse> {
  hitTestLimits(limits, auth.user.id);
  const core: MysqlCore = { host: input.host, port: input.port, database: input.database, user: input.user, requireTls: input.requireTls };
  const { password, unreadable } = await testPassword(d, core, input.password);
  const out: ProbeResult =
    unreadable || password === undefined
      ? { ok: false, reason: "secret_unreadable", latencyMs: 0, err: null }
      : await probe({ ...core, password });
  if (!out.ok) d.metrics.inc("rs_mysql_test_failed_total", { class: mysqlFailureClass(out.reason) });
  if (!out.ok && out.err) logProbeFailure(d, out.reason, out.err);
  await writeAudit(d.db, ctx, {
    ...who(auth),
    action: SYSTEM_AUDIT.MYSQL_TEST,
    entity: "system_settings",
    entityId: "mysql",
    result: out.ok ? "success" : "fail",
    newValue: { ...core, result: out.ok ? "success" : "fail", ...(out.ok ? { latencyMs: out.latencyMs } : { reason: out.reason }) },
  });
  return { ok: out.ok, message: MYSQL_TEST_MESSAGES[out.ok ? "ok" : out.reason], latencyMs: out.ok ? out.latencyMs : null };
}

// ---- TURN ----

const hasTurnUrl = (urls: readonly string[]): boolean => urls.some((u) => /^turns?:/.test(u));

/** Panel URL listesi; `{urls: []}` (DELETE sonrası "varsayılana dön" satırı) veya bozuk kayıt → null (env). */
function asUrls(v: unknown): string[] | null {
  const o = v as { urls?: unknown } | null;
  return o && Array.isArray(o.urls) && o.urls.length > 0 && o.urls.every((u) => typeof u === "string") ? (o.urls as string[]) : null;
}

export async function getTurnSettings(d: SystemDeps): Promise<TurnSettingsView> {
  const row = await d.db.systemSetting.findUnique({
    where: { key: "turn" },
    select: { valueJson: true, secretEnc: true, updatedAt: true },
  });
  const urls = row ? asUrls(row.valueJson) : null;
  if (!row || !urls) return { urls: [...d.turnEnv.urls], hasSecret: Boolean(d.turnEnv.secret), source: "env", updatedAt: null };
  return { urls, hasSecret: row.secretEnc !== null, source: "panel", updatedAt: row.updatedAt.toISOString() };
}

/** Etkin TURN yapılandırması: panel kaydı varsa o (secret çözülemezse yalnız STUN + alarm), yoksa env. */
export async function effectiveTurn(d: SystemDeps): Promise<TurnConfig> {
  const row = await d.db.systemSetting.findUnique({ where: { key: "turn" }, select: { valueJson: true, secretEnc: true } });
  const urls = row ? asUrls(row.valueJson) : null;
  if (!row || !urls) return { urls: [...d.turnEnv.urls], secret: d.turnEnv.secret, ttlMin: d.turnEnv.ttlMin };
  let secret: string | undefined;
  if (row.secretEnc) {
    try {
      secret = d.secrets.decrypt(row.secretEnc, aadFor.systemSecret("turn"));
    } catch (err) {
      d.log.error({ err, alarm: "system_secret_unreadable", key: "turn" }, "TURN secret çözülemedi; yalnız STUN verilecek");
    }
  }
  return { urls, secret, ttlMin: d.turnEnv.ttlMin };
}

export async function saveTurnSettings(
  d: SystemDeps,
  ctx: AuditContext,
  auth: AuthContext,
  input: TurnSettingsData,
): Promise<TurnSettingsView> {
  await d.db.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key: "turn" }, select: { valueJson: true, secretEnc: true } });
    if (hasTurnUrl(input.urls) && input.secret === undefined && !before?.secretEnc)
      throw new AppError("VALIDATION", { fields: { secret: TURN_SECRET_REQUIRED_MESSAGE } });
    const oldUrls = before ? asUrls(before.valueJson) : null;
    // P13a (B-P12b-5): aynı adres listesi (sıra dahil) ve yeni secret yok → yazım ve audit yok.
    if (oldUrls && input.secret === undefined && oldUrls.length === input.urls.length && oldUrls.every((u, i) => u === input.urls[i]))
      return;
    const secretEnc = input.secret !== undefined ? d.secrets.encrypt(input.secret, aadFor.systemSecret("turn")) : undefined;
    await tx.systemSetting.upsert({
      where: { key: "turn" },
      create: { key: "turn", valueJson: { urls: input.urls }, secretEnc: secretEnc ?? null, updatedBy: auth.user.id },
      update: { valueJson: { urls: input.urls }, ...(secretEnc ? { secretEnc } : {}), updatedBy: auth.user.id },
    });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: SYSTEM_AUDIT.TURN_UPDATED,
      entity: "system_settings",
      entityId: "turn",
      result: "success",
      ...(oldUrls ? { oldValue: { urls: oldUrls } } : {}),
      newValue: { urls: input.urls, ...(input.secret !== undefined ? { secret: "changed" } : {}) },
    });
  });
  return getTurnSettings(d);
}

/**
 * DELETE: panel kaydı kaldırılır → env. app'te system_settings DELETE yetkisi yok (db-notlari P11: "kaldırma = varsayılana
 * dönüş, satır kalır") → satır `{urls: []}` + secret NULL'a çekilir; okuyucular bunu "panel yok" sayar. İdempotent:
 * zaten env ise değişiklik/audit yok.
 */
export async function deleteTurnSettings(d: SystemDeps, ctx: AuditContext, auth: AuthContext): Promise<TurnSettingsView> {
  await d.db.$transaction(async (tx) => {
    const before = await tx.systemSetting.findUnique({ where: { key: "turn" }, select: { valueJson: true, secretEnc: true } });
    const oldUrls = before ? asUrls(before.valueJson) : null;
    if (!before || (!oldUrls && !before.secretEnc)) return;
    await tx.systemSetting.update({ where: { key: "turn" }, data: { valueJson: { urls: [] }, secretEnc: null, updatedBy: auth.user.id } });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: SYSTEM_AUDIT.TURN_DELETED,
      entity: "system_settings",
      entityId: "turn",
      result: "success",
      ...(oldUrls ? { oldValue: { urls: oldUrls } } : {}),
      newValue: { source: "env" },
    });
  });
  return getTurnSettings(d);
}
