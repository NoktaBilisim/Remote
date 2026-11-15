// P16 G5 — haftalık yetim dosya taraması (AC-243; ADR-0030 m.7, mimari-e11 §7.6, S16-9). Her test kendi geçici yükleme
// köküyle (`mkdtemp`); referans kümesi gerçek DB'den (`UPLOAD_REFERENCE_SOURCES`) ya da devre kesici senaryolarında test
// kaynağından. Zaman: iş `run(now)` mantıksal saatle; ilk görülme anı durum dosyasında.
import { mkdir, mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { UPLOADS_AUDIT } from "@remote/contracts/audit";
import { nextOrphanScanAt, OrphanScanJob } from "../../src/jobs/orphan-scan.ts";
import { newId } from "../../src/lib/ids.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { UPLOAD_REFERENCE_SOURCES, type UploadReferenceSource } from "../../src/uploads/references.ts";
import { UploadStore } from "../../src/uploads/store.ts";
import { createTenant, createUser, testDb, testFixtureDb } from "../helpers/app.ts";

const DAY = 86_400_000;
const roots: string[] = [];
afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
  await testFixtureDb().$disconnect();
});

async function setup(sources?: readonly UploadReferenceSource[]) {
  const root = await mkdtemp(join(tmpdir(), "rs-orphan-p16-"));
  roots.push(root);
  const store = new UploadStore(root);
  const metrics = createMetrics();
  const job = new OrphanScanJob({ db: testDb(), store, metrics, log: pino({ level: "silent" }), ...(sources ? { sources } : {}) });
  return { root, store, metrics, job };
}

let nameSeq = 0;
const fileName = (): string => `${newId().toLowerCase()}${String(++nameSeq).padStart(4, "0")}.png`;

/** Kök altına `öndek/ad` dosyası yazar, göreli yolu döner. */
async function put(root: string, prefix: string, name = fileName()): Promise<string> {
  await mkdir(join(root, prefix), { recursive: true });
  await writeFile(join(root, prefix, name), "x");
  return `${prefix}/${name}`;
}
const onDisk = async (root: string, rel: string) => (await stat(join(root, rel)).catch(() => null)) !== null;
const fixedSource = (paths: string[]): UploadReferenceSource[] => [{ table: "test", column: "path", read: async () => paths }];
const lastScanAudit = async () =>
  (
    await testDb().auditLog.findMany({
      where: { action: UPLOADS_AUDIT.ORPHAN_SCAN },
      orderBy: { id: "desc" },
      take: 1,
      select: { newValue: true, result: true, tenantId: true, username: true, entity: true },
    })
  )[0];

describe("P16 yetim dosya taraması (AC-243)", () => {
  it("AC-243: 0/6/8 gün — karşılıksız dosya 7 gün sonra silinir; arada bağlanan dosya silinmez; sayılar metrikte ve audit'te", async () => {
    const { root, metrics, job } = await setup();
    const t = await createTenant();
    const logo = await put(root, t.id);
    await testDb().tenant.update({ where: { id: t.id }, data: { logoPath: logo } });
    const users = [];
    for (let i = 0; i < 9; i++) {
      const u = await createUser({ tenantId: t.id, role: "USER" });
      const p = await put(root, t.id);
      await testDb().user.update({ where: { id: u.id }, data: { avatarPath: p } });
      users.push(u);
    }
    const orphan = await put(root, t.id);
    const laterBound = await put(root, t.id);
    const t0 = Date.now();

    const r0 = await job.run(new Date(t0));
    expect(r0).toMatchObject({ outcome: "ok", total: 12, found: 2, deleted: 0, pending: 2 });
    expect(await lastScanAudit()).toMatchObject({
      result: "success",
      tenantId: null,
      username: "system",
      entity: "uploads",
      newValue: { total: 12, found: 2, deleted: 0, tmpDeleted: 0, pending: 2 },
    });

    // 3. gün: dosya bir kullanıcıya bağlanır (ör. yükleme TX'i tarama sırasında commit oldu).
    await testDb().user.update({ where: { id: users[0]?.id ?? "" }, data: { avatarPath: laterBound } });
    const r6 = await job.run(new Date(t0 + 6 * DAY));
    expect(r6).toMatchObject({ outcome: "ok", found: 2, deleted: 0, pending: 2 }); // eski avatar artık karşılıksız (yeni ilk görülme)
    expect(await onDisk(root, orphan)).toBe(true);

    const r8 = await job.run(new Date(t0 + 8 * DAY));
    expect(r8).toMatchObject({ outcome: "ok", deleted: 1, pending: 1 });
    expect(await onDisk(root, orphan)).toBe(false);
    expect(await onDisk(root, laterBound)).toBe(true);
    expect(await onDisk(root, logo)).toBe(true);
    expect((await lastScanAudit())?.newValue).toMatchObject({ deleted: 1 });
    const m = metrics.render();
    expect(m).toMatch(/rs_orphan_files_total\{action="found"\} 6\n/);
    expect(m).toMatch(/rs_orphan_files_total\{action="deleted"\} 1\n/);
    expect(m).toContain(`rs_orphan_scan_last_success_timestamp_seconds ${Math.floor((t0 + 8 * DAY) / 1000)}`);
    // Son başarı durum dosyasında: yeniden başlatmada gösterge 0'a düşmez.
    const restarted = new OrphanScanJob({
      db: testDb(),
      store: new UploadStore(root),
      metrics: createMetrics(),
      log: pino({ level: "silent" }),
    });
    await restarted.init();
    expect(restarted.lastSuccessSeconds).toBe(Math.floor((t0 + 8 * DAY) / 1000));
  });

  it("AC-243: 24 saatten eski `.tmp` artığı silinir, yenisi kalır; sembolik bağlantı izlenmez ve silinmez", async () => {
    const { root, job } = await setup(fixedSource([]));
    const prefix = newId();
    await mkdir(join(root, prefix), { recursive: true });
    const oldTmp = `${fileName()}.0123456789ab.tmp`;
    const newTmp = `${fileName()}.ba9876543210.tmp`;
    await writeFile(join(root, prefix, oldTmp), "x");
    await writeFile(join(root, prefix, newTmp), "x");
    const now = Date.now();
    await utimes(join(root, prefix, oldTmp), new Date(now - 25 * 3_600_000), new Date(now - 25 * 3_600_000));
    await utimes(join(root, prefix, newTmp), new Date(now - 3_600_000), new Date(now - 3_600_000));
    // Kök dışını gösteren bağlantılar: öndek klasörü ve dosya olarak.
    const outside = await mkdtemp(join(tmpdir(), "rs-orphan-outside-"));
    roots.push(outside);
    const victim = `${fileName()}`;
    await writeFile(join(outside, victim), "keep");
    await symlink(outside, join(root, newId()));
    await symlink(join(outside, victim), join(root, prefix, fileName()));

    const r = await job.run(new Date(now));
    expect(r).toMatchObject({ outcome: "ok", total: 0, found: 0, tmpDeleted: 1 });
    expect(await readdir(join(root, prefix))).toContain(newTmp);
    expect(await readdir(join(root, prefix))).not.toContain(oldTmp);
    expect(await onDisk(outside, victim)).toBe(true);
  });

  it("AC-243 / S16-9: devre kesici — referans kümesi boşken diskte dosya varsa hiçbir şey silinmez; fail audit", async () => {
    const { root, store, metrics, job } = await setup(fixedSource([]));
    const prefix = newId();
    const files = [await put(root, prefix), await put(root, prefix), await put(root, prefix)];
    const oldTmp = `${prefix}/${fileName()}.0123456789ab.tmp`;
    await writeFile(join(root, oldTmp), "x");
    await utimes(join(root, oldTmp), new Date(0), new Date(0));
    const longAgo = new Date(Date.now() - 30 * DAY).toISOString();
    await store.writeOrphans({ v: 1, lastSuccessAt: null, files: Object.fromEntries(files.map((f) => [f, longAgo])) });

    const r = await job.run(new Date());
    expect(r).toMatchObject({ outcome: "circuit_open", total: 3, found: 3, deleted: 0, tmpDeleted: 0 });
    for (const f of files) expect(await onDisk(root, f)).toBe(true);
    expect(await onDisk(root, oldTmp)).toBe(true);
    expect((await store.readOrphans()).files).toEqual(Object.fromEntries(files.map((f) => [f, longAgo]))); // durum değişmedi
    expect(await lastScanAudit()).toMatchObject({
      result: "fail",
      newValue: { reason: "circuit_open", total: 3, found: 3, references: 0 },
    });
    expect(metrics.render()).toMatch(/rs_orphan_files_total\{action="circuit_open"\} 1\n/);
    expect(job.lastSuccessSeconds).toBe(0);
  });

  it("AC-243 / S16-9: devre kesici — %21 karşılıksız → silme yok; %20 → eşik aşılmaz, 7 günü dolan silinir", async () => {
    const prefix = newId();
    const root0 = await mkdtemp(join(tmpdir(), "rs-orphan-p16-"));
    roots.push(root0);
    const files: string[] = [];
    for (let i = 0; i < 100; i++) files.push(await put(root0, prefix));
    const longAgo = new Date(Date.now() - 30 * DAY).toISOString();
    const state = { v: 1 as const, lastSuccessAt: null, files: Object.fromEntries(files.map((f) => [f, longAgo])) };
    const scan = async (refs: string[]) => {
      const store = new UploadStore(root0);
      await store.writeOrphans(state);
      const job = new OrphanScanJob({
        db: testDb(),
        store,
        metrics: createMetrics(),
        log: pino({ level: "silent" }),
        sources: fixedSource(refs),
      });
      return job.run(new Date());
    };
    expect(await scan(files.slice(21))).toMatchObject({ outcome: "circuit_open", total: 100, found: 21, deleted: 0 });
    for (const f of files) expect(await onDisk(root0, f)).toBe(true);
    expect(await scan(files.slice(20))).toMatchObject({ outcome: "ok", total: 100, found: 20, deleted: 20 });
    for (const f of files.slice(0, 20)) expect(await onDisk(root0, f)).toBe(false);
    for (const f of files.slice(20)) expect(await onDisk(root0, f)).toBe(true);
  });

  it("AC-243 / S16-9 meta-test: şemadaki bütün `*_path` sütunları `UPLOAD_REFERENCE_SOURCES` listesinde", async () => {
    const cols = await testFixtureDb().$queryRaw<{ t: string; c: string }[]>`SELECT TABLE_NAME AS t, COLUMN_NAME AS c
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME LIKE '%\\_path'`;
    expect(cols.length).toBeGreaterThan(0);
    const listed = new Set(UPLOAD_REFERENCE_SOURCES.map((s) => `${s.table}.${s.column}`));
    for (const { t, c } of cols) expect(listed, `${t}.${c} UPLOAD_REFERENCE_SOURCES'ta yok`).toContain(`${t}.${c}`);
    // Sistem logosu JSON içinde (sütun adı `*_path` değil) — listede olmalı.
    expect(listed).toContain("system_settings.value_json.path");
  });

  it("AC-243: zamanlama pazar 04:30 Europe/Istanbul (01:30 UTC)", () => {
    const sat = Date.UTC(2026, 10, 14, 12, 0); // cumartesi
    expect(new Date(nextOrphanScanAt(sat)).toISOString()).toBe("2026-11-15T01:30:00.000Z");
    const sunAfter = Date.UTC(2026, 10, 15, 2, 0);
    expect(new Date(nextOrphanScanAt(sunAfter)).toISOString()).toBe("2026-11-22T01:30:00.000Z");
    const sunBefore = Date.UTC(2026, 10, 15, 1, 0);
    expect(new Date(nextOrphanScanAt(sunBefore)).toISOString()).toBe("2026-11-15T01:30:00.000Z");
  });
});
