// B-P10-11: 12 sn deneme tavanı yalnız yanıtı değil bağlantıyı da keser. Süreç içi damlatan sahte SMTP (net, 127.0.0.1):
// selamlama hemen, EHLO yanıtı çok satırlı ve her 9 sn'de bir satır (boşta kalma süresi 10 sn hiç dolmaz). Tavanda
// `deliver` döner VE sunucu tarafında soket kapanmış olur. Gerçek tavan (MAIL_ATTEMPT_CAP_MS) ve nodemailer kullanılır;
// sarmalayıcı yalnız portu sahte sunucuya çevirir (allowlist 25'i geçer, getSocket taşıyıcı seçeneğindeki portu kullanır).
import { createServer, type Server, type Socket } from "node:net";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SecretBox } from "../../src/lib/crypto.ts";
import type { Db } from "../../src/lib/db.ts";
import { createNetGuard } from "../../src/lib/netguard.ts";
import { MAIL_ATTEMPT_CAP_MS, MailService, type SmtpConfig } from "../../src/mail/service.ts";
import { createMetrics } from "../../src/ops/metrics.ts";

const DRIP_MS = 9_000;
let server: Server;
let port = 0;
const conns: { socket: Socket; closedAt: number | null; timer: NodeJS.Timeout | null }[] = [];

beforeAll(async () => {
  server = createServer((socket) => {
    const c: (typeof conns)[number] = { socket, closedAt: null, timer: null };
    conns.push(c);
    socket.on("error", () => undefined);
    socket.on("close", () => {
      c.closedAt = Date.now();
      if (c.timer) clearInterval(c.timer);
    });
    socket.write("220 drip.test ESMTP\r\n");
    socket.once("data", () => {
      socket.write("250-drip.test\r\n");
      c.timer = setInterval(() => socket.write("250-HALA-DUSUNUYOR\r\n"), DRIP_MS); // yanıt hiç bitmez
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  for (const c of conns) {
    if (c.timer) clearInterval(c.timer);
    c.socket.destroy();
  }
  await new Promise<void>((r) => server.close(() => r()));
});

describe("B-P10-11 SMTP deneme tavanı soketi kapatır", () => {
  it("B-P10-11: her 9 sn'de satır gönderen sunucu → 12 sn'de `connect` hatası döner ve sunucu tarafında bağlantı kapanır", async () => {
    const svc = new MailService({
      db: {} as Db,
      secrets: new SecretBox(null),
      netguard: createNetGuard({ lookupAll: async (h) => (h === "drip.test" ? ["127.0.0.1"] : []), isBlocked: () => false }),
      metrics: createMetrics(),
      log: { warn: () => undefined, error: () => undefined },
      transport: (o) => nodemailer.createTransport({ ...o, port } as Parameters<typeof nodemailer.createTransport>[0]),
    });
    const cfg: SmtpConfig = { host: "drip.test", port: 25, security: "NONE", user: null, pass: null, fromName: null, fromEmail: "destek@firma.test" };
    const t0 = Date.now();
    const out = await svc.deliver(cfg, "a@alici.test", { subject: "s", text: "t", html: "<p>t</p>" }, 1);
    const returnedAt = Date.now();
    expect(out).toEqual({ ok: false, reason: "connect" });
    expect(returnedAt - t0).toBeGreaterThanOrEqual(MAIL_ATTEMPT_CAP_MS - 100);
    expect(returnedAt - t0).toBeLessThan(MAIL_ATTEMPT_CAP_MS + 2_000);
    expect(conns).toHaveLength(1);
    await expect.poll(() => conns[0]?.closedAt ?? null, { timeout: 2_000 }).not.toBeNull();
    expect((conns[0]?.closedAt ?? 0) - returnedAt).toBeLessThan(1_000);
  }, 30_000);
});
