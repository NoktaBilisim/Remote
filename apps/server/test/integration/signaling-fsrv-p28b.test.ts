// P28b K3 sinyal uçtan uca (gerçek WS + MySQL + sahte clamd TCP): mod sabitleme (AC-355), SERVER odasında caps/hello.fileMode,
// DC file.meta reddi (§5.4 b), eski istemci + P2P kapıları, fsrv.* akışı (yükle → tara → teklif → indir → session_files OK) ve
// SERVER modunda yazdırma (pid + boyut bağı, INFECTED → print.cancel + print.status ERROR). HTTP parça ucu routes.ts'te
// (ayrı iş); burada parçalar servis üzerinden (`putChunk`) sürülür.
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { Writable } from "node:stream";
import { avEicar } from "@remote/contracts/api/clamav";
import { FSRV_AUDIT } from "@remote/contracts/audit";
import type { PermissionKey } from "@remote/contracts/permissions";
import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ClamdClient } from "../../src/fsrv/clamd.ts";
import { Scanner } from "../../src/fsrv/scan.ts";
import { ScanQueue } from "../../src/fsrv/scan-queue.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { realClock } from "../../src/signaling/types.ts";
import { newId } from "../../src/lib/ids.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb } from "../helpers/app.ts";
import { FAKE_METRICS_TOKEN } from "../helpers/secrets.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders, type WsClient } from "../helpers/ws.ts";

const PERMS = {
  "sessions.create": true,
  "sessions.view": true,
  "remote_control.use": true,
  "remote_control.clipboard": true,
  "file_transfer.use": true,
  "file_transfer.print": true,
};
const NEW_CAPS = ["rs.cap.clip1", "rs.cap.print1", "rs.cap.fsrv1"];
const OLD_CAPS = ["rs.cap.clip1", "rs.cap.print1"];
const METRICS = "m".repeat(32);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// --- sahte clamd (INSTREAM: EICAR içeriyorsa FOUND) ---
let clamd: Server | undefined;
let clamdPort = 0;
beforeAll(async () => {
  clamd = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const z = buf.indexOf(0);
      if (z < 0) return;
      if (buf.subarray(1, z).toString() === "PING") return void sock.end("PONG\0");
      let off = z + 1;
      const body: Buffer[] = [];
      for (;;) {
        if (buf.length < off + 4) return;
        const len = buf.readUInt32BE(off);
        if (len === 0) break;
        if (buf.length < off + 4 + len) return;
        body.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
      const infected = Buffer.concat(body).toString("latin1").includes("EICAR");
      sock.end(infected ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
    });
    sock.on("error", () => undefined);
  });
  await new Promise<void>((r) => clamd?.listen(0, "127.0.0.1", r));
  const a = clamd.address();
  clamdPort = typeof a === "object" && a ? a.port : 0;
});
afterAll(() => new Promise<void>((r) => (clamd ? clamd.close(() => r()) : r())));

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

/** Uygulamanın tarayıcısını sahte clamd'ye yönlendirir (wiring.ts env hedefi yerine); disk oranı sabit (AC-362 ayrı test). */
function useFakeClamd(l: Live): void {
  l.app.fsrv.store.freeRatioOverride = 1;
  const client = new ClamdClient({ cidr: "172.30.2.0/28", dialHost: () => "127.0.0.1", retryIntervalMs: 20, retryTotalMs: 200 });
  l.app.fsrv.service.d.scanner = new Scanner({
    client,
    queue: new ScanQueue(realClock),
    target: () => Promise.resolve({ host: "172.30.2.5", port: clamdPort }),
    metrics: createMetrics(),
    log: l.app.log,
    now: () => Date.now(),
  });
}

async function setServerMode(tenantId: string, on: boolean): Promise<void> {
  await testDb().tenantSettings.update({ where: { tenantId }, data: { fileServerMode: on } });
}

/** Firma (SERVER açık) → oturum aç → ayar KAPAT (sabitleme) → AGENT misafir admit. */
async function serverRoom(l: Live, caps: string[], opts: { serverMode?: boolean } = {}) {
  const tenant = await createTenant();
  await setServerMode(tenant.id, opts.serverMode ?? true);
  const user = await createUser({ tenantId: tenant.id, role: "USER", perms: PERMS });
  const s = await loginAs(l.app, user);
  const created = (await l.app.inject({ method: "POST", url: "/api/v1/sessions", headers: s.headers, payload: {} })).json<{
    id: string;
    link: string;
  }>();
  await setServerMode(tenant.id, !(opts.serverMode ?? true)); // AC-355: açılıştan sonra ayar değişir → oda modu aynı
  const tech = await connect(`${l.base}/ws/tech?sessionId=${created.id}`, ["rs.v1"], techHeaders(s.token, ORIGIN));
  await tech.waitFor("hello");
  const headers = { "x-forwarded-for": "203.0.113.61" };
  const token = created.link.split("/").pop() ?? "";
  const r = await l.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/resolve",
    headers,
    payload: { token, clientKind: "AGENT" },
  });
  const { joinNonce, consentText } = r.json<{ joinNonce: string; consentText: { id: string } }>();
  const j = await l.app.inject({
    method: "POST",
    url: "/api/v1/public/sessions/join",
    headers,
    payload: { joinNonce, customerName: "Mehmet Müşteri", consentAccepted: true, consentTextId: consentText.id },
  });
  const { wsTicket, admitCode } = j.json<{ wsTicket: string; admitCode: string }>();
  const guest = await connect(`${l.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`, ...caps]);
  await guest.waitFor("lobby.wait");
  await tech.waitFor("peer.pending");
  tech.send({ t: "guest.admit", admitCode });
  const hello = await guest.waitFor("hello");
  const joined = await tech.waitFor("peer.joined");
  return { tenantId: tenant.id, userId: user.id, sessionId: created.id, tech, guest, hello, joined };
}

async function grant(tech: WsClient, guest: WsClient): Promise<void> {
  tech.send({ t: "control.request" });
  await guest.waitFor("control.request");
  guest.send({ t: "control.state", state: "GRANTED", source: "UI" });
  await tech.waitFor("control.state");
}

const init = (xid: string, body: Buffer, extra: Record<string, unknown> = {}) => ({
  t: "fsrv.init",
  xid,
  name: "rapor.txt",
  size: body.length,
  sha256: sha(body),
  purpose: "FILE",
  ...extra,
});

describe("P28b K3 — mod sabitleme, caps ve DC reddi", () => {
  it("AC-355: file_mode açılışta sabit; yeni istemci hello.fileMode=SERVER, caps'te dosya/yazdırma yok, teknisyene fsrv", async () => {
    live = await startLive();
    const x = await serverRoom(live, NEW_CAPS);
    const row = await testDb().supportSession.findUnique({ where: { id: x.sessionId }, select: { fileMode: true } });
    expect(row?.fileMode).toBe("SERVER");
    expect(x.hello).toMatchObject({ fileMode: "SERVER", caps: ["remote_control", "clipboard"] });
    expect(x.joined).toMatchObject({ fileMode: "SERVER", guestFeatures: ["clipboard", "print", "fsrv"] });
  });

  it("AC-355 (§5.4 b): SERVER odasında DC file.meta yok sayılır → session_files 0 + rs_fsrv_denied_total{dc_meta}", async () => {
    live = await startLive({ env: { METRICS_TOKEN: METRICS } });
    const x = await serverRoom(live, NEW_CAPS);
    const meta = { t: "file.meta", direction: "TO_CUSTOMER", fileName: "a.txt", sizeBytes: 10, sha256: "a".repeat(64) };
    x.tech.send({ ...meta, result: "OK" });
    x.guest.send({ ...meta, result: "OK" });
    await expect
      .poll(async () => (await live?.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${METRICS}` } }))?.body)
      .toContain('rs_fsrv_denied_total{reason="dc_meta"} 2');
    expect(await testDb().sessionFile.count({ where: { sessionId: x.sessionId } })).toBe(0);
  });

  it("AC-355/352: eski istemci (rs.cap.fsrv1 yok) SERVER odasında dosya + yazdırma kapalı; misafir fsrv.* → 1008", async () => {
    live = await startLive();
    const x = await serverRoom(live, OLD_CAPS);
    expect(x.hello).not.toHaveProperty("fileMode");
    expect(x.hello).toMatchObject({ caps: ["remote_control", "clipboard"] });
    expect(x.joined).toMatchObject({ fileMode: "SERVER", guestFeatures: ["clipboard", "print"] });
    const body = Buffer.from("merhaba");
    x.tech.send(init("xid-old-0001", body));
    expect(await x.tech.waitFor("fsrv.status")).toEqual({
      t: "fsrv.status",
      xid: "xid-old-0001",
      state: "REJECTED",
      reason: "UNSUPPORTED",
    });
    await grant(x.tech, x.guest);
    x.tech.send({ t: "print.request", pid: "pid-old-0001", sizeBytes: 100 });
    expect(await x.tech.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    expect(x.guest.msgs.filter((m) => m.t === "print.request")).toHaveLength(0);
    x.guest.send(init("xid-old-0002", body));
    expect((await x.guest.closed).code).toBe(1008);
  });

  it("AC-355: P2P odasında teknisyen fsrv.init → REJECTED/MODE; hello.fileMode=P2P yalnız yetenekli misafire", async () => {
    live = await startLive();
    const x = await serverRoom(live, NEW_CAPS, { serverMode: false });
    expect(x.hello).toMatchObject({ fileMode: "P2P", caps: ["remote_control", "file_transfer", "clipboard", "print"] });
    x.tech.send(init("xid-p2p-0001", Buffer.from("x")));
    expect(await x.tech.waitFor("fsrv.status")).toMatchObject({ state: "REJECTED", reason: "MODE" });
  });
});

describe("P28b K3 — fsrv.* akışı (sahte clamd)", () => {
  it("AC-357/360: yükle → SCANNING → CLEAN → teklif → kabul → indirme belirteci → sonuç OK → DELIVERED + session_files OK; xid tekrarı VALIDATION", async () => {
    live = await startLive();
    useFakeClamd(live);
    const x = await serverRoom(live, NEW_CAPS);
    const body = Buffer.from("P28b uçtan uca içerik ".repeat(50));
    x.tech.send(init("xid-e2e-0001", body));
    const up = await x.tech.waitFor("fsrv.upload");
    expect(up).toMatchObject({ xid: "xid-e2e-0001", chunkBytes: 1_048_576, chunks: 1 });
    x.tech.send(init("xid-e2e-0002", body)); // yönde etkin aktarım var
    expect(await x.tech.waitFor("fsrv.status")).toMatchObject({ xid: "xid-e2e-0002", state: "REJECTED", reason: "BUSY" });
    expect(await live.app.fsrv.service.putChunk(up.fid, 0, body)).toMatchObject({ status: 202 });
    const offer = await x.guest.waitFor("fsrv.offer");
    expect(offer).toEqual({ t: "fsrv.offer", fid: up.fid, name: "rapor.txt", size: body.length, sha256: sha(body), purpose: "FILE" });
    x.guest.send({ t: "fsrv.accept", fid: up.fid });
    expect(await x.guest.waitFor("fsrv.download")).toMatchObject({ fid: up.fid });
    x.guest.send({ t: "fsrv.result", fid: up.fid, ok: true });
    await expect.poll(() => x.tech.msgs.some((m) => m.t === "fsrv.status" && m.state === "DELIVERED")).toBe(true);
    const files = await testDb().sessionFile.findMany({ where: { sessionId: x.sessionId } });
    expect(files.map((f) => f.result)).toEqual(["OK"]);
    x.tech.send(init("xid-e2e-0001", body));
    expect(await x.tech.waitFor("error")).toMatchObject({ code: "VALIDATION" });
  });

  it("AC-358 (D-P28b-3, Go K5): SERVER yazdırma — boyut ≠ bekleyen iş FORBIDDEN + print.cancel; virüslü PDF → INFECTED + print.cancel + print.status ERROR", async () => {
    live = await startLive();
    useFakeClamd(live);
    const x = await serverRoom(live, NEW_CAPS);
    await grant(x.tech, x.guest);
    const pdf = Buffer.from(`%PDF-1.4 ${avEicar()}`);
    const printInit = (xid: string, pid: string, size = pdf.length) =>
      ({ ...init(xid, pdf, { name: "belge.pdf", purpose: "PRINT", pid }), size }) as const;

    x.tech.send({ t: "print.request", pid: "pid-prn-0001", sizeBytes: pdf.length });
    await x.guest.waitFor("print.request");
    x.tech.send(printInit("xid-prn-0001", "pid-prn-0001", pdf.length + 1));
    expect(await x.tech.waitFor("fsrv.status")).toMatchObject({ state: "REJECTED", reason: "FORBIDDEN" });
    expect(await x.guest.waitFor("print.cancel")).toEqual({ t: "print.cancel", pid: "pid-prn-0001" });
    expect(await x.tech.waitFor("print.status")).toMatchObject({ pid: "pid-prn-0001", result: "ERROR" });

    await new Promise((r) => setTimeout(r, 10)); // ret sonrası 30 sn bekleme yalnız REJECTED/TIMEOUT kararında
    x.tech.send({ t: "print.request", pid: "pid-prn-0002", sizeBytes: pdf.length });
    await x.guest.waitFor("print.request");
    x.tech.send(printInit("xid-prn-0002", "pid-prn-0002"));
    const up = await x.tech.waitFor("fsrv.upload");
    await live.app.fsrv.service.putChunk(up.fid, 0, pdf);
    await expect.poll(() => x.guest.msgs.some((m) => m.t === "fsrv.status" && m.state === "INFECTED")).toBe(true);
    // waitFor tüketir: ilk işin print.cancel/print.status'u yukarıda alındı.
    expect(await x.guest.waitFor("print.cancel")).toEqual({ t: "print.cancel", pid: "pid-prn-0002" });
    expect(await x.tech.waitFor("print.status")).toEqual({ t: "print.status", pid: "pid-prn-0002", result: "ERROR" });
    const row = await testDb().sessionStoredFile.findUnique({ where: { id: up.fid }, select: { state: true, fileName: true } });
    expect(row).toEqual({ state: "INFECTED", fileName: "belge.pdf" });
    expect(x.guest.msgs.filter((m) => m.t === "fsrv.offer")).toHaveLength(0);
  });

  it("AC-355 §5.2: oda kapanınca açık yükleme CANCELLED (disk/satır yetim kalmaz)", async () => {
    live = await startLive();
    useFakeClamd(live);
    const x = await serverRoom(live, NEW_CAPS);
    const body = Buffer.from("yarım kalan");
    x.tech.send(init("xid-end-0001", body));
    const up = await x.tech.waitFor("fsrv.upload");
    x.tech.send({ t: "session.end" });
    await x.tech.waitFor("session.ended");
    await expect
      .poll(async () => (await testDb().sessionStoredFile.findUnique({ where: { id: up.fid }, select: { state: true } }))?.state)
      .toBe("CANCELLED");
    expect(live.app.fsrv.service.transfers.size).toBe(0);
  });
});

function captureLogs(): { logger: pino.Logger; text: () => string } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: pino({ level: "debug" }, stream), text: () => lines.join("") };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("P28b §12 log taraması (AC-356, T2/T11)", () => {
  it("AC-356 dosya adı ve yükleme/indirme belirteci tam akıştan sonra sunucu logu, audit_logs ve /metrics'te 0 eşleşme", async () => {
    const logs = captureLogs();
    live = await startLive({ logger: logs.logger, env: { METRICS_TOKEN: FAKE_METRICS_TOKEN } });
    useFakeClamd(live);
    const x = await serverRoom(live, NEW_CAPS);
    const name = `gizli-ad-${newId()}.txt`;
    const body = Buffer.from("log taramasi icerigi ".repeat(20));
    x.tech.send(init("xid-log-0001", body, { name }));
    const up = await x.tech.waitFor("fsrv.upload");
    const putRes = await live.app.inject({
      method: "PUT",
      url: `/api/v1/fsrv/uploads/${up.fid}/chunks/0`,
      headers: { ...bearer(up.token), "content-type": "application/octet-stream" },
      payload: body,
    });
    expect(putRes.statusCode).toBe(202);
    await x.guest.waitFor("fsrv.offer");
    x.guest.send({ t: "fsrv.accept", fid: up.fid });
    const dl = await x.guest.waitFor("fsrv.download");
    const getRes = await live.app.inject({ method: "GET", url: `/api/v1/fsrv/files/${up.fid}/content`, headers: bearer(dl.token) });
    expect(getRes.statusCode).toBe(200);
    x.guest.send({ t: "fsrv.result", fid: up.fid, ok: true });
    await expect.poll(() => x.tech.msgs.some((m) => m.t === "fsrv.status" && m.state === "DELIVERED")).toBe(true);
    for (const action of [FSRV_AUDIT.UPLOAD, FSRV_AUDIT.SCAN, FSRV_AUDIT.DOWNLOAD])
      await expect.poll(() => testDb().auditLog.count({ where: { entityId: x.sessionId, action } })).toBeGreaterThan(0);

    // pozitif denetimler: ad DB'de (temizlenmeden) duruyor, log gerçekten yakalandı ve akışın kayıtlarını içeriyor
    const row = await testDb().sessionStoredFile.findUniqueOrThrow({ where: { id: up.fid }, select: { fileName: true } });
    expect(row.fileName).toBe(name);
    const logText = logs.text();
    expect(logText).toContain(up.fid);
    const audit = JSON.stringify(
      await testDb().auditLog.findMany({
        where: { entityId: x.sessionId },
        select: { action: true, username: true, entity: true, entityId: true, oldValue: true, newValue: true, userAgent: true },
      }),
    );
    expect(audit).toContain(up.fid);
    const metrics = (await live.app.inject({ method: "GET", url: "/metrics", headers: bearer(FAKE_METRICS_TOKEN) })).body;
    expect(metrics).toContain("rs_fsrv_upload_total");

    for (const [where, hay] of [
      ["log", logText],
      ["audit", audit],
      ["metrics", metrics],
    ] as const)
      for (const needle of ["gizli-ad-", name, up.token, dl.token])
        expect(hay.includes(needle), `${where}: ${needle.slice(0, 9)}`).toBe(false);
  });
});

describe("D-P28b-K1-3 fsrv.accept güncel yetki", () => {
  it("D-P28b-K1-3 teknisyenin file_transfer.use yetkisi düşünce önceki indirme belirteci 404, yeni fsrv.accept belirteç üretmez", async () => {
    live = await startLive();
    useFakeClamd(live);
    const x = await serverRoom(live, NEW_CAPS);
    const body = Buffer.from("musteriden teknisyene");
    x.guest.send(init("xid-acc-0001", body));
    const up = await x.guest.waitFor("fsrv.upload");
    expect(await live.app.fsrv.service.putChunk(up.fid, 0, body)).toMatchObject({ status: 202 });
    await x.tech.waitFor("fsrv.offer");
    x.tech.send({ t: "fsrv.accept", fid: up.fid });
    const dl = await x.tech.waitFor("fsrv.download");
    const get = () => live?.app.inject({ method: "GET", url: `/api/v1/fsrv/files/${up.fid}/content`, headers: bearer(dl.token) });
    expect((await get())?.statusCode).toBe(200);

    const narrowed = Object.keys(PERMS).filter((k) => k !== "file_transfer.use") as PermissionKey[];
    await live.app.rooms.applyPermChange(x.userId, narrowed);
    expect((await get())?.statusCode).toBe(404);
    const before = x.tech.msgs.filter((m) => m.t === "fsrv.download").length;
    x.tech.send({ t: "fsrv.accept", fid: up.fid });
    await new Promise((r) => setTimeout(r, 100));
    expect(x.tech.msgs.filter((m) => m.t === "fsrv.download").length).toBe(before);
  });
});
