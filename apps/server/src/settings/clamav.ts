// P28b ClamAV sistem ayarı (Super Admin; mimari-p28b §4, §7.2–7.3; AC-353, AC-361). Tablo `system_settings` anahtar `clamav`:
// value_json `{host, port, lastTest}` (gizli yok; DB CHECK `system_settings_clamav_chk`). Etkin hedef: panel kaydı > env
// (`CLAMAV_HOST`/`CLAMAV_PORT`). Hedef kuralı (O-P28b-1): çözülen TÜM adresler `CLAMAV_ALLOWED_CIDR` içinde — aksi 400
// `HOST_NOT_ALLOWED`. `lastTest` yalnız kayıtlı (etkin) hedefle yapılan testte yazılır; env kaynağında aynı host/port ile panel
// satırı oluşturulur (lastTest'in tek yeri — implementation.md "P28b K3" sapması). Yazım + audit tek TX.
import {
  CLAMAV_DEFAULT_PORT,
  CLAMAV_HOST_NOT_ALLOWED_MESSAGE,
  CLAMAV_TEST_MESSAGES,
  CLAMAV_TEST_PER_MIN,
  type ClamavLastTest,
  type ClamavSettingsData,
  type ClamavSettingsView,
  type ClamavTestInput,
  type ClamavTestReason,
  type ClamavTestResponse,
} from "@remote/contracts/api/clamav";
import { FSRV_AUDIT } from "@remote/contracts/audit";
import type { Prisma } from "../generated/prisma/client.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { ClamdClient, ClamdTarget } from "../fsrv/clamd.ts";
import type { Scanner, SelfTestResult } from "../fsrv/scan.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { who } from "./system.ts";

const KEY = "clamav";

export interface ClamavDeps {
  db: Db;
  client: ClamdClient;
  scanner: Scanner;
  envHost: string | undefined;
  envPort: number;
  log: { info(o: object, m: string): void; warn(o: object, m: string): void };
}

interface ClamavRecord {
  host: string;
  port: number;
  lastTest: ClamavLastTest | null;
}

function asRecord(v: unknown): ClamavRecord | null {
  const o = v as Partial<ClamavRecord> | null;
  if (!o || typeof o.host !== "string" || typeof o.port !== "number") return null;
  return { host: o.host, port: o.port, lastTest: (o.lastTest as ClamavLastTest | null | undefined) ?? null };
}

async function readRecord(db: Pick<Db, "systemSetting">): Promise<ClamavRecord | null> {
  const row = await db.systemSetting.findUnique({ where: { key: KEY }, select: { valueJson: true } });
  return row ? asRecord(row.valueJson) : null;
}

/** Etkin hedef: panel > env; hiçbiri yoksa null (fail-closed → tarama `SCAN_FAILED/UNAVAILABLE`). */
export async function effectiveClamav(d: Pick<ClamavDeps, "db" | "envHost" | "envPort">): Promise<ClamdTarget | null> {
  const rec = await readRecord(d.db);
  if (rec) return { host: rec.host, port: rec.port };
  return d.envHost ? { host: d.envHost.toLowerCase(), port: d.envPort } : null;
}

/** AC-354 kapısı: son elle test başarılı mı (`lastTest.ok === true`). */
export async function avReady(db: Pick<Db, "systemSetting">): Promise<boolean> {
  return (await readRecord(db))?.lastTest?.ok === true;
}

export async function getClamavSettings(d: ClamavDeps): Promise<ClamavSettingsView> {
  const rec = await readRecord(d.db);
  const host = rec?.host ?? (d.envHost ? d.envHost.toLowerCase() : null);
  return {
    host,
    port: rec?.port ?? (d.envHost ? d.envPort : CLAMAV_DEFAULT_PORT),
    source: rec ? "panel" : "env",
    lastTest: rec?.lastTest ?? null,
    signatureAgeDays: d.scanner.signatureAgeDays(),
    stale: d.scanner.stale,
  };
}

async function assertAllowed(d: ClamavDeps, host: string): Promise<void> {
  if (!(await d.client.allowed(host))) throw new AppError("HOST_NOT_ALLOWED", { fields: { host: CLAMAV_HOST_NOT_ALLOWED_MESSAGE } });
}

const toJson = (r: ClamavRecord): Prisma.InputJsonObject => ({
  host: r.host,
  port: r.port,
  lastTest: r.lastTest as Prisma.InputJsonValue | null,
});

/** PUT: hedef kuralı → upsert (host/port değişince `lastTest = null`) + audit eski→yeni `{host, port}`. */
export async function saveClamavSettings(
  d: ClamavDeps,
  ctx: AuditContext,
  auth: AuthContext,
  input: ClamavSettingsData,
): Promise<ClamavSettingsView> {
  await assertAllowed(d, input.host);
  await d.db.$transaction(async (tx) => {
    const old = await readRecord(tx);
    const same = old !== null && old.host === input.host && old.port === input.port;
    const rec: ClamavRecord = { host: input.host, port: input.port, lastTest: same ? old.lastTest : null };
    await tx.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, valueJson: toJson(rec), updatedBy: auth.user.id },
      update: { valueJson: toJson(rec), updatedBy: auth.user.id },
    });
    await writeAudit(tx, ctx, {
      ...who(auth),
      action: FSRV_AUDIT.CLAMAV_UPDATED,
      entity: "system_settings",
      entityId: KEY,
      ...(old ? { oldValue: { host: old.host, port: old.port } } : {}),
      newValue: { host: rec.host, port: rec.port },
      result: "success",
    });
  });
  return getClamavSettings(d);
}

/** `lastTest`'i etkin hedefin satırına yazar (env kaynağında aynı host/port ile panel satırı açılır). */
async function writeLastTest(
  d: Pick<ClamavDeps, "db" | "envHost" | "envPort">,
  target: ClamdTarget,
  lastTest: ClamavLastTest,
  by: string | null,
): Promise<void> {
  const rec: ClamavRecord = { host: target.host, port: target.port, lastTest };
  await d.db.systemSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, valueJson: toJson(rec), updatedBy: by },
    update: { valueJson: toJson(rec) },
  });
}

/** Öz-sınama yanlış yapılandırmaya geçişi (§7.3): `lastTest = {ok:false, message}` → AC-354 anahtarı yeni açılamaz. */
export async function markMisconfigured(d: Pick<ClamavDeps, "db" | "envHost" | "envPort">, now: Date): Promise<void> {
  const target = await effectiveClamav(d);
  if (!target) return;
  await writeLastTest(d, target, { ok: false, at: now.toISOString(), message: CLAMAV_TEST_MESSAGES.encrypted_off }, null);
}

function reasonOf(r: SelfTestResult): ClamavTestReason | "ok" {
  if (r.judgement === "unreachable") return "unreachable";
  if (r.judgement === "ok") return "ok";
  if (!r.eicarDetected) return "no_eicar";
  return r.encryptedDetected ? "error" : "encrypted_off";
}

/** POST test: 6/dk/kullanıcı; verilen host aynı CIDR kuralından geçer; `lastTest` yalnız etkin hedefle yazılır. */
export async function testClamav(
  d: ClamavDeps,
  ctx: AuditContext,
  auth: AuthContext,
  input: ClamavTestInput,
  limit: FixedWindowCounter,
  now: () => Date,
): Promise<ClamavTestResponse> {
  const wait = limit.blockedFor(auth.user.id);
  if (wait > 0 || limit.hit(auth.user.id)) throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
  const saved = await effectiveClamav(d);
  const host = input.host ?? saved?.host;
  const port = input.port ?? (input.host === undefined ? saved?.port : undefined) ?? CLAMAV_DEFAULT_PORT;
  let out: ClamavTestResponse;
  if (!host) {
    out = {
      ok: false,
      eicarDetected: false,
      encryptedDetected: false,
      version: null,
      dbDate: null,
      signatureAgeDays: null,
      stale: false,
      message: CLAMAV_TEST_MESSAGES.unconfigured,
    };
  } else {
    await assertAllowed(d, host);
    const target = { host, port };
    const r = await d.scanner.selfTest(target);
    const reason = reasonOf(r);
    const ageDays = r.dbDate ? Math.max(0, Math.floor((now().getTime() - r.dbDate.getTime()) / 86_400_000)) : null;
    out = {
      ok: reason === "ok",
      eicarDetected: r.eicarDetected,
      encryptedDetected: r.encryptedDetected,
      version: r.version,
      dbDate: r.dbDate?.toISOString() ?? null,
      signatureAgeDays: ageDays,
      stale: ageDays !== null && ageDays > 3,
      ...(reason === "ok" ? {} : { message: CLAMAV_TEST_MESSAGES[reason] }),
    };
    if (saved && saved.host === host && saved.port === port) {
      await writeLastTest(
        d,
        target,
        {
          ok: out.ok,
          at: now().toISOString(),
          version: r.version?.slice(0, 200) ?? null,
          dbDate: out.dbDate,
          ...(out.message ? { message: out.message } : {}),
        },
        auth.user.id,
      );
      if (out.ok) d.scanner.misconfigured = false;
    }
  }
  await writeAudit(d.db, ctx, {
    ...who(auth),
    action: FSRV_AUDIT.CLAMAV_TEST,
    entity: "system_settings",
    entityId: KEY,
    newValue: {
      ok: out.ok,
      eicarDetected: out.eicarDetected,
      encryptedDetected: out.encryptedDetected,
      signatureAgeDays: out.signatureAgeDays,
    },
    result: out.ok ? "success" : "fail",
  });
  return out;
}

export const CLAMAV_TEST_LIMIT = CLAMAV_TEST_PER_MIN + 1; // FixedWindowCounter: n. vuruş kilitler → 6 izinli, 7. → 429
