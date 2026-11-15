// Tenant SMTP'si üzerinden e-posta gönderimi (P10; ortak standart 2.1, AC-10/65/66/80/122/151).
//  - Ayar tenant_settings'ten; şifre lib/crypto.ts ile çözülür, loga/yanıta yazılmaz.
//  - Bağlantı netguard'ın çözümlediği IP'ye (SNI/sertifika = ad) — DNS rebinding yok (G-12).
//  - 10 sn zaman aşımı (deneme başına mutlak tavan MAIL_ATTEMPT_CAP_MS; B-P10-11: TCP soketi `getSocket` ile burada açılır,
//    tavanda/başarısızlıkta `destroy()` edilir — damlatan sunucu bağlantıyı açık tutamaz), arka plan gönderiminde bağlantı hatasında 1
//    yeniden deneme (mimari §7). Etkileşimli (test/oturum linki) gönderim tek deneme + başarısızlıkta sabit süre tabanı
//    (B-P10-1: kapalı port ile zaman aşımı ayırt edilemez). Hata sınıfı yalnız log/audit'te; kullanıcıya tek genel mesaj.
//  - Port allowlist (SMTP_ALLOWED_PORTS) ve "güvenlik Yok + kimlik bilgisi" reddi gönderimde de denetlenir (B-P10-1/5).
//  - Her gönderim audit `mail.sent {kind, recipient(maskeli), subject, result, reason}`.
import { SMTP_ALLOWED_PORTS, type SmtpSecurity } from "@remote/contracts/api/tenants";
import { MAIL_AUDIT } from "@remote/contracts/audit";
import { connect as netConnect, type Socket } from "node:net";
import nodemailer from "nodemailer";
import { maskEmail } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { aadFor, type SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import type { NetGuard } from "../lib/netguard.ts";
import type { Metrics } from "../ops/metrics.ts";
import { renderMailHtml, type MailContent } from "./templates.ts";

const MAIL_TIMEOUT_MS = 10_000;
/** Deneme başına mutlak tavan (yavaş damlatan sunucu dahil) = etkileşimli başarısızlık yanıt tabanı. */
export const MAIL_ATTEMPT_CAP_MS = 12_000;

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string | null;
  pass: string | null;
  fromName: string | null;
  fromEmail: string;
}

/** Sunucu içi hata sınıfı (log/audit/metrik); kullanıcıya gösterilmez (SMTP_SEND_FAILED_MESSAGE). */
export type SmtpFailure = "connect" | "auth" | "tls" | "rejected" | "port_not_allowed" | "insecure_auth";
type MailFailure = SmtpFailure | "not_configured";
type SendOutcome = { ok: true } | { ok: false; reason: MailFailure };

/** Test/enjeksiyon: nodemailer taşıyıcısı yerine. */
export type TransportFactory = (opts: Record<string, unknown>) => { sendMail(m: Record<string, unknown>): Promise<unknown>; close(): void };

interface MailDeps {
  db: Db;
  secrets: SecretBox;
  netguard: NetGuard;
  metrics: Metrics;
  log: { warn(o: object, m: string): void; error(o: object, m: string): void };
  transport?: TransportFactory;
  /** P12 (AC-81): tenant'a göre mutlak logo adresi (firma → sistem → Nokta). Hata olursa `fallbackLogoUrl`. */
  logoUrlFor: (tenantId: string | null) => Promise<string>;
  fallbackLogoUrl: string;
  /** Yalnız testler: deneme tavanı / etkileşimli taban (varsayılan MAIL_ATTEMPT_CAP_MS). */
  attemptCapMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type GetSocket = (o: { host?: unknown; port?: unknown }, cb: (err: Error | null, s?: { connection: Socket }) => void) => void;

/**
 * B-P10-11: nodemailer `getSocket` — düz TCP soketi (hedef = taşıyıcı `host`, yani netguard IP'si) burada açılır ve
 * `opened`'a eklenir; TLS (465 örtük / STARTTLS) yükseltmesini nodemailer `tls.servername` ile yapar (SNI/sertifika = ad).
 * Ham soketi yok etmek üstündeki TLS soketini de kapatır.
 */
function socketOpener(opened: Socket[]): GetSocket {
  return (o, cb) => {
    let done = false;
    const once = (err: Error | null, sock?: Socket) => {
      if (done) return;
      done = true;
      cb(err, sock ? { connection: sock } : undefined);
    };
    const sock = netConnect({ host: String(o.host), port: Number(o.port) });
    opened.push(sock);
    sock.on("error", (err) => once(Object.assign(err, { code: (err as { code?: unknown }).code ?? "ECONNECTION" }))); // sonraki hatalar nodemailer'da
    sock.once("connect", () => once(null, sock));
  };
}

function classify(err: unknown): SmtpFailure {
  const code = typeof err === "object" && err !== null ? String((err as { code?: unknown }).code ?? "") : "";
  if (code === "EAUTH") return "auth";
  const msg = err instanceof Error ? err.message : "";
  // Örtük TLS'de (465) sertifika/ad hatası soket hatası (ESOCKET) olarak gelir; ayrım mesajdan (yalnız log/audit sınıfı).
  if (code === "ETLS" || /CERT|SSL|TLS/i.test(code) || /certificate|altnames|self[- ]signed/i.test(msg)) return "tls";
  if (code === "EENVELOPE" || code === "EMESSAGE") return "rejected";
  return "connect";
}

export class MailService {
  readonly d: MailDeps;
  private readonly transport: TransportFactory;

  constructor(d: MailDeps) {
    this.d = d;
    this.transport = d.transport ?? ((o) => nodemailer.createTransport(o));
  }

  /** Tenant SMTP ayarı; yoksa veya şifre çözülemiyorsa null (çözülemezse alarm logu). */
  async configFor(tenantId: string | null): Promise<SmtpConfig | null> {
    if (!tenantId) return null;
    const s = await this.d.db.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        smtpHost: true,
        smtpPort: true,
        smtpSecurity: true,
        smtpUser: true,
        smtpPassEnc: true,
        smtpFromName: true,
        smtpFromEmail: true,
      },
    });
    if (!s?.smtpHost || !s.smtpPort || !s.smtpSecurity || !s.smtpFromEmail) return null;
    let pass: string | null = null;
    if (s.smtpPassEnc) {
      try {
        pass = this.d.secrets.decrypt(s.smtpPassEnc, aadFor.smtpPassword(tenantId));
      } catch {
        this.d.log.error({ alarm: "smtp_secret_unreadable", tenantId }, "SMTP şifresi çözülemedi (APP_ENCRYPTION_KEYS değişmiş olabilir)");
        return null;
      }
    }
    return {
      host: s.smtpHost,
      port: s.smtpPort,
      security: s.smtpSecurity as SmtpSecurity,
      user: s.smtpUser,
      pass,
      fromName: s.smtpFromName,
      fromEmail: s.smtpFromEmail,
    };
  }

  /** Ham gönderim (audit yok). netguard hatası (HOST_NOT_ALLOWED) yukarı fırlatılır. `attempts`: 1 (etkileşimli) / 2. */
  /** Logo adresi; çözülemezse varsayılan (gönderim logoya takılmaz). */
  private async logoUrl(tenantId: string | null): Promise<string> {
    try {
      return await this.d.logoUrlFor(tenantId);
    } catch (err) {
      this.d.log.warn({ err, event: "mail_logo_unresolved" }, "e-posta logosu çözülemedi; varsayılan kullanıldı");
      return this.d.fallbackLogoUrl;
    }
  }

  async deliver(cfg: SmtpConfig, to: string, content: MailContent, attempts = 2, logoUrl = this.d.fallbackLogoUrl): Promise<SendOutcome> {
    if (!(SMTP_ALLOWED_PORTS as readonly number[]).includes(cfg.port)) return { ok: false, reason: "port_not_allowed" };
    if (cfg.security === "NONE" && cfg.user) return { ok: false, reason: "insecure_auth" };
    const ip = await this.d.netguard.resolve(cfg.host);
    const servername = cfg.host.replace(/^\[|\]$/g, "");
    const cap = this.d.attemptCapMs ?? MAIL_ATTEMPT_CAP_MS;
    let last: SmtpFailure = "connect";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const sockets: Socket[] = [];
      const t = this.transport({
        host: ip,
        port: cfg.port,
        secure: cfg.security === "SSL",
        requireTLS: cfg.security === "STARTTLS",
        ignoreTLS: cfg.security === "NONE",
        tls: { servername, rejectUnauthorized: true },
        ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass ?? "" } } : {}),
        connectionTimeout: MAIL_TIMEOUT_MS,
        greetingTimeout: MAIL_TIMEOUT_MS,
        socketTimeout: MAIL_TIMEOUT_MS,
        name: "localhost",
        getSocket: socketOpener(sockets),
      });
      let timer: NodeJS.Timeout | undefined;
      try {
        const sending = t.sendMail({
          from: cfg.fromName ? { name: cfg.fromName, address: cfg.fromEmail } : cfg.fromEmail,
          to,
          subject: content.subject,
          text: content.text,
          html: renderMailHtml(logoUrl, content.bodyHtml),
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        sending.catch(() => undefined); // tavan aşıldıktan sonraki geç ret işlenmemiş kalmasın
        await Promise.race([
          sending,
          new Promise(
            (_r, rej) => (timer = setTimeout(() => rej(Object.assign(new Error("smtp attempt cap"), { code: "ETIMEDOUT" })), cap)),
          ),
        ]);
        return { ok: true };
      } catch (err) {
        last = classify(err);
        this.d.log.warn(
          {
            event: "smtp_send_failed",
            reason: last,
            attempt,
            code: (err as { code?: unknown }).code,
            responseCode: (err as { responseCode?: unknown }).responseCode,
          },
          "SMTP gönderimi başarısız",
        );
        for (const sock of sockets) sock.destroy(); // B-P10-11: tavan/başarısızlık → bağlantı gerçekten kapanır
        if (last !== "connect") break;
      } finally {
        clearTimeout(timer);
        t.close();
      }
    }
    return { ok: false, reason: last };
  }

  /**
   * Tenant SMTP'siyle gönderir ve audit yazar. SMTP yoksa gönderim yapılmaz (`not_configured`, yine audit).
   * HOST_NOT_ALLOWED (kayıttan sonra DNS değişti) → `connect` sayılır, fırlatılmaz.
   * `interactive`: kullanıcı yanıt bekliyor → tek deneme; başarısızlık yanıtı en az deneme tavanı kadar sürer (B-P10-1).
   */
  async sendForTenant(
    ctx: AuditContext,
    a: {
      tenantId: string | null;
      userId?: string | null;
      username?: string | null;
      kind: string;
      entity: string;
      entityId?: string | null;
    },
    to: string,
    content: MailContent,
    cfg?: SmtpConfig | null,
    opts: { interactive?: boolean } = {},
  ): Promise<SendOutcome> {
    const started = Date.now();
    const conf = cfg === undefined ? await this.configFor(a.tenantId) : cfg;
    let out: SendOutcome;
    if (!conf) out = { ok: false, reason: "not_configured" };
    else {
      try {
        out = await this.deliver(conf, to, content, opts.interactive ? 1 : 2, await this.logoUrl(a.tenantId));
      } catch {
        out = { ok: false, reason: "connect" };
      }
    }
    if (!out.ok && opts.interactive) await sleep(Math.max(0, (this.d.attemptCapMs ?? MAIL_ATTEMPT_CAP_MS) - (Date.now() - started)));
    this.d.metrics.inc("rs_mail_total", { kind: a.kind, result: out.ok ? "ok" : out.reason });
    try {
      await writeAudit(this.d.db, ctx, {
        tenantId: a.tenantId,
        userId: a.userId ?? null,
        username: a.username ?? "system",
        action: MAIL_AUDIT.SENT,
        entity: a.entity,
        entityId: a.entityId ?? null,
        result: out.ok ? "success" : "fail",
        newValue: {
          kind: a.kind,
          recipient: maskEmail(to),
          subject: content.subject,
          result: out.ok ? "success" : "fail",
          ...(out.ok ? {} : { reason: out.reason }),
        },
      });
    } catch (err) {
      this.d.log.error({ err, event: "mail_audit_failed" }, "e-posta audit'i yazılamadı");
    }
    return out;
  }
}
