// P8b-1 düzeltme turu 1 — eksik AC testleri (QA-P8b-2/7/8). Gerçek MySQL + dinleyen sunucu.
// AC-156: talep kaynaklı oturumda P7 kontrol izni akışı (AC-99..104, 107, 115) regresyonu.
// AC-130: iki tenant'ın firma dosyası aynı jenerik ikiliye çözülür (aynı SHA-256 = SHA256SUMS değeri).
// AC-146: Talepler liste ucu 1.000 kayıtta < 500 ms (§10.3 bitti kanıtı).
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import { CONTROL_DENY_COOLDOWN_MS } from "@remote/contracts/ws";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { newId, newRequestCode, newSecretToken, sha256Hex } from "../../src/lib/ids.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb, type Session } from "../helpers/app.ts";
import { createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { connect, FakeClock, techHeaders } from "../helpers/ws.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const PERF_LIMIT_MS = 500;
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

async function login(
  app: Live["app"],
  tenantId: string,
  o: { role?: "ADMIN" | "USER"; perms?: Record<string, boolean> } = {},
): Promise<{ id: string; s: Session }> {
  const user = await createUser({ tenantId, role: o.role ?? "USER", ...(o.perms ? { perms: o.perms } : {}) });
  return { id: user.id, s: await loginAs(app, user) };
}

describe("AC-156 talep oturumunda P7 kontrol akışı (regresyon)", () => {
  const controlConsents = (sessionId: string) =>
    testDb().sessionConsent.findMany({ where: { sessionId, level: "CONTROL" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const audits = (sessionId: string, action: string) => testDb().auditLog.findMany({ where: { entityId: sessionId, action } });

  /** API talebi → kabul → teknisyen + ön-kabullü AGENT misafir (ACTIVE oda). */
  async function requestRoom(clock: FakeClock) {
    live = await startLive({ env: PROXY, signaling: { clock, revalidateMs: 150 } });
    const rc = requestClient(live.app, live.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const c = (await rc.createReq(ref, "198.51.130.5")).json<{ requestId: string; requestSecret: string }>();
    const reqWs = await rc.reqWs(c.requestSecret);
    await waitMsg(reqWs, "request.state");
    const x = await login(live.app, t.id, { perms: REQ_PERMS });
    const acc = await rc.accept(x.s.headers, c.requestId);
    expect(acc.statusCode).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    const { wsTicket } = await waitMsg<{ wsTicket: string }>(reqWs, "request.accepted");
    const tech = await connect(`${live.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(x.s.token, ORIGIN));
    await tech.waitFor("hello");
    const guest = await rc.guestWs(wsTicket);
    const hello = await guest.waitFor("hello");
    await tech.waitFor("peer.joined");
    return { tenantId: t.id, techId: x.id, requestId: c.requestId, sessionId, tech, guest, hello, reqWs };
  }

  it("AC-156: ilk seviye VIEW; istenmemiş GRANTED kaydedilmez; control.request → ret DENIED + 30 sn bekleme → yeni istek → GRANTED (yalnız source=UI) → HOTKEY ile REVOKED", async () => {
    const clock = new FakeClock();
    const r = await requestRoom(clock);
    expect(r.hello).toMatchObject({ role: "guest", guestKind: "AGENT", sessionId: r.sessionId });
    expect([...(r.hello.caps ?? [])].sort()).toEqual(["file_transfer", "remote_control"]);
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: r.sessionId } })).requestId).toBe(r.requestId);

    // İlk seviye yalnız görüntüleme: istek olmadan gelen GRANTED geri alınır, kayıt yok (QA-P7-4)
    r.guest.send({ t: "control.state", state: "GRANTED", source: "UI" });
    expect(await r.guest.waitFor("control.revoke")).toEqual({ t: "control.revoke", reason: "stale" });
    expect(await controlConsents(r.sessionId)).toHaveLength(0);

    // İstek → müşteri reddi
    r.tech.send({ t: "control.request" });
    expect(await r.guest.waitFor("control.request")).toEqual({ t: "control.request" });
    r.guest.send({ t: "control.state", state: "VIEW", source: "DENIED" });
    expect(await r.tech.waitFor("control.state")).toEqual({ t: "control.state", state: "VIEW", source: "DENIED" });
    await expect.poll(async () => (await controlConsents(r.sessionId)).map((c) => [c.decision, c.source])).toEqual([["DENIED", "UI"]]);

    // 30 sn bekleme (AC-116 / G-03)
    r.tech.send({ t: "control.request" });
    expect(await r.tech.waitFor("error")).toMatchObject({ code: "RATE_LIMITED" });
    clock.advance(CONTROL_DENY_COOLDOWN_MS);

    // İzin → GRANTED yalnız UI kaynağı ile
    r.tech.send({ t: "control.request" });
    await r.guest.waitFor("control.request");
    r.guest.send({ t: "control.state", state: "GRANTED", source: "UI" });
    expect(await r.tech.waitFor("control.state")).toEqual({ t: "control.state", state: "GRANTED", source: "UI" });
    r.guest.send({ t: "control.state", state: "VIEW", source: "HOTKEY" });
    expect(await r.tech.waitFor("control.state")).toEqual({ t: "control.state", state: "VIEW", source: "HOTKEY" });
    await expect
      .poll(async () => (await controlConsents(r.sessionId)).map((c) => [c.decision, c.source]))
      .toEqual([
        ["DENIED", "UI"],
        ["GRANTED", "UI"],
        ["REVOKED", "HOTKEY"],
      ]);
    const granted = (await controlConsents(r.sessionId))[1];
    expect(granted?.ip).toBe("127.0.0.1"); // istemci bağlantısının IP'si (müşteri onayı)
    expect(await audits(r.sessionId, CONTROL_AUDIT.REQUESTED)).toHaveLength(2);
    expect(await audits(r.sessionId, CONTROL_AUDIT.GRANTED)).toHaveLength(1);

    // GRANTED başka kaynakla gelemez (şema): HOTKEY ile GRANTED → 1008
    r.guest.send({ t: "control.state", state: "GRANTED", source: "HOTKEY" });
    expect((await r.guest.closed).code).toBe(1008);
  });

  it("AC-156 / AC-115 / AC-107: talep oturumunda kontrol açıkken remote_control.use kaldırılınca revoke{permission} + caps.update; oturum bitince istemci session.ended alır ve soket kapanır", async () => {
    const clock = new FakeClock();
    const r = await requestRoom(clock);
    r.tech.send({ t: "control.request" });
    await r.guest.waitFor("control.request");
    r.guest.send({ t: "control.state", state: "GRANTED", source: "UI" });
    expect(await r.tech.waitFor("control.state")).toMatchObject({ state: "GRANTED" });

    await testDb().userPermission.update({
      where: { userId_permKey: { userId: r.techId, permKey: "remote_control.use" } },
      data: { granted: false },
    });
    expect(await r.guest.waitFor("control.revoke")).toEqual({ t: "control.revoke", reason: "permission" });
    expect(await r.guest.waitFor("caps.update")).toEqual({ t: "caps.update", caps: ["file_transfer"] });
    expect(await r.tech.waitFor("control.state")).toMatchObject({ state: "VIEW", source: "SYSTEM" });
    r.tech.send({ t: "control.request" });
    expect(await r.tech.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });

    const t0 = Date.now();
    r.tech.send({ t: "session.end" });
    expect((await r.guest.waitFor("session.ended", 3000)).reason).toBe("tech");
    await r.guest.closed;
    expect(Date.now() - t0).toBeLessThan(3000);
    await expect.poll(async () => (await testDb().supportSession.findUniqueOrThrow({ where: { id: r.sessionId } })).status).toBe("ENDED");
  });
});

describe("AC-130 iki tenant aynı ikili", () => {
  const EXE = Buffer.from("MZ test ikilisi — NoktaDestek P8b-6 (aynı ikili)");
  let dir: string;
  let exePath: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rs-p8b6-"));
    exePath = join(dir, "NoktaDestek.exe");
    await writeFile(exePath, EXE);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** deploy/Caddyfile: firma yolu eşleştiricisi + `agent_exe_file` parçasının root/rewrite hedefi (Caddy'nin sunacağı dosya). */
  async function caddyFirmRoute(): Promise<{ matcher: RegExp; root: string; rewrite: string }> {
    const caddy = await readFile(fileURLToPath(new URL("../../../../deploy/Caddyfile", import.meta.url)), "utf8");
    const m = /@agentExeFirm path_regexp agentExeFirm (\S+)/.exec(caddy);
    const snippet = /\(agent_exe_file\) \{([\s\S]*?)\n\}/.exec(caddy)?.[1] ?? "";
    const root = /root \* (\S+)/.exec(snippet)?.[1];
    const rewrite = /rewrite \* (\S+)/.exec(snippet)?.[1];
    if (!m?.[1] || !root || !rewrite) throw new Error("Caddyfile firma yolu bulunamadı");
    return { matcher: new RegExp(m[1]), root, rewrite };
  }

  it("AC-130: farklı adlı iki tenant'ın indirmesi farklı dosya adına (ASCII, ≤ 20) ama aynı ikiliye çözülür; SHA-256 = SHA256SUMS değeri, tenant kimliği gömülmez", async () => {
    const sha = createHash("sha256").update(EXE).digest("hex");
    live = await startLive({ env: { ...PROXY, SESSION_REF_KEY: "r".repeat(40), AGENT_BINARY_PATH: exePath, AGENT_SHA256: sha } });
    const caddy = await caddyFirmRoute();
    expect(caddy.rewrite).toBe("/NoktaDestek.exe"); // tek jenerik dosya; ad yalnız Content-Disposition'da

    const names = ["Çağrı Özel Bilişim Ticaret A.Ş.", "Güneş İnşaat Ltd"];
    const locations: string[] = [];
    for (const name of names) {
      const t = await createTenant();
      await testDb().tenant.update({ where: { id: t.id }, data: { name } });
      const admin = await login(live.app, t.id, { role: "ADMIN" });
      const st = (await live.app.inject({ method: "GET", url: "/api/v1/settings/support-requests", headers: admin.s.headers })).json<{
        downloadUrl: string;
        fileName: string;
      }>();
      const dl = await live.app.inject({
        method: "GET",
        url: new URL(st.downloadUrl).pathname + new URL(st.downloadUrl).search,
        headers: { "x-forwarded-for": "198.51.140.1" },
      });
      expect(dl.statusCode).toBe(302);
      const loc = String(dl.headers.location);
      expect(loc).toBe(`/downloads/${st.fileName}`);
      const gate = await live.app.inject({
        method: "GET",
        url: "/internal/agent-ready",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-method": "GET", "x-forwarded-uri": loc },
      });
      expect(gate.statusCode).toBe(204);
      expect(caddy.matcher.test(loc)).toBe(true);
      locations.push(loc);
    }
    expect(locations[0]).toMatch(/^\/downloads\/NoktaDestek-CagriOzelBilisimTica-[a-z2-7]{16}\.exe$/);
    expect(locations[1]).toMatch(/^\/downloads\/NoktaDestek-GunesInsaatLtd-[a-z2-7]{16}\.exe$/);
    expect(new Set(locations).size).toBe(2);

    // Caddy her iki yolu da aynı volume dosyasına yazar (root + rewrite); testte volume = geçici dizin.
    const served = locations.map(() => join(dir, caddy.rewrite));
    expect(new Set(served).size).toBe(1);
    const hashes = await Promise.all(
      served.map(async (p) =>
        createHash("sha256")
          .update(await readFile(p))
          .digest("hex"),
      ),
    );
    expect(hashes).toEqual([sha, sha]);
  });
});

describe("AC-146 liste performansı", () => {
  it("AC-146: 1.000 talep kaydında (40 bekleyen + 960 geçmiş + gürültü tenant'ı) liste ucu < 500 ms", async () => {
    live = await startLive({ env: PROXY });
    const t = await createTenant();
    const noise = await createTenant();
    const db = testDb();
    const rows = async (tenantId: string, n: number, pending: number, rejector: string) => {
      const consent = await db.consentText.findFirstOrThrow({ where: { tenantId, isCurrent: true }, select: { id: true, sha256: true } });
      const now = Date.now();
      const codes = new Set<string>();
      const data = Array.from({ length: n }, (_, i) => {
        const createdAt = new Date(now - (i + 1) * 60_000);
        const isPending = i < pending;
        let code = newRequestCode();
        if (isPending) {
          while (codes.has(code)) code = newRequestCode();
          codes.add(code);
        }
        const ip = `198.51.${150 + (i % 50)}.${(i % 200) + 1}`;
        return {
          id: newId(),
          tenantId,
          status: isPending ? "PENDING" : i % 3 === 0 ? "REJECTED" : "EXPIRED",
          requestCode: code,
          secretHash: sha256Hex(newSecretToken()),
          clientInstance: newSecretToken().slice(0, 22),
          clientVersion: "0.9.0",
          customerName: `Müşteri Şükrü ${i}`,
          customerPhone: "+905321234567",
          customerEmail: i % 2 ? `m${i}@example.test` : null,
          description: `Yazıcı çalışmıyor lütfen yardım ${i}`,
          consentTextId: consent.id,
          consentSha256: consent.sha256,
          consentedAt: createdAt,
          ip,
          ipKey: ip,
          netKey: `${ip.split(".").slice(0, 3).join(".")}.0/24`,
          expiresAt: new Date(createdAt.getTime() + 120 * 60_000),
          closedAt: isPending ? null : new Date(createdAt.getTime() + 30 * 60_000),
          ...(!isPending && i % 3 === 0 ? { rejectMessage: "Şu an müsait değiliz", rejectedBy: rejector } : {}),
          createdAt,
        };
      });
      for (let i = 0; i < data.length; i += 500) await db.supportRequest.createMany({ data: data.slice(i, i + 500) });
    };
    const admin = await login(live.app, t.id, { role: "ADMIN" });
    await rows(t.id, 1000, 40, admin.id);
    await rows(noise.id, 1000, 0, (await createUser({ tenantId: noise.id, role: "ADMIN" })).id);
    expect(await db.supportRequest.count({ where: { tenantId: t.id } })).toBe(1000);

    const measure = async (url: string) => {
      await live?.app.inject({ method: "GET", url, headers: admin.s.headers }); // ısınma
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const r = await live?.app.inject({ method: "GET", url, headers: admin.s.headers });
        times.push(performance.now() - t0);
        expect(r?.statusCode).toBe(200);
      }
      return times.sort((a, b) => a - b)[2] ?? Infinity; // medyan
    };
    const pending = await measure("/api/v1/support-requests?tab=pending");
    const history = await measure("/api/v1/support-requests?tab=history&pageSize=100");
    const historyLast = await measure("/api/v1/support-requests?tab=history&pageSize=100&page=10");
    const list = (
      await live.app.inject({ method: "GET", url: "/api/v1/support-requests?tab=history&pageSize=100", headers: admin.s.headers })
    ).json<{ total: number; items: unknown[] }>();
    expect(list.total).toBe(960);
    expect(list.items).toHaveLength(100);
    expect({ pending, history, historyLast }).toSatisfy((m: Record<string, number>) => Object.values(m).every((v) => v < PERF_LIMIT_MS));
  }, 60_000);
});
