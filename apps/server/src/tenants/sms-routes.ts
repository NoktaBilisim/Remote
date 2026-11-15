// /api/v1/settings/sms (P19 J3, mimari-e11 §8c.4; AC-260; ortak standart §2.3, §3). Etkin tenant; Admin kendi firmasında.
//  - GET (settings.view): anahtar ASLA dönmez; sistem varsayılan adresi gösterilmez (`defaultUrl` yalnız var/yok).
//  - PUT (settings.edit; 30/dk/tenant): WA kalıbı (S-P13b-3) — `apiKey` yok/"" → korunur (köken değişmediyse; değiştiyse
//    400 `fields.apiKey`), `null` → silinir, dolu → AAD etkin kökene bağlı şifrelenir. Tenant adresi kayıtta netguard'dan
//    geçer (400 HOST_NOT_ALLOWED); production'da https + 443 (400 `fields.url`; K-P19-10). Değişmeyen kayıt → yazım/audit yok.
//    Audit `settings.sms_updated` eski→yeni tek TX (anahtar `***`).
//  - POST /test (settings.edit; 5/dk/kullanıcı, 20/dk/tenant, alıcı 3/sa — S-P19-T7): sabit metin, tek deneme, sabit mesaj.
import {
  SMS_API_KEY_REENTER,
  SMS_PORT_MESSAGE,
  SMS_TEST_MESSAGES,
  SMS_TEST_RECIPIENT_PER_HOUR,
  SMS_TEST_TEXT,
  SMS_TR_ONLY_MESSAGE,
  smsSettingsInputSchema,
  smsTestInputSchema,
  toSmsPhone,
  type SmsSettingsData,
  type SmsSettingsView,
  type SmsTestReason,
  type SmsTestResponse,
} from "@remote/contracts/api/notify";
import { NOTIFY_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance } from "fastify";
import { MASK, maskPhone } from "../audit/mask.ts";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import type { AuthContext } from "../auth/session.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import type { NetGuard } from "../lib/netguard.ts";
import { publicReason } from "../lib/outbound.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { recipientHash } from "../notify/outbox.ts";
import { originOf, SmsClient, tenantUrlPortOk } from "../notify/sms.ts";

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

interface SmsSettingsDeps {
  db: Db;
  sms: SmsClient;
  secrets: SecretBox;
  netguard: NetGuard;
  envUrl: string;
  production: boolean;
}

async function getSmsSettings(d: SmsSettingsDeps, tenantId: string): Promise<SmsSettingsView> {
  const s = await d.sms.state(tenantId);
  return {
    url: s.tenantUrl ? s.url : null,
    defaultUrl: d.sms.defaultUrlSet,
    header: s.header,
    apiKeySet: s.apiKeySet,
    keyUnreadable: s.keyUnreadable,
    insecure: s.insecure,
    usable: SmsClient.usable(s),
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}

async function updateSmsSettings(
  d: SmsSettingsDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: SmsSettingsData,
): Promise<SmsSettingsView> {
  if (input.url !== null) {
    if (!tenantUrlPortOk(input.url, d.production)) throw new AppError("VALIDATION", { fields: { url: SMS_PORT_MESSAGE } });
    await d.netguard.resolve(new URL(input.url).hostname); // S-P19-5: kayıtta da (400 HOST_NOT_ALLOWED)
  }
  const nextEffective = input.url ?? (d.envUrl !== "" ? d.envUrl : null);
  await d.db.$transaction(async (tx) => {
    const cur = await tx.tenantSettings.findUnique({
      where: { tenantId },
      select: { smsUrl: true, smsApiKeyEnc: true, smsHeader: true },
    });
    if (!cur) throw new AppError("NOT_FOUND");
    const curEffective = cur.smsUrl ?? (d.envUrl !== "" ? d.envUrl : null);
    let enc = cur.smsApiKeyEnc;
    let keyChanged = false;
    if (input.apiKey === null) {
      keyChanged = enc !== null;
      enc = null;
    } else if (input.apiKey !== undefined && input.apiKey !== "") {
      if (!nextEffective) throw new AppError("VALIDATION", { fields: { url: "Önce SMS servis adresini girin." } });
      enc = Buffer.from(d.secrets.encrypt(input.apiKey, aadFor.smsApiKey(tenantId, originOf(nextEffective))));
      keyChanged = true;
    } else if (enc !== null && (!nextEffective || !curEffective || originOf(nextEffective) !== originOf(curEffective))) {
      // Kayıtlı anahtar eski kökene bağlı; yeni adrese taşınmaz (S-P19-6).
      throw new AppError("VALIDATION", { fields: { apiKey: SMS_API_KEY_REENTER } });
    }
    if (!keyChanged && cur.smsUrl === input.url && cur.smsHeader === input.header) return;
    await tx.tenantSettings.update({
      where: { tenantId },
      data: { smsUrl: input.url, smsHeader: input.header, smsApiKeyEnc: enc },
    });
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: NOTIFY_AUDIT.SMS_UPDATED,
      entity: "tenant_settings",
      entityId: tenantId,
      result: "success",
      oldValue: { url: cur.smsUrl, header: cur.smsHeader, apiKeySet: cur.smsApiKeyEnc !== null },
      newValue: {
        url: input.url,
        header: input.header,
        apiKeySet: enc !== null,
        apiKey: enc !== null ? MASK : null,
        apiKeyChanged: keyChanged,
      },
    });
  });
  return getSmsSettings(d, tenantId);
}

interface SmsTestLimits {
  user: FixedWindowCounter;
  tenant: FixedWindowCounter;
  recipient: FixedWindowCounter;
}

async function testSms(
  d: SmsSettingsDeps,
  limits: SmsTestLimits,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  phone: string,
): Promise<SmsTestResponse> {
  if (!toSmsPhone(phone)) throw new AppError("VALIDATION", { fields: { phone: SMS_TR_ONLY_MESSAGE } });
  const hash = recipientHash(d.secrets, "SMS", phone);
  for (const [counter, key] of [
    [limits.user, auth.user.id],
    [limits.tenant, tenantId],
    [limits.recipient, `${tenantId}|${hash}`],
  ] as const) {
    const wait = counter.blockedFor(key);
    if (wait > 0 || counter.hit(key)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  }
  const raw = await d.sms.send(tenantId, phone, SMS_TEST_TEXT);
  const reason: SmsTestReason | null =
    raw === "ok" ? null : raw === "invalid_phone" || raw === "unconfigured" ? "unconfigured" : publicReason(raw);
  await writeAudit(d.db, ctx, {
    tenantId,
    userId: auth.user.id,
    username: auth.user.email,
    action: NOTIFY_AUDIT.SMS_TEST,
    entity: "tenant_settings",
    entityId: tenantId,
    result: reason ? "fail" : "success",
    newValue: { recipient: maskPhone(phone), result: reason ? "fail" : "success", ...(reason ? { reason } : {}) },
  });
  return reason ? { ok: false, message: SMS_TEST_MESSAGES[reason], reason } : { ok: true, message: SMS_TEST_MESSAGES.ok, reason: null };
}

export async function smsSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.addHook("onSend", async (_req, reply) => {
    void reply.header("Cache-Control", "no-store");
  });
  const putLimit = new FixedWindowCounter(31, MIN_MS, MIN_MS);
  const testLimits: SmsTestLimits = {
    user: new FixedWindowCounter(6, MIN_MS, MIN_MS),
    tenant: new FixedWindowCounter(21, MIN_MS, MIN_MS),
    recipient: new FixedWindowCounter(SMS_TEST_RECIPIENT_PER_HOUR + 1, HOUR_MS, HOUR_MS),
  };
  app.addHook("onClose", async () => {
    putLimit.close();
    for (const c of Object.values(testLimits)) c.close();
  });
  const deps = (): SmsSettingsDeps => ({
    db: app.db,
    sms: app.sms,
    secrets: app.secrets,
    netguard: app.netguard,
    envUrl: app.env.SMSPORTAL_URL,
    production: app.env.NODE_ENV === "production",
  });

  app.get("", { preHandler: requirePerm("settings.view") }, async (req): Promise<SmsSettingsView> =>
    getSmsSettings(deps(), tenantScope(req).tenantId),
  );

  app.put("", { preHandler: requirePerm("settings.edit") }, async (req): Promise<SmsSettingsView> => {
    const { tenantId } = tenantScope(req);
    const wait = putLimit.blockedFor(tenantId);
    if (wait > 0 || putLimit.hit(tenantId)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
    const input = parseInput(smsSettingsInputSchema, req.body);
    return updateSmsSettings(deps(), auditContext(req), authOf(req), tenantId, input);
  });

  app.post("/test", { preHandler: requirePerm("settings.edit") }, async (req): Promise<SmsTestResponse> => {
    const { tenantId } = tenantScope(req);
    const { phone } = parseInput(smsTestInputSchema, req.body);
    return testSms(deps(), testLimits, auditContext(req), authOf(req), tenantId, phone);
  });
}
