// P28e "Oturum kaydı" ayarı (mimari-p28e r2 §5 GET/PUT `/settings/recording`, §6.5, §11.1, §11.5; AC-380, 447, S-P28e-4/8/9).
// Geçiş kuralları mevcut değere bağlı (serviste): kayıt false→true `consentUpdated`; gözetimsiz false→true `employeeNoticeAck`
// + step-up (tüketmez; P28u `assertEnable` kalıbı); `retentionDays ≤ tenant.retention_days`. TX kilit sırası (S-P28e-9):
// `tenant_settings FOR UPDATE` → `lockTenantRecording` (tenants → kayıtlar). Kapatma ilgili ACTIVE kayıtları aynı TX'te
// `STOPPED{POLICY_OFF}` yapar; commit sonrası oda yayını + belirteç payı. Gözetimsiz anahtar iki yönde değişince dört göz
// e-postası `recording_policy` (beklenmez). `retentionDays` yalnız yeni kayıtlara (K-P28e-22).
import type { FastifyInstance } from "fastify";
import {
  REC_CONSENT_UPDATED_REQUIRED_MESSAGE,
  REC_EMPLOYEE_NOTICE_REQUIRED_MESSAGE,
  REC_RETENTION_EXCEEDS_MESSAGE,
  putRecordingSettingsInputSchema,
  type PutRecordingSettingsInput,
  type RecordingSettingsView,
} from "@remote/contracts/api/recording";
import { STEP_UP_MAX_AGE_SEC } from "@remote/contracts/api/auth";
import { RECORDING_SETTINGS_AUDIT } from "@remote/contracts/audit";
import { REC_RETENTION_MAX } from "@remote/contracts/ws-rec";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import type { AuthContext } from "../auth/session.ts";
import { tenantStorage } from "../fsrv/usage.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import * as repo from "../rec/repo.ts";
import type { RecServiceImpl } from "../rec/service.ts";
import { holdersOf, recordingPolicyMail, sendSilentNotice } from "../unattended/mail.ts";

export async function getRecordingSettings(svc: RecServiceImpl, tenantId: string, userId: string): Promise<RecordingSettingsView> {
  const db = svc.d.db;
  const [s, storage, others] = await Promise.all([
    repo.settingsOf(db, tenantId),
    tenantStorage(db, tenantId),
    holdersOf(db, tenantId, ["unattended.manage"], userId),
  ]);
  return {
    enabled: s.enabled,
    retentionDays: s.retentionDays,
    unattendedEnabled: s.unattendedEnabled,
    ...(s.unattendedAckAt ? { unattendedAckAt: s.unattendedAckAt.toISOString() } : {}),
    storage,
    maxRetentionDays: Math.min(s.sessionRetentionDays, REC_RETENTION_MAX),
    soleManager: others.length === 0,
  };
}

/** Gözetimsiz anahtar açılırken: kutu (400) → 2FA kurulu → son 5 dk'da step-up (401). */
function assertUnattendedEnable(auth: AuthContext, input: PutRecordingSettingsInput, now: number): void {
  if (input.employeeNoticeAck !== true)
    throw new AppError("VALIDATION", { fields: { employeeNoticeAck: REC_EMPLOYEE_NOTICE_REQUIRED_MESSAGE } });
  if (!auth.totpEnabled) throw new AppError("MFA_SETUP_REQUIRED");
  const at = auth.stepUpAt?.getTime();
  if (at === undefined || now - at > STEP_UP_MAX_AGE_SEC * 1000) throw new AppError("MFA_STEP_UP_REQUIRED");
}

export interface RecordingSettingsChange {
  old: { enabled: boolean; retentionDays: number; unattendedEnabled: boolean };
  changed: boolean;
  /** Commit sonrası yayınlanacak durdurulmuş kayıtlar. */
  stopped: { rid: string; sessionId: string }[];
}

export async function putRecordingSettings(
  svc: RecServiceImpl,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: PutRecordingSettingsInput,
): Promise<RecordingSettingsChange> {
  const now = new Date(svc.d.clock.now());
  const r = await svc.d.db.$transaction(async (tx) => {
    const cur = await repo.lockSettings(tx, tenantId, "update");
    if (!cur) throw new AppError("NOT_FOUND");
    const old = { enabled: cur.enabled, retentionDays: cur.retentionDays, unattendedEnabled: cur.unattendedEnabled };
    const next = {
      enabled: input.enabled,
      retentionDays: input.retentionDays,
      unattendedEnabled: input.enabled && input.unattendedEnabled,
    };
    if (JSON.stringify(old) === JSON.stringify(next)) return { old, changed: false, stopped: [] };
    if (next.enabled && !old.enabled && input.consentUpdated !== true)
      throw new AppError("VALIDATION", { fields: { consentUpdated: REC_CONSENT_UPDATED_REQUIRED_MESSAGE } });
    if (next.retentionDays > cur.sessionRetentionDays)
      throw new AppError("VALIDATION", { fields: { retentionDays: REC_RETENTION_EXCEEDS_MESSAGE } });
    const unattendedOn = next.unattendedEnabled && !old.unattendedEnabled;
    if (unattendedOn) assertUnattendedEnable(auth, input, now.getTime());
    await tx.tenantSettings.update({
      where: { tenantId },
      data: {
        recordingEnabled: next.enabled,
        recordingRetentionDays: next.retentionDays,
        unattendedRecordingEnabled: next.unattendedEnabled,
        ...(unattendedOn ? { unattendedRecordingAckAt: now, unattendedRecordingAckBy: auth.user.id } : {}),
      },
      select: { tenantId: true },
    });
    // §6.5: kapanan dayanakların ACTIVE kayıtları (kilit sırası §5.5).
    const bases = !next.enabled ? ["CONSENT", "TENANT_POLICY"] : !next.unattendedEnabled && old.unattendedEnabled ? ["TENANT_POLICY"] : [];
    const active =
      bases.length === 0
        ? []
        : await tx.sessionRecording.findMany({ where: { tenantId, state: "ACTIVE", basis: { in: bases } }, select: { id: true } });
    const locked = await repo.lockTenantRecording(
      tx,
      tenantId,
      active.map((a) => a.id),
    );
    const stopped: { rid: string; sessionId: string }[] = [];
    const actor = { kind: "user" as const, userId: auth.user.id, username: auth.user.email, ctx };
    for (const rec of locked)
      if (await svc.stopLocked(tx, rec, "policy_off", undefined, actor, now)) stopped.push({ rid: rec.id, sessionId: rec.sessionId });
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: RECORDING_SETTINGS_AUDIT,
      entity: "tenant_settings",
      entityId: tenantId,
      result: "success",
      oldValue: old,
      newValue: {
        ...next,
        ...(next.enabled && !old.enabled ? { consentAck: true } : {}),
        ...(unattendedOn ? { employeeNoticeAck: true, stepUp: true } : {}),
      },
    });
    return { old, changed: true, stopped };
  });
  for (const s of r.stopped) {
    svc.afterStop(s.rid, "policy_off");
    svc.room?.stopped(s.sessionId, "policy_off", svc.d.clock.now());
  }
  return r;
}

/** Prefix `/api/v1/settings/recording`: çerez + CSRF; `settings.view` / `settings.edit`. */
export async function recordingSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  app.get("/", { preHandler: requirePerm("settings.view") }, async (req): Promise<RecordingSettingsView> =>
    getRecordingSettings(app.rec.service, tenantScope(req).tenantId, authOf(req).user.id),
  );
  app.put("/", { preHandler: requirePerm("settings.edit") }, async (req): Promise<RecordingSettingsView> => {
    const { tenantId } = tenantScope(req);
    const input = parseInput(putRecordingSettingsInputSchema, req.body);
    const auth = authOf(req);
    const ctx = auditContext(req);
    const r = await putRecordingSettings(app.rec.service, ctx, auth, tenantId, input);
    const next = input.enabled && input.unattendedEnabled;
    if (r.changed && r.old.unattendedEnabled !== next)
      void sendSilentNotice(
        { db: app.db, mail: app.mail, metrics: app.metrics, log: app.log },
        {
          ctx,
          tenantId,
          actor: { userId: auth.user.id, email: auth.user.email },
          event: "recording_policy",
          entity: "tenant_settings",
          entityId: tenantId,
          content: recordingPolicyMail({ user: auth.user.fullName, old: r.old.unattendedEnabled, next, at: new Date() }),
        },
      );
    return getRecordingSettings(app.rec.service, tenantId, auth.user.id);
  });
}
