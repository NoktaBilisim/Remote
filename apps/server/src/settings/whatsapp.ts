// Super Admin WhatsApp servis ayarı (P12b AC-196, mimari-e9 T33; S-P13b-3 servis anahtarı). `settings/system.ts`'ten
// taşındı (QA tur 2: dosya boyutu); davranış aynı. Tablo `system_settings` anahtar `whatsapp`: value_json `{url}`,
// secret_enc = servis anahtarı (AES-256-GCM, AAD adres kökenine bağlı). Yazım + audit tek TX.
import {
  WA_API_KEY_REENTER,
  type WhatsappAdminTestResponse,
  type WhatsappSettingsData,
  type WhatsappSettingsView,
} from "@remote/contracts/api/system-settings";
import { SYSTEM_AUDIT } from "@remote/contracts/audit";
import { MASK, maskPhone } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { aadFor } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { isInsecureServiceTarget, isInsecureTargetAllowed } from "../notify/service-url.ts";
import type { WhatsappNotifier } from "../notify/whatsapp.ts";
import { GLOBAL_KEY, who, type SystemDeps } from "./system.ts";

/** Panel adresi; `{url: null}` (DELETE sonrası "env'e dön" satırı) veya bozuk kayıt → null (env). */
function asWaUrl(v: unknown): string | null {
  const o = v as { url?: unknown } | null;
  return o && typeof o.url === "string" && o.url !== "" ? o.url : null;
}

async function readWhatsapp(db: Pick<Db, "systemSetting">) {
  const row = await db.systemSetting.findUnique({
    where: { key: "whatsapp" },
    select: { valueJson: true, secretEnc: true, updatedAt: true },
  });
  const url = row ? asWaUrl(row.valueJson) : null;
  return row && url ? { url, secretEnc: row.secretEnc, updatedAt: row.updatedAt } : null;
}

const originOf = (url: string): string => new URL(url).origin;

/** Audit izdüşümü: anahtarın kendisi asla; varsa `apiKey: "***"` + `apiKeySet` (mask.ts izinli boolean). */
const waKeyAudit = (set: boolean) => ({ apiKeySet: set, ...(set ? { apiKey: MASK } : {}) });
const envKeyActive = (d: Pick<SystemDeps, "whatsappEnvUrl" | "whatsappEnvApiKey">): boolean =>
  d.whatsappEnvUrl !== "" && Boolean(d.whatsappEnvApiKey);

/** Etkin hedef (notifier'a uygulanır): adres ve onunla birlikte gelen anahtar. Anahtar asla dönmez/loglanmaz. */
interface WhatsappTarget {
  url: string;
  apiKey: string | null;
}

/**
 * Panel kaydı > env (`""` = yapılandırılmamış). Anahtar adresiyle birlikte gelir: panel adresi → panel anahtarı (kökene
 * bağlı AAD), env adresi → `WHATSAPP_SERVICE_API_KEY`. Panel anahtarı çözülemezse (anahtar rotasyonu/bozulma) başlık
 * gönderilmez (servis 401 → "Servis anahtarı reddetti"), alarm logu düşer.
 */
export async function effectiveWhatsappTarget(
  d: Pick<SystemDeps, "db" | "secrets" | "log" | "whatsappEnvUrl" | "whatsappEnvApiKey">,
): Promise<WhatsappTarget> {
  const rec = await readWhatsapp(d.db);
  if (!rec) return { url: d.whatsappEnvUrl, apiKey: d.whatsappEnvUrl !== "" ? (d.whatsappEnvApiKey ?? null) : null };
  return { url: rec.url, apiKey: rec.secretEnc ? decryptWaKey(d, rec.url, rec.secretEnc) : null };
}

function decryptWaKey(d: Pick<SystemDeps, "secrets" | "log">, url: string, enc: Uint8Array): string | null {
  try {
    return d.secrets.decrypt(enc, aadFor.whatsappApiKey(originOf(url)));
  } catch {
    d.log.error({ alarm: "whatsapp_api_key_unreadable" }, "WhatsApp servis anahtarı çözülemedi: başlıksız gönderilecek");
    return null;
  }
}

export async function getWhatsappSettings(d: SystemDeps): Promise<WhatsappSettingsView> {
  const rec = await readWhatsapp(d.db);
  const url = rec?.url ?? (d.whatsappEnvUrl || null);
  const apiKeySource = rec ? (rec.secretEnc ? "panel" : null) : url !== null && d.whatsappEnvApiKey ? "env" : null;
  const hasKey = apiKeySource !== null;
  return {
    url,
    source: rec ? "panel" : "env",
    insecure: url !== null && isInsecureServiceTarget(url, hasKey, d.production, d.whatsappAllowInsecureHttp),
    insecureAllowed: url !== null && isInsecureTargetAllowed(url, hasKey, d.production, d.whatsappAllowInsecureHttp),
    updatedAt: rec?.updatedAt.toISOString() ?? null,
    apiKeySet: apiKeySource !== null,
    apiKeySource,
  };
}

/**
 * PUT: upsert + audit eski→yeni tek TX. Güvensiz adres de kaydedilir (kanal kapalı kalır, AC-196).
 * `apiKey` (S-P13b-3): yok/`""` → kayıtlı panel anahtarı korunur (yalnız adres kökeni aynıysa; köken değişirse 400
 * `fields.apiKey`, anahtar yeni adrese taşınmaz), `null` → silinir, dolu → şifrelenip yazılır. Audit'te anahtar yalnız
 * `apiKey: "***"` / `null` (mask.ts `key` kalıbı) — değer hiçbir zaman. Dönüş = uygulanacak etkin hedef (B-P12b-2).
 */
export async function saveWhatsappSettings(
  d: SystemDeps,
  ctx: AuditContext,
  auth: AuthContext,
  input: WhatsappSettingsData,
): Promise<WhatsappTarget> {
  return d.db.$transaction(async (tx) => {
    const before = await readWhatsapp(tx);
    const keep = input.apiKey === undefined || input.apiKey === "";
    const sameOrigin = before !== null && originOf(before.url) === originOf(input.url);
    if (keep && before?.secretEnc && !sameOrigin) throw new AppError("VALIDATION", { fields: { apiKey: WA_API_KEY_REENTER } });
    const prevKey = before?.secretEnc ? decryptWaKey(d, before.url, before.secretEnc) : null;
    const nextKey = keep ? prevKey : (input.apiKey ?? null);
    const keyUnchanged = keep || (input.apiKey === null ? before?.secretEnc == null : prevKey === input.apiKey);
    if (before?.url === input.url && keyUnchanged) {
      return { url: input.url, apiKey: nextKey }; // P13a (B-P12b-5): değişmeyen kayıt → yazım ve audit yok
    }
    const secretEnc = keep
      ? (before?.secretEnc ?? null)
      : nextKey === null
        ? null
        : d.secrets.encrypt(nextKey, aadFor.whatsappApiKey(originOf(input.url)));
    const data = { valueJson: { url: input.url }, secretEnc, updatedBy: auth.user.id };
    await tx.systemSetting.upsert({ where: { key: "whatsapp" }, create: { key: "whatsapp", ...data }, update: data });
    const oldValue = before
      ? { url: before.url, source: "panel", ...waKeyAudit(before.secretEnc !== null) }
      : { url: d.whatsappEnvUrl || null, source: "env", ...waKeyAudit(envKeyActive(d)) };
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: SYSTEM_AUDIT.WHATSAPP_UPDATED,
      entity: "system_settings",
      entityId: "whatsapp",
      result: "success",
      oldValue,
      newValue: { url: input.url, source: "panel", ...waKeyAudit(secretEnc !== null), apiKeyChanged: !keep },
    });
    return { url: input.url, apiKey: nextKey };
  });
}

/**
 * DELETE: env'e dön (adres + panel anahtarı). app'te system_settings DELETE yetkisi yok → satır `{url: null}`, `secret_enc`
 * NULL (TURN kalıbı). İdempotent: panel kaydı yoksa değişiklik/audit yok.
 */
export async function deleteWhatsappSettings(d: SystemDeps, ctx: AuditContext, auth: AuthContext): Promise<WhatsappTarget> {
  await d.db.$transaction(async (tx) => {
    const before = await readWhatsapp(tx);
    if (!before) return;
    await tx.systemSetting.update({
      where: { key: "whatsapp" },
      data: { valueJson: { url: null }, secretEnc: null, updatedBy: auth.user.id },
    });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: SYSTEM_AUDIT.WHATSAPP_DELETED,
      entity: "system_settings",
      entityId: "whatsapp",
      result: "success",
      oldValue: { url: before.url, source: "panel", ...waKeyAudit(before.secretEnc !== null) },
      newValue: { url: d.whatsappEnvUrl || null, source: "env", ...waKeyAudit(envKeyActive(d)) },
    });
  });
  return effectiveWhatsappTarget(d); // panel kaydı yok → etkin hedef env
}

/** Test hız kovaları: kişi başı (AC-196, 5/dk) + tüm Super Admin'ler için ortak (B-P12b-5, 20/dk; MySQL testi kalıbı). */
interface WhatsappTestLimits {
  perUser: FixedWindowCounter;
  global: FixedWindowCounter;
}

/**
 * POST /admin/settings/whatsapp/test (AC-196): 5/dk/kullanıcı + 20/dk global (6./21. → 429); etkin adrese tek deneme (notifier: 8 sn,
 * yönlendirme izlenmez; güvensiz/yapılandırılmamış → istek yok). Sonuç 200 `{ok, message}` (sabit mesaj); audit numara
 * maskeli + sonuç + neden.
 */
export async function testWhatsapp(
  d: SystemDeps,
  ctx: AuditContext,
  auth: AuthContext,
  phone: string,
  limits: WhatsappTestLimits,
  notifier: WhatsappNotifier,
): Promise<WhatsappAdminTestResponse> {
  const wait = Math.max(limits.perUser.blockedFor(auth.user.id), limits.global.blockedFor(GLOBAL_KEY));
  if (wait > 0 || limits.perUser.hit(auth.user.id) || limits.global.hit(GLOBAL_KEY))
    throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  const out = await notifier.test(phone);
  await writeAudit(d.db, ctx, {
    ...who(auth),
    action: SYSTEM_AUDIT.WHATSAPP_TEST,
    entity: "system_settings",
    entityId: "whatsapp",
    result: out.ok ? "success" : "fail",
    // QA: tenant testiyle (AC-152) aynı anahtar `recipient` — audit görünümü (OUTBOUND_KEYS) bu alanı gösterir.
    newValue: { recipient: maskPhone(phone), result: out.ok ? "success" : "fail", ...(out.reason ? { reason: out.reason } : {}) },
  });
  return { ok: out.ok, message: out.message };
}
