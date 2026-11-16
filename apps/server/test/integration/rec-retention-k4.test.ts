// P28e K4 — kayıt saklama adımları (mimari-p28e r2 §3.4, §5.5, §11.4; AC-386, S-P28e-10, K-P28e-12): 03:30 `recExpire`,
// mutabakat (a) kayıt parçası canlıdır (kritik ek), (b) dosyası olmayan parça → sayaç düşer / DELETED{MISSING}, anonimleştirme ve
// kalıcı silme kayıtları siler, check-retire `key_ver` sayar. Gerçek MySQL (app kullanıcısı → grant ihlali yakalanır).
import { randomBytes } from "node:crypto";
import { readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECORDING_AUDIT } from "@remote/contracts/audit";
import { countAllByVersion } from "../../src/cli/crypto.ts";
import { makeHeader } from "../../src/fsrv/box.ts";
import { reconcile, removeSessionFiles } from "../../src/jobs/retention-fsrv.ts";
import { recExpire, recReconcileMissing } from "../../src/jobs/retention-rec.ts";
import { anonymizeSessionBatch, purgeSessionsBatch } from "../../src/jobs/retention-repo.ts";
import { newId } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createTenant, createUser, makeApp, TEST_FILES_DIR, testDb, testFixtureDb } from "../helpers/app.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(async () => app.close());

const DAY = 86_400_000;
const CTX = { ip: "", userAgent: "test", requestId: "r" };
const diskFiles = async (t: string) => (await readdir(join(TEST_FILES_DIR, t)).catch(() => [] as string[])).sort();
const base = (rel: string) => rel.split("/")[1] ?? "";

async function session(status: "ENDED" | "ACTIVE" | "EXPIRED" = "ENDED", createdAt = new Date()) {
  const t = await createTenant();
  const u = await createUser({ tenantId: t.id });
  const sid = (await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status, createdAt })).id;
  return { tenantId: t.id, sid };
}

async function recording(o: {
  tenantId: string;
  sessionId: string;
  state?: "ACTIVE" | "STOPPED";
  expiresAt?: Date;
  parts?: number;
  onDisk?: boolean[];
  keyVer?: number;
}) {
  const id = newId();
  const now = new Date();
  const n = o.parts ?? 2;
  // CHECK: expires_at ∈ [started_at + 1 g, + 90 g] → başlangıç süre dolumuna göre geriye alınır.
  const expiresAt = o.expiresAt ?? new Date(now.getTime() + DAY);
  const startedAt = new Date(Math.min(now.getTime() - 60_000, expiresAt.getTime() - 2 * DAY));
  const stopped = (o.state ?? "STOPPED") === "STOPPED";
  await testDb().sessionRecording.create({
    data: {
      id,
      tenantId: o.tenantId,
      sessionId: o.sessionId,
      basis: "CONSENT",
      state: o.state ?? "STOPPED",
      ...(stopped ? { stopReason: "SESSION_END", stoppedAt: now } : {}),
      startedAt,
      expiresAt,
      durationMs: n * 5000,
      sizeBytes: BigInt(n * 100),
      partCount: n,
    },
  });
  const rels: string[] = [];
  for (let p = 0; p < n; p++) {
    const rel = app.fsrv.store.newRel(o.tenantId);
    if (o.onDisk?.[p] !== false) {
      await app.fsrv.store.createPart(rel, makeHeader(1, 100, randomBytes(32)));
      await app.fsrv.store.commit(rel);
    }
    await testDb().sessionRecordingPart.create({
      data: {
        id: newId(),
        recordingId: id,
        tenantId: o.tenantId,
        seriesNo: 0,
        partNo: p,
        offsetMs: p * 5000,
        durationMs: 5000,
        sizeBytes: 100,
        storageRel: rel,
        keyVer: o.keyVer ?? 1,
      },
    });
    rels.push(rel);
  }
  return { id, rels };
}

describe("AC-386 kayıt saklama işi (K4)", () => {
  it("AC-386 recExpire: süresi dolan STOPPED → disk + parça satırları silinir, DELETED{EXPIRED} sayaç 0, tenant başına recording.expired{count, bytes}; süresi dolmayan ve ACTIVE kalır", async () => {
    const now = new Date();
    const a = await session();
    const due = await recording({ tenantId: a.tenantId, sessionId: a.sid, expiresAt: new Date(now.getTime() - 1000) });
    const b2 = await createSupportSessionRow({
      tenantId: a.tenantId,
      technicianId: (await createUser({ tenantId: a.tenantId })).id,
      status: "ENDED",
    });
    const fresh = await recording({ tenantId: a.tenantId, sessionId: b2.id });
    const c3 = await createSupportSessionRow({
      tenantId: a.tenantId,
      technicianId: (await createUser({ tenantId: a.tenantId })).id,
      status: "ACTIVE",
    });
    const active = await recording({ tenantId: a.tenantId, sessionId: c3.id, state: "ACTIVE", expiresAt: new Date(now.getTime() - 1000) });

    expect(await recExpire(app.db, app.fsrv.store, a.tenantId, now, CTX)).toBe(1);
    expect(await testDb().sessionRecording.findUniqueOrThrow({ where: { id: due.id } })).toMatchObject({
      state: "DELETED",
      deleteReason: "EXPIRED",
      sizeBytes: 0n,
      partCount: 0,
    });
    expect(await testDb().sessionRecordingPart.count({ where: { recordingId: due.id } })).toBe(0);
    expect(await diskFiles(a.tenantId)).toEqual([...fresh.rels, ...active.rels].map(base).sort());
    const audit = await testDb().auditLog.findMany({ where: { tenantId: a.tenantId, action: RECORDING_AUDIT.EXPIRED } });
    expect(audit.map((x) => [x.entity, x.newValue])).toEqual([["retention", { count: 1, bytes: 200 }]]);
    // idempotent
    expect(await recExpire(app.db, app.fsrv.store, a.tenantId, now, CTX)).toBe(0);
  });

  it("AC-386 mutabakat (a) kritik ek: 24 sa'ten eski KAYIT PARÇASI dosyası canlıdır (silinmez); satırsız eski yetim silinir", async () => {
    const now = new Date();
    const a = await session();
    const rec = await recording({ tenantId: a.tenantId, sessionId: a.sid, parts: 1 });
    const orphan = app.fsrv.store.newRel(a.tenantId);
    await app.fsrv.store.createPart(orphan, makeHeader(1, 10, randomBytes(32)));
    await app.fsrv.store.commit(orphan);
    const past = new Date(now.getTime() - 3 * DAY);
    for (const rel of [...rec.rels, orphan]) await utimes(app.fsrv.store.abs(rel), past, past);
    await reconcile(app.db, app.fsrv, now);
    expect(await diskFiles(a.tenantId)).toEqual(rec.rels.map(base));
    expect(await testDb().sessionRecordingPart.count({ where: { recordingId: rec.id } })).toBe(1);
  });

  it("S-P28e-10 mutabakat (b): dosyası olmayan parça satırı silinir + sayaçlar düşer; hiç kalmazsa DELETED{MISSING}; audit recording.delete{missing}; ACTIVE dokunulmaz", async () => {
    const now = new Date();
    const a = await session();
    const partial = await recording({ tenantId: a.tenantId, sessionId: a.sid, parts: 3, onDisk: [true, false, true] });
    const s2 = await createSupportSessionRow({
      tenantId: a.tenantId,
      technicianId: (await createUser({ tenantId: a.tenantId })).id,
      status: "ENDED",
    });
    const gone = await recording({ tenantId: a.tenantId, sessionId: s2.id, parts: 2, onDisk: [false, false] });
    const s3 = await createSupportSessionRow({
      tenantId: a.tenantId,
      technicianId: (await createUser({ tenantId: a.tenantId })).id,
      status: "ACTIVE",
    });
    const act = await recording({ tenantId: a.tenantId, sessionId: s3.id, state: "ACTIVE", parts: 1, onDisk: [false] });

    expect(await recReconcileMissing(app.db, app.fsrv.store, now, CTX)).toBeGreaterThanOrEqual(2);
    expect(await testDb().sessionRecording.findUniqueOrThrow({ where: { id: partial.id } })).toMatchObject({
      state: "STOPPED",
      partCount: 2,
      sizeBytes: 200n,
      durationMs: 10_000,
    });
    expect(await testDb().sessionRecording.findUniqueOrThrow({ where: { id: gone.id } })).toMatchObject({
      state: "DELETED",
      deleteReason: "MISSING",
      sizeBytes: 0n,
      partCount: 0,
    });
    expect(await testDb().sessionRecording.findUniqueOrThrow({ where: { id: act.id } })).toMatchObject({ state: "ACTIVE", partCount: 1 });
    const audits = await testDb().auditLog.findMany({
      where: { tenantId: a.tenantId, action: RECORDING_AUDIT.DELETE },
      orderBy: { id: "asc" },
    });
    expect(audits.map((x) => [x.username, x.entityId, x.newValue])).toEqual(
      expect.arrayContaining([
        [
          "system",
          a.sid,
          expect.objectContaining({ recordingId: partial.id, deleteReason: "missing", missingParts: 1, remainingParts: 2 }),
        ],
        ["system", s2.id, expect.objectContaining({ recordingId: gone.id, deleteReason: "missing", missingParts: 2, remainingParts: 0 })],
      ]),
    );
    expect(audits).toHaveLength(2);
  });

  it("AC-386 anonimleştirme: kayıt parçaları + kayıt satırı silinir (satır kalmaz), disk dosyaları TX'ten önce silinir", async () => {
    const now = new Date();
    const a = await session("ENDED", new Date(now.getTime() - 400 * DAY));
    const rec = await recording({ tenantId: a.tenantId, sessionId: a.sid });
    const r = await anonymizeSessionBatch(app.db, a.tenantId, new Date(now.getTime() - 365 * DAY), 1000, (ids) =>
      removeSessionFiles(app.db, app.fsrv.store, a.tenantId, ids),
    );
    expect(r.recordings).toBe(1);
    expect(await testDb().sessionRecording.count({ where: { id: rec.id } })).toBe(0);
    expect(await testDb().sessionRecordingPart.count({ where: { recordingId: rec.id } })).toBe(0);
    expect(await diskFiles(a.tenantId)).toEqual([]);
  });

  it("AC-386 kalıcı silme sırası: anonim oturumda kalan kayıt (savunma) parçalar → kayıt → oturum silinir", async () => {
    const a = await session("EXPIRED");
    const rec = await recording({ tenantId: a.tenantId, sessionId: a.sid });
    await testFixtureDb().$executeRaw`UPDATE support_sessions SET created_at = created_at - INTERVAL 40 DAY,
        expires_at = expires_at - INTERVAL 40 DAY, ended_at = ended_at - INTERVAL 40 DAY,
        anonymized_at = UTC_TIMESTAMP(3) - INTERVAL 31 DAY
      WHERE id = ${a.sid}`;
    const r = await purgeSessionsBatch(app.db, a.tenantId, 500, (ids) => removeSessionFiles(app.db, app.fsrv.store, a.tenantId, ids));
    expect(r.sessions).toBe(1);
    expect(await testDb().sessionRecording.count({ where: { id: rec.id } })).toBe(0);
    expect(await testDb().supportSession.count({ where: { id: a.sid } })).toBe(0);
    expect(await diskFiles(a.tenantId)).toEqual([]);
  });

  it("K-P28e-12 crypto:check-retire session_recording_parts key_ver'i sayar", async () => {
    const a = await session();
    await recording({ tenantId: a.tenantId, sessionId: a.sid, parts: 1, keyVer: 7 });
    const c = await countAllByVersion(testDb(), 7);
    expect(c["session_recording_parts.key_ver"]).toBeGreaterThanOrEqual(1);
    // v7 satırı kalırsa tam koşuda p18 `crypto:check-retire 7` (S-P18-T2) dosya sırasına bağlı kırmızı olur.
    await testDb().sessionRecordingPart.deleteMany({ where: { tenantId: a.tenantId, keyVer: 7 } });
  });
});
