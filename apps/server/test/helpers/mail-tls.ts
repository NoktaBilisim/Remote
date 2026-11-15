// PT-K2: süreç içi sahte SMTP fikstürleri (mail-tls-p10, mail-starttls-p14a, account-p10, security-p14a-auth başlarının
// tek tanımı). Sertifika test anında openssl ile üretilir (depoya özel anahtar girmez). Saf: alınan iletiler ve sunucu
// listesi çağıranın dizisinde tutulur.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { SecretBox } from "../../src/lib/crypto.ts";
import type { Db } from "../../src/lib/db.ts";
import { createNetGuard, isBlockedIp, type NetGuard } from "../../src/lib/netguard.ts";
import { MailService, type TransportFactory } from "../../src/mail/service.ts";
import { createMetrics } from "../../src/ops/metrics.ts";

/** `smtp.test` adlı, 1 gün geçerli öz imzalı sertifika; `dir` çağıranın afterAll'unda silinir. */
export function makeTlsCert(prefix: string): { dir: string; cert: string; key: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "k.pem"),
      "-out",
      join(dir, "c.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=smtp.test",
      "-addext",
      "subjectAltName=DNS:smtp.test",
    ],
    { stdio: "ignore" },
  );
  return { dir, cert: readFileSync(join(dir, "c.pem"), "utf8"), key: readFileSync(join(dir, "k.pem")) };
}

/**
 * TLS testleri için posta servisi: `smtp.test`/`baska-ad.test` → 127.0.0.1. Taşıyıcı seçenekleri üretimle aynı;
 * sarmalayıcı yalnız rastgele portu ve güvenilen CA'yı ekler. `seen` verilirse taşıyıcı seçenekleri oraya eklenir.
 */
export function tlsMailService(o: { port: number; cert: string; seen?: Record<string, unknown>[] }): MailService {
  return new MailService({
    db: {} as Db,
    secrets: new SecretBox(null),
    netguard: createNetGuard({
      lookupAll: async (h) => (h === "smtp.test" || h === "baska-ad.test" ? ["127.0.0.1"] : []),
      isBlocked: () => false,
    }),
    metrics: createMetrics(),
    log: { warn: () => undefined, error: () => undefined },
    logoUrlFor: async () => "https://rs.test/img/logo.png",
    fallbackLogoUrl: "https://rs.test/img/logo.png",
    attemptCapMs: 5_000,
    transport: (t) => {
      o.seen?.push(t);
      return nodemailer.createTransport({ ...t, port: o.port, tls: { ...(t.tls as object), ca: [o.cert] } } as Parameters<
        typeof nodemailer.createTransport
      >[0]);
    },
  });
}

export const closeSmtp = (smtp: SMTPServer): Promise<void> => new Promise<void>((r) => smtp.close(() => r()));

/** Düz metin sahte SMTP (STARTTLS/AUTH kapalı); her ileti `inbox`'a eklenir. */
export async function startInboxSmtp(inbox: { to: string; body: string }[]): Promise<{ smtp: SMTPServer; port: number }> {
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    logger: false,
    onData(stream, session, cb) {
      let body = "";
      stream.on("data", (c: Buffer) => (body += c.toString("utf8")));
      stream.on("end", () => {
        inbox.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), body });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r()));
  return { smtp, port: (smtp.server.address() as { port: number }).port };
}

/** "smtp.test" → 127.0.0.1; diğer tüm yasak aralıklar gerçek kuralla reddedilir. */
export const loopbackNetguard = (): NetGuard =>
  createNetGuard({
    lookupAll: async (h) => (h === "smtp.test" ? ["127.0.0.1"] : []),
    isBlocked: (ip) => ip !== "127.0.0.1" && isBlockedIp(ip),
  });

/** Sözleşme yalnız 25/465/587/2525'e izin verir (B-P10-1): 2525 → süreç içi sahte SMTP, diğerleri → kapalı port 9. */
export const inboxTransport =
  (smtpPort: () => number): TransportFactory =>
  (o) =>
    nodemailer.createTransport({ ...o, port: o.port === 2525 ? smtpPort() : 9 } as Parameters<typeof nodemailer.createTransport>[0]);
