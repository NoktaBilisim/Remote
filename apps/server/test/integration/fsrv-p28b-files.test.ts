// P28b K3 — sunucu dosya hattı entegrasyonu (gerçek MySQL + sahte clamd TCP). Yükleme (PUT parça), şifreli disk, tarama,
// teklif/indirme/teslim/ret/iptal, virüslü ve taranamayan dosyanın silinmesi, kota, belirteç ve IDOR 404'leri, geçmiş link ucu.
// WS kapıları 1–6 ve yazdırma pid/boyut kapısı sinyal katmanındadır (ayrı test); burada servis doğrudan çağrılır.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FSRV_AUDIT } from "@remote/contracts/audit";
import type { ServerOutbound } from "@remote/contracts/ws";
import { FSRV_CHUNK_BYTES, FSRV_NOTFOUND_PER_MIN_IP } from "@remote/contracts/ws-fsrv";
import * as lifecycle from "../../src/fsrv/lifecycle.ts";
import type { Side } from "../../src/fsrv/service.ts";
import { newId } from "../../src/lib/ids.ts";
import { startFakeClamd, type FakeClamd } from "../helpers/fake-clamd.ts";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  makeApp,
  TEST_FILES_DIR,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";

let app: FastifyInstance;
let fake: FakeClamd;
let tenantId: string;
let tech: TestUser;
const sent: { sessionId: string; side: Side; msg: ServerOutbound }[] = [];
const printFailed: string[] = [];
const ctx = { ip: "127.0.0.1", userAgent: "vitest", requestId: "r" };

beforeAll(async () => {
  fake = await startFakeClamd();
  app = makeApp({ env: fake.env(), fsrvTest: fake.test });
  await app.ready();
  app.fsrv.service.sink = {
    send: (sessionId, side, msg) => sent.push({ sessionId, side, msg }),
    printFailed: (_s, pid) => printFailed.push(pid),
  };
  tenantId = (await createTenant()).id;
  tech = await createUser({ tenantId, role: "USER", perms: { "session_history.view": true, "file_transfer.use": true } });
});
afterAll(async () => {
  await app.close();
  await fake.close();
});

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const row = (fid: string) => testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: fid } });
const diskFiles = async (t = tenantId) => (await readdir(join(TEST_FILES_DIR, t)).catch(() => [] as string[])).sort();
const msgs = (sessionId: string) => sent.filter((m) => m.sessionId === sessionId);

async function session(): Promise<string> {
  return (await createSupportSessionRow({ tenantId, technicianId: tech.id, status: "ACTIVE" })).id;
}

async function begin(sessionId: string, content: Buffer, o: { purpose?: "FILE" | "PRINT"; pid?: string; tenant?: string } = {}) {
  const r = await app.fsrv.service.begin({
    sessionId,
    tenantId: o.tenant ?? tenantId,
    direction: "TO_CUSTOMER",
    purpose: o.purpose ?? "FILE",
    xid: newId().slice(0, 16),
    name: o.purpose === "PRINT" ? "belge.pdf" : "rapor şubat.txt",
    size: content.length,
    sha256: sha(content),
    retentionDays: 1,
    sender: { userId: tech.id, username: tech.email, ctx },
    ...(o.pid ? { pid: o.pid } : {}),
  });
  if ("reject" in r) throw new Error(`reject ${r.reject}`);
  return r;
}

const put = (fid: string, n: number, token: string, body: Buffer, remoteAddress = "127.0.0.1") =>
  app.inject({
    method: "PUT",
    url: `/api/v1/fsrv/uploads/${fid}/chunks/${n}`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
    payload: body,
    remoteAddress,
  });

async function upload(sessionId: string, content: Buffer, o: Parameters<typeof begin>[2] = {}) {
  const b = await begin(sessionId, content, o);
  for (let n = 0; n < b.chunks; n++) {
    const res = await put(b.fid, n, b.token, content.subarray(n * FSRV_CHUNK_BYTES, (n + 1) * FSRV_CHUNK_BYTES));
    expect(res.statusCode).toBe(n === b.chunks - 1 ? 202 : 200);
  }
  return b.fid;
}

const clean = (fid: string) => expect.poll(async () => (await row(fid)).state).toBe("CLEAN");

async function downloadToken(sessionId: string, fid: string): Promise<string> {
  await lifecycle.accept(app.fsrv.service, sessionId, fid, "guest", { kind: "CUSTOMER" });
  const m = msgs(sessionId).find((x) => x.msg.t === "fsrv.download" && x.msg.fid === fid);
  if (m?.msg.t !== "fsrv.download") throw new Error("download yok");
  return m.msg.token;
}

const get = (fid: string, token: string | null, remoteAddress = "127.0.0.1") =>
  app.inject({
    method: "GET",
    url: `/api/v1/fsrv/files/${fid}/content`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    remoteAddress,
  });

describe("AC-356 yükleme → şifreli disk → tarama → teklif → indirme → teslim", () => {
  it("AC-356 2,5 MiB dosya parça parça yüklenir; diskte düz metin yok; CLEAN sonrası alıcıya teklif; GET güvenlik başlıklı akış; teslimde session_files OK", async () => {
    const sid = await session();
    const marker = Buffer.from("GIZLI-ICERIK-ISARETI-");
    const content = Buffer.concat([marker, Buffer.alloc(2.5 * 1024 * 1024 - marker.length, 7)]);
    const fid = await upload(sid, content);
    await clean(fid);
    const r = await row(fid);
    const disk = await readFile(join(TEST_FILES_DIR, r.storageRel ?? "x"));
    expect(disk.includes(marker)).toBe(false);
    expect(msgs(sid).some((m) => m.side === "guest" && m.msg.t === "fsrv.offer" && m.msg.fid === fid)).toBe(true);
    expect(msgs(sid).some((m) => m.side === "tech" && m.msg.t === "fsrv.status" && m.msg.state === "CLEAN")).toBe(true);

    const token = await downloadToken(sid, fid);
    const res = await get(fid, token);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(content)).toBe(true);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="rapor _ubat.txt"; filename*=UTF-8''rapor%20%C5%9Fubat.txt`);
    await expect.poll(() => testDb().auditLog.count({ where: { tenantId, action: FSRV_AUDIT.DOWNLOAD, entityId: sid } })).toBe(1);

    await lifecycle.result(app.fsrv.service, sid, fid, "guest", true);
    const d = await row(fid);
    expect(d.deliveredAt).not.toBeNull();
    expect(d.expiresAt).not.toBeNull();
    expect(d.state).toBe("CLEAN");
    expect(await testDb().sessionFile.count({ where: { id: fid, result: "OK", reportedBy: "CUSTOMER" } })).toBe(1);
    expect(msgs(sid).some((m) => m.side === "tech" && m.msg.t === "fsrv.status" && m.msg.state === "DELIVERED")).toBe(true);
    // O-P28b-2: aynı fid için ikinci sonuç / geç sonuç yok sayılır (tek session_files satırı)
    await lifecycle.result(app.fsrv.service, sid, fid, "guest", true);
    expect(await testDb().sessionFile.count({ where: { id: fid } })).toBe(1);
  });

  it("AC-356 parça sırası: n>next → 409 {next}; n<next → 200 yazmaz; yanlış boy → 400; SHA uyuşmazsa CORRUPT ve disk silinir", async () => {
    const sid = await session();
    const content = Buffer.alloc(FSRV_CHUNK_BYTES + 10, 3);
    const diskBefore = await diskFiles();
    const b = await begin(sid, content);
    const gap = await put(b.fid, 1, b.token, content.subarray(FSRV_CHUNK_BYTES));
    expect(gap.statusCode).toBe(409);
    expect(gap.json()).toEqual({ next: 0 });
    expect((await put(b.fid, 0, b.token, Buffer.alloc(10))).statusCode).toBe(400);
    expect((await put(b.fid, 0, b.token, content.subarray(0, FSRV_CHUNK_BYTES))).statusCode).toBe(200);
    const again = await put(b.fid, 0, b.token, content.subarray(0, FSRV_CHUNK_BYTES));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ next: 1, received: FSRV_CHUNK_BYTES });
    // son parçayı bozuk gönder → CORRUPT
    expect((await put(b.fid, 1, b.token, Buffer.alloc(10, 9))).statusCode).toBe(202);
    expect((await row(b.fid)).state).toBe("CORRUPT");
    expect((await row(b.fid)).storageRel).toBeNull();
    expect(await diskFiles()).toEqual(diskBefore);
    // belirteç son parçada düştü
    expect((await put(b.fid, 1, b.token, Buffer.alloc(10))).statusCode).toBe(404);
  });
});

describe("AC-358/359 virüslü ve taranamayan dosya teslim edilmez, disk hemen silinir", () => {
  it("AC-358 virüslü dosya → INFECTED + imza iki tarafa; disk silinir; file.infected audit", async () => {
    const sid = await session();
    const before = await diskFiles();
    const fid = await upload(sid, Buffer.from("bu bir VIRUS ornegi"));
    await expect.poll(async () => (await row(fid)).state).toBe("INFECTED");
    const r = await row(fid);
    expect(r.storageRel).toBeNull();
    expect(r.signature).toBe("Win.Test.Virus");
    expect(await diskFiles()).toEqual(before);
    for (const side of ["tech", "guest"] as const)
      expect(
        msgs(sid).some(
          (m) => m.side === side && m.msg.t === "fsrv.status" && m.msg.state === "INFECTED" && m.msg.signature === "Win.Test.Virus",
        ),
      ).toBe(true);
    expect(msgs(sid).some((m) => m.msg.t === "fsrv.offer")).toBe(false);
    await expect.poll(() => testDb().auditLog.count({ where: { tenantId, action: FSRV_AUDIT.INFECTED, entityId: sid } })).toBe(1);
  });

  it("AC-359 clamd ERROR → SCAN_FAILED/ERROR (fail-closed), disk silinir; öz-sınama bayrağı varken clamd'ye gidilmez", async () => {
    const sid = await session();
    fake.mode = "error";
    try {
      const fid = await upload(sid, Buffer.from("normal icerik"));
      await expect.poll(async () => (await row(fid)).state).toBe("SCAN_FAILED");
      expect((await row(fid)).scanReason).toBe("ERROR");
      expect((await row(fid)).storageRel).toBeNull();
    } finally {
      fake.mode = "ok";
    }
    app.fsrv.scanner.misconfigured = true;
    try {
      const scans = fake.scans;
      const fid = await upload(sid, Buffer.from("normal icerik 2"));
      await expect.poll(async () => (await row(fid)).state).toBe("SCAN_FAILED");
      expect(fake.scans).toBe(scans);
    } finally {
      app.fsrv.scanner.misconfigured = false;
    }
  });

  it("AC-359 PRINT taranamazsa yazdırma işi hata ile kapanır (sink.printFailed pid)", async () => {
    const sid = await session();
    fake.mode = "error";
    try {
      const fid = await upload(sid, Buffer.from("%PDF-1.4 test"), { purpose: "PRINT", pid: "p-0001-abcdef" });
      await expect.poll(async () => (await row(fid)).state).toBe("SCAN_FAILED");
      expect(printFailed).toContain("p-0001-abcdef");
    } finally {
      fake.mode = "ok";
    }
  });
});

describe("AC-360 ret / iptal / oda kapanışı / yazdırma: disk hemen silinir", () => {
  it("AC-360 alıcı reddi → REJECTED, disk yok; göndericiye REJECTED", async () => {
    const sid = await session();
    const fid = await upload(sid, Buffer.from("ret testi"));
    await clean(fid);
    await lifecycle.reject(app.fsrv.service, sid, fid, "guest");
    const r = await row(fid);
    expect(r.state).toBe("REJECTED");
    expect(r.storageRel).toBeNull();
    expect(msgs(sid).some((m) => m.side === "tech" && m.msg.t === "fsrv.status" && m.msg.state === "REJECTED")).toBe(true);
  });

  it("AC-360 teknisyen alıcı değilse ret/kabul yok sayılır (yön kuralı)", async () => {
    const sid = await session();
    const fid = await upload(sid, Buffer.from("yon testi"));
    await clean(fid);
    await lifecycle.reject(app.fsrv.service, sid, fid, "tech");
    expect((await row(fid)).state).toBe("CLEAN");
    await lifecycle.roomClosed(app.fsrv.service, sid);
    expect((await row(fid)).state).toBe("CANCELLED");
  });

  it("AC-360 gönderen iptali (yükleme sırasında) → CANCELLED, .part silinir; geç fsrv.result yok sayılır", async () => {
    const sid = await session();
    const content = Buffer.alloc(FSRV_CHUNK_BYTES * 2, 1);
    const diskBefore = await diskFiles();
    const b = await begin(sid, content);
    await put(b.fid, 0, b.token, content.subarray(0, FSRV_CHUNK_BYTES));
    expect((await diskFiles()).length).toBe(diskBefore.length + 1);
    await lifecycle.cancel(app.fsrv.service, sid, b.fid, "tech");
    expect((await row(b.fid)).state).toBe("CANCELLED");
    expect(await diskFiles()).toEqual(diskBefore);
    await lifecycle.result(app.fsrv.service, sid, b.fid, "guest", true);
    expect(await testDb().sessionFile.count({ where: { id: b.fid } })).toBe(0);
    expect((await put(b.fid, 1, b.token, content.subarray(FSRV_CHUNK_BYTES))).statusCode).toBe(404);
  });

  it("AC-360 üç başarısız indirme → CANCELLED + session_files CORRUPT; disk silinir", async () => {
    const sid = await session();
    const fid = await upload(sid, Buffer.from("bozuk indirme"));
    await clean(fid);
    for (let i = 0; i < 3; i++) await lifecycle.result(app.fsrv.service, sid, fid, "guest", false);
    const r = await row(fid);
    expect(r.state).toBe("CANCELLED");
    expect(r.storageRel).toBeNull();
    expect(await testDb().sessionFile.count({ where: { id: fid, result: "CORRUPT" } })).toBe(1);
  });

  it("AC-360 fid başına en çok 3 indirme belirteci", async () => {
    const sid = await session();
    const fid = await upload(sid, Buffer.from("belirtec siniri"));
    await clean(fid);
    for (let i = 0; i < 5; i++) await lifecycle.accept(app.fsrv.service, sid, fid, "guest", { kind: "CUSTOMER" });
    expect(msgs(sid).filter((m) => m.msg.t === "fsrv.download").length).toBe(3);
    await lifecycle.roomClosed(app.fsrv.service, sid);
  });

  it("AC-360 PRINT teslimi → EXPIRED, disk silinir, session_files yazılmaz; teklifte pid", async () => {
    const sid = await session();
    const fid = await upload(sid, Buffer.from("%PDF-1.4 belge"), { purpose: "PRINT", pid: "p-0002-abcdef" });
    await clean(fid);
    const offer = msgs(sid).find((m) => m.msg.t === "fsrv.offer");
    expect(offer?.msg).toMatchObject({ purpose: "PRINT", pid: "p-0002-abcdef", name: "belge.pdf" });
    await lifecycle.result(app.fsrv.service, sid, fid, "guest", true);
    const r = await row(fid);
    expect(r.state).toBe("EXPIRED");
    expect(r.storageRel).toBeNull();
    expect(await testDb().sessionFile.count({ where: { id: fid } })).toBe(0);
  });

  it("AC-360 oda kapanışı açık PRINT teklifini EXPIRED, yarım yüklemeyi CANCELLED yapar ve belirteçleri düşürür", async () => {
    const sid = await session();
    const pf = await upload(sid, Buffer.from("%PDF-1.4 x"), { purpose: "PRINT", pid: "p-0003-abcdef" });
    await clean(pf);
    const token = await downloadToken(sid, pf);
    const content = Buffer.alloc(FSRV_CHUNK_BYTES * 2, 1);
    const b = await begin(sid, content);
    await lifecycle.roomClosed(app.fsrv.service, sid);
    expect((await row(pf)).state).toBe("EXPIRED");
    expect((await row(b.fid)).state).toBe("CANCELLED");
    expect((await get(pf, token)).statusCode).toBe(404);
  });
});

describe("AC-362 kota ve oturum tavanı (kapı 7–8), disk %10", () => {
  it("AC-362 firma kotası dolu → QUOTA; oturum 2 GiB tavanı → SESSION_LIMIT; disk boş < %10 → QUOTA / PUT 409 STORAGE_QUOTA", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id, role: "USER" });
    const s1 = (await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" })).id;
    await testDb().tenant.update({ where: { id: t.id }, data: { storageQuotaGb: 1 } });
    const svc = app.fsrv.service;
    const input = (sessionId: string, size: number) => ({
      sessionId,
      tenantId: t.id,
      direction: "TO_TECH" as const,
      purpose: "FILE" as const,
      xid: newId().slice(0, 16),
      name: "a.bin",
      size,
      sha256: "0".repeat(64),
      retentionDays: 1,
      sender: { username: "customer", ctx },
    });
    const big = 256 * 1024 * 1024;
    for (let i = 0; i < 4; i++) {
      const s = (await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" })).id;
      expect(await svc.begin(input(s, big))).not.toHaveProperty("reject");
    }
    expect(await svc.begin(input(s1, 1))).toEqual({ reject: "QUOTA" });
    // kotayı yükselt → oturum tavanı (iptal edilen satırlar da sayılır)
    await testDb().tenant.update({ where: { id: t.id }, data: { storageQuotaGb: 100 } });
    for (let i = 0; i < 8; i++) {
      const r = await svc.begin(input(s1, big));
      if ("reject" in r) throw new Error(r.reject);
      const tr = svc.transfers.get(r.fid);
      if (tr) await svc.abortUpload(tr, "test");
    }
    expect(await svc.begin(input(s1, 1))).toEqual({ reject: "SESSION_LIMIT" });
    // disk
    const s2 = (await createSupportSessionRow({ tenantId: t.id, technicianId: u.id, status: "ACTIVE" })).id;
    const ok = await svc.begin(input(s2, 10));
    if ("reject" in ok) throw new Error(ok.reject);
    app.fsrv.store.freeRatioOverride = 0.05;
    try {
      expect(await svc.begin(input(s2, 10))).toEqual({ reject: "QUOTA" });
      const res = await put(ok.fid, 0, ok.token, Buffer.alloc(10));
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("STORAGE_QUOTA");
    } finally {
      app.fsrv.store.freeRatioOverride = 0.5;
    }
    for (const tr of [...svc.transfers.values()].filter((x) => x.tenantId === t.id)) await svc.abortUpload(tr, "test");
  });
});

describe("D-P28b-2 belirteç ve IDOR: tek tip 404, çerez okunmaz, IP sınırı", () => {
  it("D-P28b-2 belirteçsiz / bozuk / başka fid'in belirteci / yükleme belirteciyle GET → 404; çerezle GET → 404", async () => {
    const sid = await session();
    const a = await upload(sid, Buffer.from("dosya A"));
    const b = await upload(sid, Buffer.from("dosya B"));
    await clean(a);
    await clean(b);
    const ta = await downloadToken(sid, a);
    expect((await get(b, ta)).statusCode).toBe(404);
    expect((await get(a, null)).statusCode).toBe(404);
    expect((await get(a, "x".repeat(43))).statusCode).toBe(404);
    const s: Session = await loginAs(app, tech);
    const viaCookie = await app.inject({ method: "GET", url: `/api/v1/fsrv/files/${a}/content`, headers: s.headers });
    expect(viaCookie.statusCode).toBe(404);
    expect((await get(a, ta)).statusCode).toBe(200);
    await lifecycle.roomClosed(app.fsrv.service, sid);
  });

  it("D-P28b-2 IP başına 60/dk 404 → 429", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < FSRV_NOTFOUND_PER_MIN_IP; i++) expect((await get(newId(), null, ip)).statusCode).toBe(404);
    expect((await get(newId(), null, ip)).statusCode).toBe(429);
  });
});

describe("AC-360 geçmişten indirme (link ucu, HISTORY belirteci) ve storedFiles", () => {
  it("AC-360 teslim edilmiş dosya: storedFiles canDownload; link → GET 200 (file.download context=history); yetki geri alınınca 404; başka tenant 404", async () => {
    const sid = await session();
    const content = Buffer.from("gecmis dosyasi");
    const fid = await upload(sid, content);
    await clean(fid);
    await lifecycle.result(app.fsrv.service, sid, fid, "guest", true);
    await lifecycle.roomClosed(app.fsrv.service, sid);
    expect((await row(fid)).state).toBe("CLEAN");

    const s = await loginAs(app, tech);
    const detail = await app.inject({ method: "GET", url: `/api/v1/sessions/${sid}/history`, headers: s.headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().storedFiles).toEqual([
      expect.objectContaining({
        id: fid,
        purpose: "FILE",
        state: "CLEAN",
        canDownload: true,
        name: "rapor şubat.txt",
        sizeBytes: content.length,
      }),
    ]);

    const link = await app.inject({ method: "POST", url: `/api/v1/sessions/${sid}/stored-files/${fid}/link`, headers: s.headers });
    expect(link.statusCode).toBe(200);
    const { token } = link.json() as { token: string };
    const res = await get(fid, token);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(content)).toBe(true);
    await expect
      .poll(() => testDb().auditLog.findFirst({ where: { tenantId, action: FSRV_AUDIT.DOWNLOAD, entityId: sid, userId: tech.id } }))
      .toMatchObject({ newValue: { context: "history", by: "tech" } });

    // D-P28b-2: yetki geri alınınca HISTORY belirteci GET anında 404
    await testDb().userPermission.updateMany({ where: { userId: tech.id, permKey: "file_transfer.use" }, data: { granted: false } });
    try {
      expect((await get(fid, token)).statusCode).toBe(404);
      const denied = await app.inject({ method: "POST", url: `/api/v1/sessions/${sid}/stored-files/${fid}/link`, headers: s.headers });
      expect(denied.statusCode).toBe(403);
    } finally {
      await testDb().userPermission.updateMany({ where: { userId: tech.id, permKey: "file_transfer.use" }, data: { granted: true } });
    }
    // çıkış → belirteç geçersiz
    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: s.headers });
    expect((await get(fid, token)).statusCode).toBe(404);

    // başka tenant'ın kullanıcısı aynı oturum/fid → 404
    const other = await createTenant();
    const ou = await createUser({ tenantId: other.id, role: "ADMIN" });
    const os = await loginAs(app, ou);
    const idor = await app.inject({ method: "POST", url: `/api/v1/sessions/${sid}/stored-files/${fid}/link`, headers: os.headers });
    expect(idor.statusCode).toBe(404);
  });

  it("AC-360 teslim edilmemiş / PRINT / taranamayan satır için link 404; storedFiles'ta canDownload=false", async () => {
    const sid = await session();
    const fid = await upload(sid, Buffer.from("teslim edilmedi"));
    await clean(fid);
    const s = await loginAs(app, tech);
    const link = await app.inject({ method: "POST", url: `/api/v1/sessions/${sid}/stored-files/${fid}/link`, headers: s.headers });
    expect(link.statusCode).toBe(404);
    await lifecycle.roomClosed(app.fsrv.service, sid);
    const detail = await app.inject({ method: "GET", url: `/api/v1/sessions/${sid}/history`, headers: s.headers });
    expect(detail.json().storedFiles).toEqual([expect.objectContaining({ id: fid, state: "CANCELLED", canDownload: false })]);
  });
});
