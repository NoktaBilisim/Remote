// P14a (AC-213): SMTP 587 + STARTTLS. P10 kalıbı (mail-tls-p10): süreç içi sahte SMTP (smtp-server, MIT devDependency —
// P10'da eklendi), sertifika test anında openssl ile üretilir (depoya özel anahtar girmez). Taşıyıcı seçenekleri üretimle
// aynı; sarmalayıcı yalnız rastgele portu ve güvenilen CA'yı ekler.
import { rmSync } from "node:fs";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SmtpConfig } from "../../src/mail/service.ts";
import { closeSmtp, makeTlsCert, tlsMailService } from "../helpers/mail-tls.ts";

let dir = "";
let cert = "";
let key: Buffer;
const received: string[] = [];
/** Yalnız TLS'e yükseltilmiş oturumda alınan iletiler. */
const securedRcpt: string[] = [];
const servers: SMTPServer[] = [];

/** `hide`: STARTTLS ilan edilmez ama komut çalışır; `none`: ilan edilmez ve komut kapalı (TLS hiç yok). */
async function start(o: { starttls: "on" | "hide" | "none" }): Promise<number> {
  const smtp = new SMTPServer({
    secure: false,
    key,
    cert,
    hideSTARTTLS: o.starttls !== "on",
    authOptional: true,
    disabledCommands: o.starttls === "none" ? ["AUTH", "STARTTLS"] : ["AUTH"],
    logger: false,
    onData(stream, session, cb) {
      stream.resume();
      stream.on("end", () => {
        received.push(session.envelope.rcptTo.map((r) => r.address).join(","));
        if (session.secure) securedRcpt.push(session.envelope.rcptTo.map((r) => r.address).join(","));
        cb();
      });
    },
  });
  smtp.on("error", () => undefined); // yanlış ad testinde istemci el sıkışmayı keser
  servers.push(smtp);
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", () => r()));
  return (smtp.server.address() as { port: number }).port;
}

beforeAll(() => {
  ({ dir, cert, key } = makeTlsCert("rs-starttls-"));
});
afterAll(async () => {
  await Promise.all(servers.map((s) => closeSmtp(s)));
  rmSync(dir, { recursive: true, force: true });
});

const svc = (port: number) => tlsMailService({ port, cert });
const cfg: SmtpConfig = {
  host: "smtp.test",
  port: 587,
  security: "STARTTLS",
  user: null,
  pass: null,
  fromName: null,
  fromEmail: "destek@firma.test",
};
const content = { subject: "s", text: "t", bodyHtml: "<p>t</p>" };

describe("AC-213: SMTP 587 + STARTTLS", () => {
  it("AC-213: doğru ad → STARTTLS yükseltmesi ve gönderim (kontrol)", async () => {
    const port = await start({ starttls: "on" });
    expect(await svc(port).deliver(cfg, "ok@alici.test", content, 1)).toEqual({ ok: true });
    expect(received).toContain("ok@alici.test");
  });

  it("AC-213: sertifikada olmayan ad → tls hatası, ileti gitmez", async () => {
    const port = await start({ starttls: "on" });
    const before = received.length;
    expect(await svc(port).deliver({ ...cfg, host: "baska-ad.test" }, "yanlis@alici.test", content, 1)).toEqual({
      ok: false,
      reason: "tls",
    });
    expect(received.length).toBe(before);
  });

  it("AC-213: STARTTLS ilan etmeyen sunucu → düz metne düşülmez: ileti yalnız zorla yükseltilmiş TLS oturumunda gider", async () => {
    const port = await start({ starttls: "hide" });
    expect(await svc(port).deliver(cfg, "gizli@alici.test", content, 1)).toEqual({ ok: true });
    expect(securedRcpt).toContain("gizli@alici.test");
  });

  it("AC-213: STARTTLS ilan etmeyen ve desteklemeyen sunucu → tls hatası, gönderim yok", async () => {
    const port = await start({ starttls: "none" });
    const before = received.length;
    const out = await svc(port).deliver(cfg, "duz@alici.test", content, 1);
    expect(out.ok).toBe(false);
    expect(out).toEqual({ ok: false, reason: "tls" });
    expect(received.length).toBe(before);
    expect(received).not.toContain("duz@alici.test");
  });
});
