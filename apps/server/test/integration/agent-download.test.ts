// P6 indirme ucu (mimari-api "Public müşteri uçları" download satırı — bağlayıcı; mimari §10.3 P6 DoD testi):
// PENDING → 302, CANCELLED/EXPIRED/ACTIVE → 410, geçersiz ref → 404, 11. başarısız deneme/dk → 429.
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.ts";
import { sessionRef } from "../../src/sessions/codes.ts";
import { ORIGIN, createSupportSessionRow, createTenant, createUser, makeApp, testDb } from "../helpers/app.ts";

const REF_KEY = "r".repeat(40);
const EXE = Buffer.from("MZ test ikilisi — NoktaDestek");
const EXE_SHA = createHash("sha256").update(EXE).digest("hex");

let dir: string;
let exePath: string;
let app: FastifyInstance;
const agentEnv = () => ({ SESSION_REF_KEY: REF_KEY, AGENT_BINARY_PATH: exePath, AGENT_SHA256: EXE_SHA });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rs-agent-int-"));
  exePath = join(dir, "NoktaDestek.exe");
  await writeFile(exePath, EXE);
  app = makeApp({ env: agentEnv() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

type St = "PENDING" | "ACTIVE" | "ENDED" | "EXPIRED" | "CANCELLED";
async function session(status: St = "PENDING", createdAt?: Date) {
  const t = await createTenant();
  const tech = await createUser({ tenantId: t.id, role: "ADMIN" });
  const row = await createSupportSessionRow({ tenantId: t.id, technicianId: tech.id, status, ...(createdAt ? { createdAt } : {}) });
  return { ...row, ref: sessionRef(REF_KEY, row.id) };
}
const past = () => new Date(Date.now() - 16 * 60_000);
const download = (ref: string | null, ip: string, a: FastifyInstance = app) =>
  a.inject({ method: "GET", url: `/api/v1/public/agent/download${ref === null ? "" : `?ref=${encodeURIComponent(ref)}`}`, remoteAddress: ip });
const errCode = (r: LightMyRequestResponse) => r.json<{ error: { code: string } }>().error.code;
/** HMAC'i geçerli biçimde ama yanlış (başka anahtar) → 404. */
const forgedRef = (id: string) => sessionRef("x".repeat(40), id);

describe("GET /public/agent/download", () => {
  it("AC-27: PENDING + süresi dolmamış → 302 /downloads/Destek-<kod>.exe, no-store, çerez yok, Origin gerekmez", async () => {
    const s = await session();
    const res = await download(s.ref, "192.0.2.100");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/downloads/Destek-${s.code}.exe`);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["set-cookie"]).toBeUndefined();
    // Tekrar indirilebilir (tüketmez) ve oturum PENDING kalır.
    expect((await download(s.ref, "192.0.2.100")).statusCode).toBe(302);
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PENDING");
  });

  it("AC-27, AC-5, AC-7, AC-8: CANCELLED/EXPIRED/ACTIVE/ENDED → 410 (sebep kodlu), no-store; süresi dolmuş PENDING aynı istekte EXPIRED olur", async () => {
    const cases: { st: St; createdAt?: Date; code: string }[] = [
      { st: "CANCELLED", code: "SESSION_CANCELLED" },
      { st: "EXPIRED", code: "SESSION_EXPIRED" },
      { st: "ACTIVE", code: "SESSION_CONSUMED" },
      { st: "ENDED", code: "SESSION_CONSUMED" },
      { st: "PENDING", createdAt: past(), code: "SESSION_EXPIRED" },
    ];
    for (const [i, c] of cases.entries()) {
      const s = await session(c.st, c.createdAt);
      const res = await download(s.ref, `192.0.2.${110 + i}`);
      expect(res.statusCode).toBe(410);
      expect(errCode(res)).toBe(c.code);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers.location).toBeUndefined();
    }
    const expired = await session("PENDING", past());
    await download(expired.ref, "192.0.2.120");
    const row = await testDb().supportSession.findUniqueOrThrow({ where: { id: expired.id } });
    expect(row).toMatchObject({ status: "EXPIRED", activeCode: null });
  });

  it("AC-27: geçersiz ref → 404 (yanlış HMAC, biçimsiz, eksik, bilinmeyen oturum); no-store", async () => {
    const s = await session();
    const unknown = sessionRef(REF_KEY, "01JZZZZZZZZZZZZZZZZZZZZZZZ");
    for (const [i, ref] of [forgedRef(s.id), "kisa", "", null, unknown, `${s.ref}x`].entries()) {
      const res = await download(ref, `192.0.2.${130 + i}`);
      expect(res.statusCode).toBe(404);
      expect(errCode(res)).toBe("NOT_FOUND");
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("AC-27, G-02: 11. başarısız deneme/dk → 429 (+Retry-After ≈15 dk); kilit geçerli ref'i de keser; başka IP etkilenmez", async () => {
    const ip = "198.51.100.40";
    for (let i = 0; i < 10; i++) expect((await download(forgedRef("01JAAAAAAAAAAAAAAAAAAAAAAA"), ip)).statusCode).toBe(404);
    const blocked = await download("gecersiz", ip);
    expect(blocked.statusCode).toBe(429);
    expect(errCode(blocked)).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(14 * 60);
    const s = await session();
    expect((await download(s.ref, ip)).statusCode).toBe(429);
    expect((await download(s.ref, "203.0.113.40")).statusCode).toBe(302);
  });

  it("AC-27, G-02: 410 yanıtları da başarısız sayılır; kod yolu (resolve) ile AYNI kovalar", async () => {
    const ip = "198.51.100.41";
    const gone = await session("CANCELLED");
    for (let i = 0; i < 10; i++) expect((await download(gone.ref, ip)).statusCode).toBe(410);
    // İndirme ucunda biriken 10 başarısızlık resolve kod yolunun da kovası: 11. başarısız kod denemesi 429.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/public/sessions/resolve",
      headers: { origin: ORIGIN },
      payload: { clientKind: "BROWSER", code: "00000000" },
      remoteAddress: ip,
    });
    expect(res.statusCode).toBe(429);
  });

  it("AC-27, G-02: önek kovası (/24) 30/dk — farklı IP'lerden 31. başarısızlık 429; sayaç global metriğe yazılır", async () => {
    const before = app.publicLimits.resolveFailed.total;
    let status = 0;
    let n = 0;
    for (let host = 1; host <= 4 && status !== 429; host++) {
      for (let k = 0; k < 8 && status !== 429; k++) {
        status = (await download("yok", `198.51.101.${host}`)).statusCode;
        n++;
      }
    }
    expect(status).toBe(429);
    expect(n).toBe(31);
    expect(app.publicLimits.resolveFailed.total - before).toBe(31);
  });

  it("AC-27: tüm istekler ipKey 20/dk — 21. geçerli istek 429 (+Retry-After)", async () => {
    const ip = "198.51.100.42";
    const s = await session();
    for (let i = 0; i < 20; i++) expect((await download(s.ref, ip)).statusCode).toBe(302);
    const res = await download(s.ref, ip);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("AC-96, G-07: ikili hash'i AGENT_SHA256 ile uyuşmaz veya yapılandırma yoksa 503 NOT_READY; geçersiz ref yine 404", async () => {
    const s = await session();
    for (const env of [{ ...agentEnv(), AGENT_SHA256: "0".repeat(64) }, { SESSION_REF_KEY: REF_KEY }, { ...agentEnv(), AGENT_BINARY_PATH: join(dir, "yok.exe") }]) {
      const a = makeApp({ env });
      await a.ready();
      try {
        const res = await download(s.ref, "192.0.2.150", a);
        expect(res.statusCode).toBe(503);
        expect(errCode(res)).toBe("NOT_READY");
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.headers.location).toBeUndefined();
        expect((await download("gecersiz", "192.0.2.151", a)).statusCode).toBe(404);
      } finally {
        await a.close();
      }
    }
  });

  it("AC-90, G-10: ref ve kod loglara ve audit kayıtlarına yazılmaz", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const a = makeApp({ env: agentEnv(), logger: createLogger("trace", sink) });
    await a.ready();
    const ok = await session();
    const expired = await session("PENDING", past());
    try {
      expect((await download(ok.ref, "192.0.2.160", a)).statusCode).toBe(302);
      expect((await download(expired.ref, "192.0.2.160", a)).statusCode).toBe(410);
      expect((await download(forgedRef(ok.id), "192.0.2.160", a)).statusCode).toBe(404);
    } finally {
      await a.close();
    }
    const all = lines.join("\n");
    expect(all).toContain("/api/v1/public/agent/download");
    for (const secret of [ok.ref, expired.ref, forgedRef(ok.id), ok.code ?? "", expired.code ?? ""]) {
      expect(secret.length).toBeGreaterThan(0);
      expect(all).not.toContain(secret);
    }
    const audits = await testDb().auditLog.findMany({ where: { entityId: { in: [ok.id, expired.id] } } });
    expect(audits.map((x) => x.action)).toEqual(["session.expired"]);
    const dump = JSON.stringify(audits, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    for (const secret of [ok.ref, expired.ref, ok.code ?? "", expired.code ?? ""]) expect(dump).not.toContain(secret);
  });
});

describe("GET /internal/agent-ready (S6-2: Caddy forward_auth bütünlük kapısı)", () => {
  const PROXY = "172.30.0.2";
  const ready = (a: FastifyInstance, o: { ip?: string; fwd?: boolean; ref?: string } = {}) =>
    a.inject({
      method: "GET",
      url: `/internal/agent-ready${o.ref ? `?ref=${o.ref}` : ""}`,
      remoteAddress: o.ip ?? PROXY,
      headers: o.fwd === false ? {} : { "x-forwarded-method": "GET", "x-forwarded-for": "203.0.113.9" },
    });
  const withProxy = (env: Record<string, string>) => makeApp({ env: { ...env, TRUSTED_PROXY_CIDR: "172.30.0.2/31" } });

  it("AC-96, G-07: ikili hazır (hash eşleşir) → 204 no-store, gövdesiz", async () => {
    const a = withProxy(agentEnv());
    await a.ready();
    try {
      const res = await ready(a);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe("");
      expect(res.headers["cache-control"]).toBe("no-store");
    } finally {
      await a.close();
    }
  });

  it("AC-96, G-07: uyuşmazlık / dosya yok / yapılandırma yok → 503 NOT_READY (Caddy bunu istemciye döner)", async () => {
    for (const env of [{ ...agentEnv(), AGENT_SHA256: "0".repeat(64) }, { ...agentEnv(), AGENT_BINARY_PATH: join(dir, "yok.exe") }, { SESSION_REF_KEY: REF_KEY }]) {
      const a = withProxy(env);
      await a.ready();
      try {
        const res = await ready(a);
        expect(res.statusCode).toBe(503);
        expect(errCode(res)).toBe("NOT_READY");
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body).not.toContain(dir); // yol/hash sızmaz
        expect(res.body).not.toContain(EXE_SHA);
      } finally {
        await a.close();
      }
    }
  });

  it("AC-96, G-07: dosya yayından sonra değişirse (tahrif) yeniden başlatmadan 503'e döner", async () => {
    const path = join(dir, "degisen.exe");
    await writeFile(path, EXE);
    const a = withProxy({ ...agentEnv(), AGENT_BINARY_PATH: path });
    await a.ready();
    try {
      expect((await ready(a)).statusCode).toBe(204);
      await writeFile(path, Buffer.concat([EXE, Buffer.from("tahrif")]));
      expect((await ready(a)).statusCode).toBe(503);
    } finally {
      await a.close();
    }
  });

  it("S6-2: dışarıdan erişilemez — güvenilen proxy dışı soket, forward_auth başlığı yok veya CIDR tanımsızken loopback dışı → 404", async () => {
    const a = withProxy(agentEnv());
    await a.ready();
    try {
      for (const res of [await ready(a, { ip: "203.0.113.9" }), await ready(a, { ip: "172.30.0.129" }), await ready(a, { fwd: false }), await ready(a, { ip: "127.0.0.1" })]) {
        expect(res.statusCode).toBe(404);
        expect(errCode(res)).toBe("NOT_FOUND");
      }
      // XFF ile proxy taklidi işe yaramaz: soket adresi esas alınır.
      const spoof = await a.inject({ method: "GET", url: "/internal/agent-ready", remoteAddress: "203.0.113.9", headers: { "x-forwarded-method": "GET", "x-forwarded-for": PROXY } });
      expect(spoof.statusCode).toBe(404);
    } finally {
      await a.close();
    }
    // CIDR tanımsız (geliştirme): yalnız loopback
    expect((await ready(app, { ip: "127.0.0.1" })).statusCode).toBe(204);
    expect((await ready(app, { ip: "192.0.2.1" })).statusCode).toBe(404);
  });

  it("AC-90, G-10: forward_auth isteğinin sorgu dizesi loga yazılmaz", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const a = makeApp({ env: { ...agentEnv(), TRUSTED_PROXY_CIDR: "172.30.0.2/31" }, logger: createLogger("trace", sink) });
    await a.ready();
    try {
      expect((await ready(a, { ref: "GIZLIREF1234" })).statusCode).toBe(204);
    } finally {
      await a.close();
    }
    const all = lines.join("\n");
    expect(all).toContain("/internal/agent-ready");
    expect(all).not.toContain("GIZLIREF1234");
  });
});
