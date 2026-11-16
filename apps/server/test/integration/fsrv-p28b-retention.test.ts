// P28b K3 — saklama işi (03:30): süresi dolan saklanan dosya → EXPIRED + disk yok, mutabakat (a)(b)(c), anonimleştirmede
// satır + disk silinir; firma silmede `FILES_DIR/{tenant}` klasörü. Global adım → serial-retention projesi.
import { randomBytes } from "node:crypto";
import { readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Tam saklama turu dolu test DB'sinde (binlerce firma) uzun sürer. */
const RUN_TIMEOUT = 240_000;
import { FSRV_AUDIT } from "@remote/contracts/audit";
import { makeHeader } from "../../src/fsrv/box.ts";
import { fsrvExpire, reconcile, sweepOrphanRows } from "../../src/jobs/retention-fsrv.ts";
import { RetentionJob } from "../../src/jobs/retention.ts";
import { newId } from "../../src/lib/ids.ts";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginStepUp,
  makeApp,
  TEST_FILES_DIR,
  testDb,
  testFixtureDb,
} from "../helpers/app.ts";
import { makeDue, makeEligible } from "../helpers/tenant-purge.ts";

// Kalıcı silme testi (purgeMode "on") yalnız kendi firmasında koşar (retention-p16-purge kalıbı); diğer testlerde kapsam yok.
const scope = vi.hoisted(() => ({ tenantIds: null as Set<string> | null }));
vi.mock("../../src/requests/repo.ts", async (orig) => {
  const actual = await orig<typeof import("../../src/requests/repo.ts")>();
  return {
    ...actual,
    retentionTenants: async (...args: Parameters<typeof actual.retentionTenants>) => {
      const all = await actual.retentionTenants(...args);
      const only = scope.tenantIds;
      return only ? all.filter((t) => only.has(t.tenantId)) : all;
    },
  };
});

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(async () => app.close());

const DAY = 86_400_000;
const diskFiles = async (t: string) => (await readdir(join(TEST_FILES_DIR, t)).catch(() => [] as string[])).sort();

async function storedFile(o: {
  tenantId: string;
  sessionId: string;
  createdAt: Date;
  state: "CLEAN" | "UPLOADING";
  deliveredAt?: Date;
  expiresAt?: Date;
  onDisk?: boolean;
}): Promise<{ id: string; rel: string }> {
  const id = newId();
  const rel = app.fsrv.store.newRel(o.tenantId);
  if (o.onDisk !== false) {
    await app.fsrv.store.createPart(rel, makeHeader(1, 10, randomBytes(32)));
    if (o.state === "CLEAN") await app.fsrv.store.commit(rel);
  }
  await testDb().sessionStoredFile.create({
    data: {
      id,
      tenantId: o.tenantId,
      sessionId: o.sessionId,
      direction: "TO_TECH",
      purpose: "FILE",
      fileName: "a.txt",
      ext: "txt",
      sizeBytes: 10n,
      sha256: "a".repeat(64),
      storageRel: rel,
      keyVer: 1,
      state: o.state,
      createdAt: o.createdAt,
      ...(o.state === "CLEAN" ? { scannedAt: o.createdAt } : {}),
      ...(o.deliveredAt ? { deliveredAt: o.deliveredAt, expiresAt: o.expiresAt ?? null } : {}),
    },
  });
  return { id, rel };
}

describe("AC-360 saklama işi: süre dolumu, mutabakat, anonimleştirme — diskte dosya kalmaz", () => {
  it(
    "AC-360 süresi dolan teslim edilmiş dosya → EXPIRED + disk silinir + tenant başına file.expired{count, bytes}; süresi dolmayan kalır",
    async () => {
      const now = new Date();
      const t = await createTenant();
      const u = await createUser({ tenantId: t.id });
      const sid = (
        await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ENDED", createdAt: new Date(now.getTime() - 3 * DAY) })
      ).id;
      const old = await storedFile({
        tenantId: t.id,
        sessionId: sid,
        createdAt: new Date(now.getTime() - 3 * DAY),
        state: "CLEAN",
        deliveredAt: new Date(now.getTime() - 2 * DAY),
        expiresAt: new Date(now.getTime() - DAY),
      });
      const fresh = await storedFile({
        tenantId: t.id,
        sessionId: sid,
        createdAt: new Date(now.getTime() - 3 * DAY),
        state: "CLEAN",
        deliveredAt: new Date(now.getTime() - DAY),
        expiresAt: new Date(now.getTime() + DAY),
      });
      await app.retention.run(now);
      const r = await testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: old.id } });
      expect(r).toMatchObject({ state: "EXPIRED", storageRel: null });
      expect(await diskFiles(t.id)).toEqual([fresh.rel.split("/")[1]]);
      const a = await testDb().auditLog.findFirst({ where: { tenantId: t.id, action: FSRV_AUDIT.EXPIRED } });
      expect(a).toMatchObject({ entity: "retention", newValue: { count: 1, bytes: 10 } });
      // ikinci geçiş idempotent (adım doğrudan; tam tur dolu test DB'sinde uzun sürer)
      expect(await fsrvExpire(app.db, app.fsrv, t.id, now, { ip: "", userAgent: "test", requestId: "r" })).toBe(0);
      expect(await testDb().auditLog.count({ where: { tenantId: t.id, action: FSRV_AUDIT.EXPIRED } })).toBe(1);
    },
    RUN_TIMEOUT,
  );

  it("AC-360 mutabakat: (a) 24 sa'ten eski yetim dosya silinir, yenisi kalır; (b) dosyası olmayan CLEAN → EXPIRED; (c) odası kapanmış teslim edilmemiş CLEAN / yarım yükleme → disk sil + CANCELLED", async () => {
    const now = new Date();
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const sid = (
      await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ENDED", createdAt: new Date(now.getTime() - DAY) })
    ).id;
    const created = new Date(now.getTime() - DAY);
    const missing = await storedFile({
      tenantId: t.id,
      sessionId: sid,
      createdAt: created,
      state: "CLEAN",
      deliveredAt: created,
      expiresAt: new Date(now.getTime() + DAY),
      onDisk: false,
    });
    const undelivered = await storedFile({ tenantId: t.id, sessionId: sid, createdAt: created, state: "CLEAN" });
    const half = await storedFile({ tenantId: t.id, sessionId: sid, createdAt: created, state: "UPLOADING" });
    // yetim dosyalar (satırsız)
    const oldOrphan = app.fsrv.store.newRel(t.id);
    const newOrphan = app.fsrv.store.newRel(t.id);
    for (const rel of [oldOrphan, newOrphan]) {
      await app.fsrv.store.createPart(rel, makeHeader(1, 10, randomBytes(32)));
      await app.fsrv.store.commit(rel);
    }
    const past = new Date(now.getTime() - 2 * DAY);
    await utimes(app.fsrv.store.abs(oldOrphan), past, past);

    // global adım (retention.run içinde); sayılar diğer dosyaların satırlarını da içerebilir
    const rc = await reconcile(app.db, app.fsrv, now);
    expect(rc.orphanFiles).toBeGreaterThanOrEqual(1);
    expect(rc.missing).toBeGreaterThanOrEqual(1);
    expect(rc.stale).toBeGreaterThanOrEqual(2);
    expect(await testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: missing.id } })).toMatchObject({ state: "EXPIRED" });
    expect(await testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: undelivered.id } })).toMatchObject({
      state: "CANCELLED",
      storageRel: null,
    });
    expect(await testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: half.id } })).toMatchObject({
      state: "CANCELLED",
      storageRel: null,
    });
    expect(await diskFiles(t.id)).toEqual([newOrphan.split("/")[1]]);
  });

  it(
    "AC-360 anonimleştirme: oturumun saklanan dosya satırları aynı TX'te silinir, disk dosyası TX'ten önce silinir",
    async () => {
      const now = new Date();
      const t = await createTenant();
      const u = await createUser({ tenantId: t.id });
      const created = new Date(now.getTime() - 400 * DAY);
      const sid = (await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ENDED", createdAt: created })).id;
      const f = await storedFile({
        tenantId: t.id,
        sessionId: sid,
        createdAt: created,
        state: "CLEAN",
        deliveredAt: new Date(now.getTime() - 3_600_000),
        expiresAt: new Date(now.getTime() + DAY),
      });
      await app.retention.run(now);
      expect(await testDb().sessionStoredFile.count({ where: { id: f.id } })).toBe(0);
      expect(await diskFiles(t.id)).toEqual([]);
      expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: sid } })).anonymizedAt).not.toBeNull();
    },
    RUN_TIMEOUT,
  );

  it("AC-360 kalıcı silme (purgeAnonymized): 30 g'den eski anonim oturumda kalan saklanan dosya → satır 0 + FILES_DIR/{tenant} boş", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const sid = (await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "EXPIRED" })).id;
    const f = await storedFile({ tenantId: t.id, sessionId: sid, createdAt: new Date(), state: "CLEAN" });
    expect(await diskFiles(t.id)).toEqual([f.rel.split("/")[1]]);
    // anonimleştirmeden 31 g önce geçmiş (savunma yolu: satır anonimleştirmede silinmemiş kenar durum); migrator, tetikleyiciden muaf
    await testFixtureDb().$executeRaw`UPDATE support_sessions SET created_at = created_at - INTERVAL 40 DAY,
        expires_at = expires_at - INTERVAL 40 DAY, ended_at = ended_at - INTERVAL 40 DAY,
        anonymized_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY
      WHERE id = ${sid}`;
    scope.tenantIds = new Set([t.id]);
    try {
      await new RetentionJob(app.requests, { purgeMode: "on", fsrv: app.fsrv }).run(new Date());
    } finally {
      scope.tenantIds = null;
    }
    expect(await testDb().supportSession.count({ where: { id: sid } })).toBe(0);
    expect(await testDb().sessionStoredFile.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await diskFiles(t.id)).toEqual([]);
  });

  it("AC-360 firma silme: SESSION_FILES adımı FILES_DIR/{tenant} klasörünü siler; session_stored_files satırı 0", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const sid = (await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ENDED" })).id;
    const now = new Date();
    await storedFile({
      tenantId: t.id,
      sessionId: sid,
      createdAt: now,
      state: "CLEAN",
      deliveredAt: now,
      expiresAt: new Date(now.getTime() + DAY),
    });
    expect(await diskFiles(t.id)).toHaveLength(1);
    const superAdmin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const sa = await loginStepUp(app, superAdmin);
    await makeEligible(app, sa, t.id);
    const url = `/api/v1/admin/tenants/${t.id}/purge`;
    const pv = await app.inject({ method: "POST", url, headers: sa.headers, payload: { dryRun: true } });
    expect(pv.statusCode, pv.body).toBe(200);
    const sc = await app.inject({
      method: "POST",
      url,
      headers: sa.headers,
      payload: { dryRun: false, previewId: pv.json<{ previewId: string }>().previewId, confirmName: t.name },
    });
    expect(sc.statusCode, sc.body).toBe(202);
    const jobId = sc.json<{ jobId: string }>().jobId;
    await makeDue(jobId);
    expect(await app.tenantPurge.runJob(jobId)).toBe("done");
    expect(await testDb().sessionStoredFile.count({ where: { tenantId: t.id } })).toBe(0);
    expect(await readdir(join(TEST_FILES_DIR, t.id)).catch((e: NodeJS.ErrnoException) => e.code)).toBe("ENOENT");
  });

  it("D-P28b-K1-4 yetim satır süpürmesi id imleciyle sayfalı: ilk sayfa bellekteki aktarımla dolu olsa da sonraki yetim CANCELLED", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    const sid = (await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" })).id;
    await testDb().tenant.update({ where: { id: t.id }, data: { storageQuotaGb: 1 } });
    const ratio = app.fsrv.store.freeRatioOverride;
    app.fsrv.store.freeRatioOverride = 1; // geliştirici diski dolu olabilir (disk kuralı ayrı testte)
    // sayfa boyu 1: önce bellekte etkin aktarım (küçük id), sonra yetim satır (büyük id)
    const liveT = await app.fsrv.service.begin({
      sessionId: sid,
      tenantId: t.id,
      direction: "TO_TECH",
      purpose: "FILE",
      xid: newId().slice(0, 16),
      name: "a.bin",
      size: 10,
      sha256: "0".repeat(64),
      retentionDays: 1,
      sender: { username: "customer", ctx: { ip: "", userAgent: "test", requestId: "r" } },
    });
    app.fsrv.store.freeRatioOverride = ratio;
    if ("reject" in liveT) throw new Error(liveT.reject);
    await new Promise((r) => setTimeout(r, 2)); // ULID zaman bileşeni: yetimin id'si büyük olsun
    const orphan = await storedFile({ tenantId: t.id, sessionId: sid, createdAt: new Date(), state: "UPLOADING" });
    expect(liveT.fid < orphan.id).toBe(true);
    await sweepOrphanRows(app.db, app.fsrv, new Date(), 1);
    expect(await testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject({
      state: "CANCELLED",
      storageRel: null,
    });
    expect((await testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: liveT.fid } })).state).toBe("UPLOADING");
    const liveRel = (await testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: liveT.fid } })).storageRel ?? "";
    expect(await diskFiles(t.id)).toEqual([`${liveRel.split("/")[1]}.part`]); // yetimin .part'ı silindi, etkin aktarımınki kaldı
    const tr = app.fsrv.service.transfers.get(liveT.fid);
    if (tr) await app.fsrv.service.abortUpload(tr, "test");
  });
});
