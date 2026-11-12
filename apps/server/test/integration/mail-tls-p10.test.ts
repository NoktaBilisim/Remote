// P10 (güvenlik raporu "incelenmeyen": nodemailer tls.servername): bağlantı netguard'ın çözdüğü IP'ye yapılırken sertifika
// ayar host adına göre doğrulanır. Süreç içi TLS'li sahte SMTP (smtp-server, 127.0.0.1); sertifika test anında openssl ile
// üretilir (depoya özel anahtar girmez). Üretim taşıyıcı seçenekleri değişmez; sarmalayıcı yalnız güvenilen CA ekler.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SecretBox } from "../../src/lib/crypto.ts";
import type { Db } from "../../src/lib/db.ts";
import { createNetGuard } from "../../src/lib/netguard.ts";
import { MailService, type SmtpConfig } from "../../src/mail/service.ts";
import { createMetrics } from "../../src/ops/metrics.ts";

let dir = "";
let cert = "";
let smtp: SMTPServer;
let port = 0;
const received: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rs-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=smtp.test", "-addext", "subjectAltName=DNS:smtp.test"], { stdio: "ignore" });
  cert = readFileSync(join(dir, "c.pem"), "utf8");
  smtp = new SMTPServer({
    secure: true,
    key: readFileSync(join(dir, "k.pem")),
    cert,
    authOptional: true,
    disabledCommands: ["AUTH"],
    logger: false,
    onData(stream, session, cb) {
      stream.resume();
      stream.on("end", () => {
        received.push(session.envelope.rcptTo.map((r) => r.address).join(","));
        cb();
      });
    },
  });
  smtp.on("error", () => undefined); // yanlış ad testinde istemci el sıkışmayı keser
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r()));
  port = (smtp.server.address() as { port: number }).port;
});
afterAll(async () => {
  await new Promise<void>((r) => smtp.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe("SMTP TLS sertifika adı doğrulaması (servername)", () => {
  const seen: Record<string, unknown>[] = [];
  const svc = () =>
    new MailService({
      db: {} as Db,
      secrets: new SecretBox(null),
      netguard: createNetGuard({ lookupAll: async (h) => (h === "smtp.test" || h === "baska-ad.test" ? ["127.0.0.1"] : []), isBlocked: () => false }),
      metrics: createMetrics(),
      log: { warn: () => undefined, error: () => undefined },
      attemptCapMs: 5_000,
      transport: (o) => {
        seen.push(o);
        return nodemailer.createTransport({ ...o, port, tls: { ...(o.tls as object), ca: [cert] } } as Parameters<typeof nodemailer.createTransport>[0]);
      },
    });
  const cfg: SmtpConfig = { host: "smtp.test", port: 465, security: "SSL", user: null, pass: null, fromName: null, fromEmail: "destek@firma.test" };
  const content = { subject: "s", text: "t", html: "<p>t</p>" };

  it("AC-122: IP'ye bağlanır, sertifika ayar adına (smtp.test) göre doğrulanır → gönderim başarılı", async () => {
    expect(await svc().deliver(cfg, "a@alici.test", content, 1)).toEqual({ ok: true });
    expect(received).toContain("a@alici.test");
    expect(seen.at(-1)).toMatchObject({ host: "127.0.0.1", tls: { servername: "smtp.test", rejectUnauthorized: true } });
  });

  it("AC-122: aynı IP, sertifikada olmayan ad → TLS hatası, ileti gitmez", async () => {
    const before = received.length;
    expect(await svc().deliver({ ...cfg, host: "baska-ad.test" }, "b@alici.test", content, 1)).toEqual({ ok: false, reason: "tls" });
    expect(received.length).toBe(before);
  });
});
