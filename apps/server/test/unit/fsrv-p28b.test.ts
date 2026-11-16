// P28b K3 birim: şifreli dosya biçimi (§6), clamd istemcisi + sınıflandırma (§7.2, sahte TCP clamd), hedef CIDR (K-P28b-16,
// D-r2-5), adil kuyruk (O-P28b-3, D-r2-3), öz-sınama (§7.3). Gerçek clamd testi: `CLAMD_TEST_HOST` (+ `CLAMD_TEST_CIDR`).
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { avEicar } from "@remote/contracts/api/clamav";
import { FSRV_CHUNK_BYTES, fsrvChunkCount } from "@remote/contracts/ws-fsrv";
import { SecretBox } from "../../src/lib/crypto.ts";
import { BoxError, chunkOffset, makeHeader, openBox, sealChunk, boxSize } from "../../src/fsrv/box.ts";
import {
  ClamdClient,
  classifyReply,
  inAllowedCidr,
  parseVersion,
  resolveAllowed,
  selfTestJudgement,
  inCidrRange,
} from "../../src/fsrv/clamd.ts";
import { ScanQueue, type Release } from "../../src/fsrv/scan-queue.ts";
import { Scanner } from "../../src/fsrv/scan.ts";
import { FileStore } from "../../src/fsrv/store.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { FakeClock } from "../helpers/ws.ts";

const TENANT = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
const FID = "01HYYYYYYYYYYYYYYYYYYYYYYY";
const secrets = new SecretBox(new Map([[1, randomBytes(32)]]));

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rs-fsrv-unit-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Düz metni parça parça mühürleyip `.rsf`'e yazar, sonra çözer. */
async function roundTrip(plain: Buffer, fid = FID): Promise<{ path: string; out: () => Promise<Buffer> }> {
  const store = new FileStore(dir);
  const rel = store.newRel(TENANT);
  const salt = randomBytes(32);
  const header = makeHeader(1, plain.length, salt);
  const key = secrets.deriveFileKey(1, salt, TENANT, fid);
  await store.createPart(rel, header);
  for (let n = 0; n < fsrvChunkCount(plain.length); n++)
    await store.writePart(
      rel,
      chunkOffset(n),
      sealChunk(key, header, plain.length, n, plain.subarray(n * FSRV_CHUNK_BYTES, (n + 1) * FSRV_CHUNK_BYTES)),
    );
  await store.commit(rel);
  const path = store.abs(rel);
  const out = async (): Promise<Buffer> => {
    const fh = await open(path, "r");
    try {
      const parts: Buffer[] = [];
      for await (const p of openBox(fh, { keys: secrets, keyVer: 1, plainSize: plain.length, tenantId: TENANT, fid })) parts.push(p);
      return Buffer.concat(parts);
    } finally {
      await fh.close();
    }
  };
  return { path, out };
}

describe("AC-356 box.ts segmentli AES-256-GCM", () => {
  it.each([1, 65_535, 65_536, 65_537, 3 * FSRV_CHUNK_BYTES + 17])("AC-356 gidiş-dönüş %i bayt; dosya boyu tutarlı", async (size) => {
    const plain = randomBytes(size);
    const { path, out } = await roundTrip(plain);
    expect((await readFile(path)).length).toBe(boxSize(size));
    expect((await out()).equals(plain)).toBe(true);
  });

  it("AC-356 diskte düz metin yok (bilinen işaret dosyada geçmez)", async () => {
    const mark = Buffer.from("GIZLI-ICERIK-ISARETI-".repeat(100));
    const { path } = await roundTrip(mark);
    expect((await readFile(path)).includes(Buffer.from("GIZLI-ICERIK"))).toBe(false);
  });

  it("AC-356 segment değiştirme / kesme / yer değiştirme / başka fid → BoxError", async () => {
    const plain = randomBytes(200_000);
    const flip = await roundTrip(plain);
    const b = await readFile(flip.path);
    b[100] = (b[100] ?? 0) ^ 1;
    await writeFile(flip.path, b);
    await expect(flip.out()).rejects.toBeInstanceOf(BoxError);

    const cut = await roundTrip(plain);
    const c = await readFile(cut.path);
    await writeFile(cut.path, c.subarray(0, c.length - 10));
    await expect(cut.out()).rejects.toBeInstanceOf(BoxError);

    const swap = await roundTrip(plain);
    const s = await readFile(swap.path);
    const seg = 65_536 + 16;
    const a = Buffer.from(s.subarray(52, 52 + seg));
    s.copy(s, 52, 52 + seg, 52 + 2 * seg);
    a.copy(s, 52 + seg);
    await writeFile(swap.path, s);
    await expect(swap.out()).rejects.toBeInstanceOf(BoxError);

    const other = await roundTrip(plain, "01HXXXXXXXXXXXXXXXXXXXXXXX");
    const fh = await open(other.path, "r");
    const read = async (): Promise<void> => {
      for await (const chunk of openBox(fh, { keys: secrets, keyVer: 1, plainSize: plain.length, tenantId: TENANT, fid: FID })) void chunk;
    };
    await expect(read()).rejects.toBeInstanceOf(BoxError);
    await fh.close();
  });

  it("AC-356 başlık key_ver / boyut DB ile uyuşmazsa okunmaz (CORRUPT)", async () => {
    const plain = randomBytes(1000);
    const { path } = await roundTrip(plain);
    const fh = await open(path, "r");
    const read = async (keyVer: number, size: number): Promise<void> => {
      for await (const chunk of openBox(fh, { keys: secrets, keyVer, plainSize: size, tenantId: TENANT, fid: FID })) void chunk;
    };
    await expect(read(2, 1000)).rejects.toBeInstanceOf(BoxError);
    await expect(read(1, 999)).rejects.toBeInstanceOf(BoxError);
    await fh.close();
  });

  it("AC-356 store yolu: tenant öneki + rastgele 24 karakter; geçersiz yol reddedilir (T13)", () => {
    const store = new FileStore(dir);
    expect(store.newRel(TENANT)).toMatch(/^01HZZZZZZZZZZZZZZZZZZZZZZZ\/[A-Za-z0-9_-]{24}\.rsf$/);
    expect(() => store.abs("../etc/passwd")).toThrow();
    expect(() => store.abs(`${TENANT}/../../x.rsf`)).toThrow();
  });
});

describe("AC-359 clamd yanıt sınıflandırması (K0 dizeleri)", () => {
  it.each([
    ["stream: OK\0", { state: "CLEAN" }],
    ["stream: Eicar-Test-Signature FOUND\0", { state: "INFECTED", signature: "Eicar-Test-Signature" }],
    ["stream: Heuristics.Encrypted.Zip FOUND\0", { state: "SCAN_FAILED", reason: "ENCRYPTED" }],
    ["stream: Heuristics.Limits.Exceeded.MaxScanTime FOUND\0", { state: "SCAN_FAILED", reason: "TIMEOUT" }],
    ["stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND\0", { state: "SCAN_FAILED", reason: "LIMIT" }],
    ["INSTREAM size limit exceeded. ERROR\0", { state: "SCAN_FAILED", reason: "LIMIT" }],
    ["stream: kötü<imza> FOUND\0", { state: "INFECTED", signature: null }],
    ["Something ERROR\0", { state: "SCAN_FAILED", reason: "ERROR" }],
    ["", { state: "SCAN_FAILED", reason: "ERROR" }],
  ])("AC-359 %j", (raw, want) => {
    expect(classifyReply(raw)).toEqual(want);
  });

  it("AC-361 VERSION ayrıştırma (ctime, gün < 10 çift boşluk)", () => {
    const v = parseVersion("ClamAV 1.5.4/28177/Sun Nov  8 06:23:52 2026\0");
    expect(v?.version).toBe("ClamAV 1.5.4/28177/Sun Nov  8 06:23:52 2026");
    expect(v?.dbDate?.toISOString()).toBe("2026-11-08T06:23:52.000Z");
    expect(parseVersion("merhaba")).toBeNull();
  });
});

describe("AC-353 hedef CIDR kuralı (K-P28b-16, D-r2-5)", () => {
  const cidr = "172.30.2.0/28";
  it("AC-353 ağ/ağ geçidi/yayın, loopback, dış adres reddedilir; ::ffff: biçimi normalleşir; IPv6 literal reddedilir", () => {
    expect(inAllowedCidr("172.30.2.5", cidr)).toBe(true);
    expect(inAllowedCidr("::ffff:172.30.2.5", cidr)).toBe(true);
    expect(inAllowedCidr("172.30.2.0", cidr)).toBe(false);
    expect(inAllowedCidr("172.30.2.1", cidr)).toBe(false);
    expect(inAllowedCidr("172.30.2.15", cidr)).toBe(false);
    expect(inAllowedCidr("172.30.2.16", cidr)).toBe(false);
    expect(inAllowedCidr("127.0.0.1", cidr)).toBe(false);
    expect(inAllowedCidr("8.8.8.8", cidr)).toBe(false);
    expect(inAllowedCidr("fd00::5", cidr)).toBe(false);
    expect(inAllowedCidr("172.30.2.5", undefined)).toBe(false);
  });
  it("AC-353 çoklu A kaydından biri dışarıdaysa ret; çözülemezse ret", async () => {
    expect(await resolveAllowed("clamav", cidr, async () => ["172.30.2.3"])).toBe("172.30.2.3");
    expect(await resolveAllowed("clamav", cidr, async () => ["172.30.2.3", "10.0.0.5"])).toBeNull();
    expect(await resolveAllowed("clamav", cidr, async () => Promise.reject(new Error("x")))).toBeNull();
    expect(await resolveAllowed("clamav", cidr, async () => [])).toBeNull();
  });
  it("D-r2-5 IPv4-mapped IPv6 normalleşir; köşeli/düz IPv6 literal ve mapped dış adres reddedilir", async () => {
    expect(await resolveAllowed("::ffff:172.30.2.4", cidr)).toBe("172.30.2.4");
    expect(await resolveAllowed("[::ffff:172.30.2.4]", cidr)).toBe("172.30.2.4");
    expect(await resolveAllowed("clamav", cidr, async () => ["::ffff:172.30.2.6"])).toBe("172.30.2.6");
    expect(await resolveAllowed("[fd00::1]", cidr)).toBeNull();
    expect(await resolveAllowed("::1", cidr)).toBeNull();
    expect(await resolveAllowed("::ffff:127.0.0.1", cidr)).toBeNull();
    expect(await resolveAllowed("clamav", cidr, async () => ["172.30.2.4", "fd00::4"])).toBeNull();
  });
  it("D-r2-1 kaynak IP alt ağın herhangi bir adresi (ağ geçidi dahil) → ret kümesinde; dışı ve CIDR yoksa değil", () => {
    expect(inCidrRange("172.30.2.1", cidr)).toBe(true);
    expect(inCidrRange("::ffff:172.30.2.9", cidr)).toBe(true);
    expect(inCidrRange("172.30.2.16", cidr)).toBe(false);
    expect(inCidrRange("127.0.0.1", cidr)).toBe(false);
    expect(inCidrRange("172.30.2.5", undefined)).toBe(false);
    expect(inCidrRange(undefined, cidr)).toBe(false);
  });
});

// ---- sahte clamd ----
type Behaviour = (sock: Socket, cmd: string, body: Buffer) => void;
let server: Server | undefined;
let port = 0;
let behaviour: Behaviour = (s) => s.end("stream: OK\0");
let received = Buffer.alloc(0);
let refuseFirst = 0;

async function startFake(): Promise<void> {
  server = createServer((sock) => {
    if (refuseFirst > 0) {
      refuseFirst--;
      sock.destroy();
      return;
    }
    let buf = Buffer.alloc(0);
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const z = buf.indexOf(0);
      if (z < 0) return;
      const cmd = buf.subarray(1, z).toString();
      if (cmd === "PING") return void sock.end("PONG\0");
      if (cmd === "VERSION") return void sock.end("ClamAV 1.5.4/28177/Sun Nov  8 06:23:52 2026\0");
      // INSTREAM: uzunluk çerçevelerini topla; 0 gelince davranış
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
      received = Buffer.concat(body);
      behaviour(sock, cmd, received);
    });
    sock.on("error", () => undefined);
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const a = server.address();
  port = typeof a === "object" && a ? a.port : 0;
}

const client = (o: Partial<ConstructorParameters<typeof ClamdClient>[0]> = {}) =>
  new ClamdClient({ cidr: "172.30.2.0/28", dialHost: () => "127.0.0.1", retryIntervalMs: 20, retryTotalMs: 400, ...o });
const target = () => ({ host: "172.30.2.5", port });
async function* chunks(...b: Buffer[]): AsyncGenerator<Buffer> {
  for (const x of b) yield x;
}

describe("AC-357/359 clamd INSTREAM istemcisi (sahte TCP sunucu)", () => {
  beforeAll(startFake);
  afterAll(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
  afterEach(() => {
    behaviour = (s) => s.end("stream: OK\0");
    refuseFirst = 0;
  });

  it("AC-357 temiz dosya: veri eksiksiz iletilir (64 KiB çerçeve), CLEAN", async () => {
    const data = randomBytes(200_000);
    const v = await client().instream(target(), chunks(data), Date.now() + 5000);
    expect(v).toEqual({ state: "CLEAN" });
    expect(createHash("sha256").update(received).digest("hex")).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("AC-358 EICAR → INFECTED + imza", async () => {
    behaviour = (s, _c, body) => s.end(body.toString().includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
    expect(await client().instream(target(), chunks(Buffer.from(avEicar())), Date.now() + 5000)).toEqual({
      state: "INFECTED",
      signature: "Eicar-Test-Signature",
    });
  });

  it("AC-359 hedef CIDR dışı → UNAVAILABLE (bağlantı denenmez)", async () => {
    const v = await client().instream({ host: "10.9.9.9", port }, chunks(Buffer.from("x")), Date.now() + 5000);
    expect(v).toEqual({ state: "SCAN_FAILED", reason: "UNAVAILABLE" });
  });

  it("AC-359 bağlantı aşaması yeniden denemesi: ilk 2 bağlantı reddedilir → sonra başarılı", async () => {
    refuseFirst = 2;
    expect(await client().instream(target(), chunks(Buffer.from("abc")), Date.now() + 5000)).toEqual({ state: "CLEAN" });
  });

  it("AC-359 bağlantı aşaması toplam süre dolarsa UNAVAILABLE", async () => {
    refuseFirst = 1000;
    const v = await client({ retryTotalMs: 100 }).instream(target(), chunks(Buffer.from("abc")), Date.now() + 5000);
    expect(v).toEqual({ state: "SCAN_FAILED", reason: "UNAVAILABLE" });
  });

  it("AC-359 veri yazıldıktan sonra kopma (yanıt yok) → ERROR, yeniden deneme yok", async () => {
    behaviour = (s) => s.destroy();
    expect(await client().instream(target(), chunks(Buffer.from("abc")), Date.now() + 5000)).toEqual({
      state: "SCAN_FAILED",
      reason: "ERROR",
    });
  });

  it("AC-359 bütçe aşımı → TIMEOUT", async () => {
    behaviour = () => undefined; // yanıt yok
    expect(await client().instream(target(), chunks(Buffer.from("abc")), Date.now() + 200)).toEqual({
      state: "SCAN_FAILED",
      reason: "TIMEOUT",
    });
  });

  it("AC-359 akış sınırı: clamd yanıtı yazıp kapatır → biriktirilen yanıt LIMIT", async () => {
    behaviour = (s) => s.end("INSTREAM size limit exceeded. ERROR\0");
    expect(await client().instream(target(), chunks(Buffer.from("abc")), Date.now() + 5000)).toEqual({
      state: "SCAN_FAILED",
      reason: "LIMIT",
    });
  });

  it("AC-353/361 öz-sınama: EICAR + şifreli zip doğru → ok; şifreli zipe OK → misconfigured", async () => {
    const scanner = new Scanner({
      client: client(),
      queue: new ScanQueue(new FakeClock()),
      target: async () => target(),
      metrics: createMetrics(),
      log: { warn: () => undefined, error: () => undefined },
      now: Date.now,
    });
    behaviour = (s, _c, body) =>
      s.end(body.toString().includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: Heuristics.Encrypted.Zip FOUND\0");
    const ok = await scanner.selfTest(target());
    expect(ok).toMatchObject({ judgement: "ok", eicarDetected: true, encryptedDetected: true });
    expect(ok.dbDate?.toISOString()).toBe("2026-11-08T06:23:52.000Z");
    behaviour = (s, _c, body) => s.end(body.toString().includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
    let flagged = 0;
    const s2 = new Scanner({
      client: client(),
      queue: new ScanQueue(new FakeClock()),
      target: async () => target(),
      metrics: createMetrics(),
      log: { warn: () => undefined, error: () => undefined },
      now: Date.now,
      onMisconfigured: async () => void flagged++,
    });
    await s2.poll();
    expect(s2.misconfigured).toBe(true);
    expect(flagged).toBe(1);
    const failed = await s2.scan(TENANT, 3, () => chunks(Buffer.from("abc")));
    expect(failed.verdict).toEqual({ state: "SCAN_FAILED", reason: "ERROR" });
  });

  it("AC-361 erişilemezlik yalnız rs_av_up=0 (bayrak konmaz)", async () => {
    const s = new Scanner({
      client: client(),
      queue: new ScanQueue(new FakeClock()),
      target: async () => ({ host: "172.30.2.5", port: 1 }),
      metrics: createMetrics(),
      log: { warn: () => undefined, error: () => undefined },
      now: Date.now,
    });
    await s.poll();
    expect(s.up).toBe(0);
    expect(s.misconfigured).toBe(false);
  });

  it("AC-359 öz-sınama yargısı: zaman aşımı/ERROR kesin yanlış sayılmaz", () => {
    const eicar = { state: "INFECTED", signature: "Eicar-Test-Signature" } as const;
    expect(selfTestJudgement(eicar, { state: "SCAN_FAILED", reason: "TIMEOUT" })).toBe("unreachable");
    expect(selfTestJudgement({ state: "CLEAN" }, { state: "SCAN_FAILED", reason: "ENCRYPTED" })).toBe("misconfigured");
  });

  it.skipIf(!process.env.CLAMD_TEST_HOST)("AC-353 gerçek clamd (CLAMD_TEST_HOST): EICAR + şifreli zip", async () => {
    const real = new ClamdClient({ cidr: process.env.CLAMD_TEST_CIDR ?? "172.30.2.0/28" });
    const s = new Scanner({
      client: real,
      queue: new ScanQueue(new FakeClock()),
      target: async () => ({ host: process.env.CLAMD_TEST_HOST ?? "", port: Number(process.env.CLAMD_TEST_PORT ?? 3310) }),
      metrics: createMetrics(),
      log: { warn: () => undefined, error: () => undefined },
      now: Date.now,
    });
    const r = await s.selfTest({ host: process.env.CLAMD_TEST_HOST ?? "", port: Number(process.env.CLAMD_TEST_PORT ?? 3310) });
    expect(r.judgement).toBe("ok");
  });
});

describe("AC-357 adil tarama kuyruğu (O-P28b-3, D-r2-3; sahte saat)", () => {
  const MB = 1024 * 1024;
  it("AC-357 firma başına 1 etkin; boşalan yuva firmalar arasında round-robin", async () => {
    const q = new ScanQueue(new FakeClock());
    const a1 = (await q.acquire("A", MB)) as Release;
    const a2p = q.acquire("A", MB);
    const a3p = q.acquire("A", MB);
    const b1 = (await q.acquire("B", MB)) as Release; // ikinci yuva B'ye (A zaten etkin)
    const c1p = q.acquire("C", MB);
    expect(q.depth).toBe(3);
    a1(); // A bitti → sıradaki: C (A bekliyor ama round-robin)
    const order: string[] = [];
    void a2p.then(() => order.push("A2"));
    void c1p.then(() => order.push("C1"));
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["C1"]);
    b1();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["C1", "A2"]);
    void a3p;
  });

  it("AC-357 firma başına 3 bekleyen, toplam 20 → fazlası hemen BUSY", async () => {
    const q = new ScanQueue(new FakeClock(), { queueMax: 4 });
    await q.acquire("A", MB);
    await q.acquire("B", MB);
    const waits = [q.acquire("A", MB), q.acquire("A", MB), q.acquire("A", MB)];
    expect(await q.acquire("A", MB)).toBe("BUSY");
    const d = q.acquire("D", MB);
    expect(await q.acquire("E", MB)).toBe("BUSY");
    void waits;
    void d;
  });

  it("AC-357 aynı anda en çok bir büyük tarama; küçük dosya bekleme 30 sn → BUSY", async () => {
    const clock = new FakeClock();
    const q = new ScanQueue(clock);
    const big = (await q.acquire("A", 100 * MB)) as Release;
    const big2 = q.acquire("B", 100 * MB);
    const small = await q.acquire("C", MB); // ikinci yuva küçüğe açık
    expect(typeof small).toBe("function");
    clock.advance(31_000);
    let res: unknown = "pending";
    void big2.then((r) => (res = r));
    await Promise.resolve();
    expect(res).toBe("pending"); // D-r2-3: büyük dosya 30 sn'de BUSY olmaz
    big();
    await Promise.resolve();
    await Promise.resolve();
    expect(typeof res).toBe("function");
  });

  it("D-r2-3 büyük dosya kuyruğu 75 sn sonra BUSY; küçük 30 sn", async () => {
    const clock = new FakeClock();
    const q = new ScanQueue(clock);
    await q.acquire("A", 100 * MB);
    await q.acquire("Z", MB);
    const big2 = q.acquire("B", 100 * MB);
    const small = q.acquire("C", MB);
    clock.advance(30_001);
    expect(await small).toBe("BUSY");
    clock.advance(45_000);
    expect(await big2).toBe("BUSY");
  });
});
