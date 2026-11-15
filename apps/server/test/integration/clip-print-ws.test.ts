// P28a K2 uçtan uca (gerçek WS + MySQL): kapı, özellik bildirimi, eski istemci geri uyumu, kontrol kapanınca iptal,
// audit + log/metrik içerik taraması (mimari-p28 §4, §9; r2 Y-P28a-1, O-P28a-1; AC-343, 344, 347, 348, 351, 352).
import { Writable } from "node:stream";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, ORIGIN, testDb } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders, type WsClient } from "../helpers/ws.ts";

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

const PERMS = {
  "sessions.create": true,
  "sessions.view": true,
  "remote_control.use": true,
  "remote_control.clipboard": true,
  "file_transfer.use": true,
  "file_transfer.print": true,
};
const CAPS = ["rs.cap.clip1", "rs.cap.print1"];
const ID = (n: number) => `p28a-k2-${String(n).padStart(4, "0")}`;

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

async function techAndAgent(l: Live, caps: string[], perms: Record<string, boolean> = PERMS) {
  const tenant = await createTenant();
  const user = await createUser({ tenantId: tenant.id, role: "USER", perms });
  const s = await loginAs(l.app, user);
  const created = (await l.app.inject({ method: "POST", url: "/api/v1/sessions", headers: s.headers, payload: {} })).json<{
    id: string;
    link: string;
  }>();
  const tech = await connect(`${l.base}/ws/tech?sessionId=${created.id}`, ["rs.v1"], techHeaders(s.token, ORIGIN));
  await tech.waitFor("hello");
  const headers = { "x-forwarded-for": "203.0.113.41" };
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
  return { sessionId: created.id, tech, guest, hello, joined };
}

async function grant(tech: WsClient, guest: WsClient): Promise<void> {
  tech.send({ t: "control.request" });
  await guest.waitFor("control.request");
  guest.send({ t: "control.state", state: "GRANTED", source: "UI" });
  await tech.waitFor("control.state");
}

const audits = (sessionId: string, action: string) =>
  testDb().auditLog.findMany({ where: { entityId: sessionId, action }, orderBy: { createdAt: "asc" } });

describe("P28a K2 — özellik bildirimi ve geri uyum", () => {
  it("AC-352: eski istemci (rs.cap yok) hello.caps yalnız iki değer; teknisyene guestFeatures yok; clip.consent → 1008", async () => {
    live = await startLive();
    const x = await techAndAgent(live, []);
    expect(x.hello).toMatchObject({ caps: ["remote_control", "file_transfer"] });
    expect(x.joined).not.toHaveProperty("guestFeatures");
    x.tech.send({ t: "print.request", pid: ID(1), sizeBytes: 100 });
    expect(await x.tech.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    x.guest.send({ t: "clip.consent", on: true });
    expect((await x.guest.closed).code).toBe(1008);
  });

  it("AC-352: yeni istemci caps + guestFeatures alır", async () => {
    live = await startLive();
    const x = await techAndAgent(live, CAPS);
    expect(x.hello).toMatchObject({ caps: ["remote_control", "file_transfer", "clipboard", "print"] });
    expect(x.joined).toMatchObject({ guestFeatures: ["clipboard", "print"] });
  });
});

describe("P28a K2 — kapı ve yaşam döngüsü", () => {
  it("AC-348/AC-343: VIEW iken print.request ve clip.push 403 (FORBIDDEN), misafire print/clip mesajı 0", async () => {
    live = await startLive();
    const x = await techAndAgent(live, CAPS);
    x.tech.send({ t: "print.request", pid: ID(1), sizeBytes: 100 });
    expect(await x.tech.waitFor("error")).toMatchObject({ code: "FORBIDDEN", message: "Önce uzaktan kontrol izni alın." });
    x.tech.send({ t: "clip.push", cid: ID(2), bytes: 5 });
    expect(await x.tech.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    x.guest.send({ t: "clip.consent", on: true }); // VIEW'da açma kabul edilmez
    expect(await x.guest.waitFor("clip.consent")).toEqual({ t: "clip.consent", on: false });
    expect(x.guest.msgs.filter((m) => m.t.startsWith("print.") || m.t === "clip.push")).toHaveLength(0);
  });

  it("AC-344/347/348/351 (Y-P28a-1, O-P28a-1): GRANTED akış, yeniden kullanılan kimlik VALIDATION, VIEW'a dönüşte iptal + audit; içerik log/audit/metrikte yok", async () => {
    const logs = captureLogs();
    live = await startLive({ logger: logs.logger, env: { METRICS_TOKEN: "m".repeat(32) } });
    const x = await techAndAgent(live, CAPS);
    await grant(x.tech, x.guest);
    x.guest.send({ t: "clip.consent", on: true });
    expect(await x.tech.waitFor("clip.consent")).toEqual({ t: "clip.consent", on: true });

    x.tech.send({ t: "clip.push", cid: ID(1), bytes: 12 });
    expect(await x.guest.waitFor("clip.push")).toEqual({ t: "clip.push", cid: ID(1), bytes: 12 });
    x.guest.send({ t: "clip.report", cid: ID(1), dir: "TO_CUSTOMER", bytes: 12, result: "OK" });
    expect(await x.tech.waitFor("clip.status")).toEqual({ t: "clip.status", cid: ID(1), result: "OK", bytes: 12 });
    x.tech.send({ t: "clip.pull", cid: ID(1) });
    expect(await x.tech.waitFor("error")).toMatchObject({ code: "VALIDATION" });

    x.tech.send({ t: "print.request", pid: ID(2), sizeBytes: 2048 });
    expect(await x.guest.waitFor("print.request")).toEqual({ t: "print.request", pid: ID(2), sizeBytes: 2048 });
    x.guest.send({ t: "control.state", state: "VIEW", source: "UI" });
    expect(await x.guest.waitFor("print.cancel")).toEqual({ t: "print.cancel", pid: ID(2) });
    expect(await x.guest.waitFor("clip.consent")).toEqual({ t: "clip.consent", on: false });
    expect(await x.tech.waitFor("print.status")).toEqual({ t: "print.status", pid: ID(2), result: "CANCELLED" });
    x.guest.send({ t: "print.report", pid: ID(2), decision: "APPROVED", result: "PRINTED", pages: 1, sizeBytes: 2048 });

    // İçerik işaretli alanlar şema dışı → 1008; hiçbir yere yazılmaz (AC-347, AC-351).
    x.tech.send({ t: "clip.push", cid: ID(3), bytes: 5, text: "P28A-ISARET-gizli" });
    await x.tech.closed;

    await expect.poll(async () => (await audits(x.sessionId, "print.job")).length).toBe(1);
    const job = (await audits(x.sessionId, "print.job"))[0];
    expect(job).toMatchObject({ result: "fail" });
    expect(job?.newValue).toEqual({ decision: "NONE", sizeBytes: 2048, result: "CANCELLED", reportedBy: "server" });
    const transfer = await audits(x.sessionId, "clipboard.transfer");
    expect(transfer.map((a) => a.newValue)).toEqual([{ direction: "TO_CUSTOMER", bytes: 12, result: "OK", reportedBy: "customer" }]);
    const consent = await audits(x.sessionId, "clipboard.consent");
    expect(consent.map((a) => a.newValue)).toEqual([
      { on: true, by: "customer" },
      { on: false, by: "system", reason: "control_closed" },
    ]);

    const metrics = await live.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${"m".repeat(32)}` } });
    expect(metrics.body).toContain('rs_print_job_total{result="CANCELLED"} 1');
    const rows = await testDb().auditLog.findMany({
      where: { entityId: x.sessionId },
      select: { action: true, newValue: true, oldValue: true },
    });
    const all = JSON.stringify(rows);
    for (const hay of [logs.text(), metrics.body, all]) {
      expect(hay).not.toContain("P28A-ISARET-");
      expect(hay).not.toContain("gizli-ad-");
    }
  });

  it("AC-344 (D-P28aK-2): teknisyenin pano yetkisi yokken clip.consent{on:true} → misafire {on:false}, teknisyene iletim ve audit yok", async () => {
    live = await startLive({ env: { METRICS_TOKEN: "m".repeat(32) } });
    const x = await techAndAgent(live, CAPS, { ...PERMS, "remote_control.clipboard": false });
    await grant(x.tech, x.guest);
    x.guest.send({ t: "clip.consent", on: true });
    expect(await x.guest.waitFor("clip.consent")).toEqual({ t: "clip.consent", on: false });
    const metrics = await live.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${"m".repeat(32)}` } });
    expect(metrics.body).toContain('rs_clip_print_denied_total{kind="consent",reason="permission"} 1');
    expect(x.tech.msgs.filter((m) => m.t === "clip.consent")).toEqual([]);
    expect(await audits(x.sessionId, "clipboard.consent")).toEqual([]);
  });

  it("AC-347 (O-P28a-5): 1 dk içinde 7 clip.consent değişimi → 6 audit satırı, 7. misafire {on:false}", async () => {
    live = await startLive();
    const x = await techAndAgent(live, CAPS);
    await grant(x.tech, x.guest);
    for (let i = 0; i < 7; i++) x.guest.send({ t: "clip.consent", on: i % 2 === 0 });
    for (let i = 0; i < 6; i++) await x.tech.waitFor("clip.consent");
    expect(await x.guest.waitFor("clip.consent")).toEqual({ t: "clip.consent", on: false });
    await expect.poll(async () => (await audits(x.sessionId, "clipboard.consent")).length).toBe(6);
  });
});
