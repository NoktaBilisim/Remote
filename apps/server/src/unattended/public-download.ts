// GET /api/v1/public/unattended/download?t= (mimari-link-gonderme §4.2, §4.3, §7, §8; AC-419; O-LG-2, D-LG-2). Oturumsuz,
// çerezsiz ayrı eklenti (panel kancaları uygulanmaz). Sıra (D-LG-2): biçim → IP 20/dk → tek yüklem (`usableCodeWhere` —
// kayıt TX'iyle ortak — + gözetimsiz kapısı; aksi tek tip 404) → ikili kapısı (503). Böylece 503 geçersiz belirteçle
// tetiklenemez. Belirteç yalnız SHA-256'sıyla aranır; belirteç/kod loga ve audit'e yazılmaz (sorgu dizesi `maskUrl` ile
// kırpılır). Başarılı indirme audit'i (O-LG-2): aynı kod + IP saatte en çok 1, kod başına toplam en çok 10; sonrakiler metrikte.
// HEAD gövdesiz 404 (audit yok).
import { createReadStream } from "node:fs";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance, FastifyReply } from "fastify";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import { uaSummary } from "../auth/trusted-device-ua.ts";
import { AppError } from "../lib/errors.ts";
import { ipKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { SERVICE_FILE_NAME } from "./download.ts";
import { createGate } from "./gate.ts";
import { downloadTokenHash, usableCodeWhere } from "./registration.ts";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
/** §7: IP (IPv6 /64) başına 20/dk → 21. istek 429. */
const PER_IP_PER_MIN = 20;
/** O-LG-2: kod başına ömür boyu en çok 10 indirme audit satırı. */
export const DOWNLOAD_AUDITS_PER_CODE = 10;

function headers(reply: FastifyReply): void {
  void reply
    .header("Cache-Control", "no-store")
    .header("Referrer-Policy", "no-referrer")
    .header("X-Robots-Tag", "noindex")
    .header("X-Content-Type-Options", "nosniff");
}

export async function publicUnattendedRoutes(app: FastifyInstance): Promise<void> {
  const perIp = new FixedWindowCounter(PER_IP_PER_MIN + 1, MIN_MS, MIN_MS);
  // O-LG-2: (kod, ipKey) saatte 1 audit — 2. olay pencereyi kilitler; kilitliyken audit yazılmaz.
  const auditOnce = new FixedWindowCounter(2, HOUR_MS, HOUR_MS);
  app.addHook("onClose", async () => {
    perIp.close();
    auditOnce.close();
  });
  const gate = createGate(app.env);
  const count = (result: string) => app.metrics.inc("rs_unattended_download_total", { result });

  async function auditDownload(ctx: AuditContext, code: { id: string; tenantId: string; customerId: string }): Promise<void> {
    const key = `${code.id}|${ipKey(ctx.ip)}`;
    if (auditOnce.blockedFor(key) > 0 || auditOnce.hit(key)) return;
    const done = await app.db.auditLog.count({
      where: {
        tenantId: code.tenantId,
        entity: "unattended_registration_codes",
        action: UNATTENDED_AUDIT.CODE_DOWNLOADED,
        entityId: code.id,
      },
    }); // D-LGK-1: tenant+entity ile indeksli
    if (done >= DOWNLOAD_AUDITS_PER_CODE) return;
    await writeAudit(app.db, ctx, {
      tenantId: code.tenantId,
      username: "public",
      action: UNATTENDED_AUDIT.CODE_DOWNLOADED,
      entity: "unattended_registration_codes",
      entityId: code.id,
      result: "success",
      newValue: { customerId: code.customerId, ua: uaSummary(ctx.userAgent) },
    });
  }

  app.head("/download", async (_req, reply) => {
    headers(reply);
    return reply.code(404).send();
  });

  app.get("/download", { exposeHeadRoute: false }, async (req, reply) => {
    headers(reply);
    const t = (req.query as { t?: unknown }).t;
    if (typeof t !== "string" || !TOKEN_RE.test(t)) {
      count("not_found");
      throw new AppError("NOT_FOUND");
    }
    const ctx = auditContext(req);
    const ip = ipKey(ctx.ip);
    const wait = perIp.blockedFor(ip);
    if (wait > 0 || perIp.hit(ip)) {
      count("rate_limited");
      throw new AppError("RATE_LIMITED", { retryAfterSec: wait || 60 });
    }
    const code = await app.db.unattendedRegistrationCode.findFirst({
      where: { downloadTokenHash: downloadTokenHash(t), ...usableCodeWhere(new Date()) },
      select: { id: true, tenantId: true, customerId: true },
    });
    if (!code || !gate.status().available) {
      count("not_found");
      throw new AppError("NOT_FOUND");
    }
    const path = app.env.UNATTENDED_AGENT_PATH;
    if ((await app.unattendedBinary.check()) !== "ok" || !path) {
      count("not_ready");
      throw new AppError("NOT_READY", { message: "Servis programı şu an indirilemiyor." });
    }
    await auditDownload(ctx, code);
    count("ok");
    return reply
      .header("Content-Type", "application/vnd.microsoft.portable-executable")
      .header("Content-Disposition", `attachment; filename="${SERVICE_FILE_NAME}"`)
      .send(createReadStream(path));
  });
}
