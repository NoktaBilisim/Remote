// Talep oluşturma commit sonrası adımları (PT-K9: service.ts `createCore` + `notifyEmail`'den mekanik çıkarım; sıra aynı).
// Tenant kovası yalnız yazılmış talep için artar (AC-209) → metrikler → hub `request.new` → kuyruk → 120 sn kopma zamanlayıcısı
// → WhatsApp/e-posta bildirimi (beklenmez).
import type { CreateRequestResponse, RequestPriority } from "@remote/contracts/api/requests";
import { CHAT_MIN_CLIENT_VERSION } from "@remote/contracts/api/requests";
import { maskEmail } from "../audit/mask.ts";
import { writeAudit } from "../audit/service.ts";
import { compareVersions } from "../lib/version.ts";
import { newRequestMail } from "../mail/templates.ts";
import type { Admitted } from "./create-steps.ts";
import * as repo from "./repo.ts";
import type { RequestService } from "./service.ts";

const EMAIL_TENANT_PER_HOUR = 30;

export async function afterCreate(svc: RequestService, web: boolean, r: Admitted): Promise<CreateRequestResponse> {
  const { created, s, tenantId, id } = r;
  // commit sonrası: tenant kovası yalnız yazılmış talep için artar (AC-209). P19: WEB yalnız kendi kovasını.
  if (web) {
    svc.d.limits.tenantWebAll.add(tenantId);
    svc.d.metrics.inc("rs_web_requests_total", { result: "created" });
  } else {
    svc.d.limits.tenantAll.add(tenantId);
    if (r.privileged) svc.d.limits.tenantKnown.add(tenantId);
  }
  if (created.suppressed) svc.d.metrics.inc("rs_notify_suppressed_total", { reason: "pending_duplicate" });
  svc.d.metrics.inc("rs_requests_created_total", { via: r.via });
  if (created.afterHours) svc.d.metrics.inc("rs_requests_outside_hours_total", { mode: "ACCEPT", legacy: "false" });
  await publishNew(svc, r);
  svc.d.hub.queueChanged(tenantId);
  await svc.publishCount(tenantId);
  // İstemci /ws/request'e hiç bağlanmazsa 120 sn sonra DISCONNECTED (AC-141); bağlanınca iptal edilir.
  svc.d.hub.setDisconnect(
    id,
    () => void svc.cancelSystem(id, "DISCONNECTED").catch((e: unknown) => svc.logErr(e, "request_disconnect")),
    svc.d.timing.requestDisconnectMs,
  );
  if (s.waEnabled) svc.d.notifier.notifyNewRequest(tenantId, s.tenant.name, repo.jsonStrings(s.waRecipients), created.code);
  if (s.emailEnabled) notifyEmail(svc, tenantId, s.tenant.name, repo.jsonStrings(s.emailRecipients), created.code);
  return {
    requestId: id,
    requestSecret: r.secret,
    requestCode: created.code,
    expiresAt: r.expiresAt.toISOString(),
    position: created.position,
  };
}

async function publishNew(svc: RequestService, r: Admitted): Promise<void> {
  const { created, input } = r;
  const firm = r.customerId ? await svc.d.db.customer.findUnique({ where: { id: r.customerId }, select: { id: true, name: true } }) : null;
  svc.d.hub.publish(r.tenantId, {
    t: "request.new",
    id: r.id,
    requestCode: created.code,
    customerName: input.customerName,
    preview: [...input.description].slice(0, 100).join(""),
    networkMatch: r.networkMatch,
    knownDevice: r.knownDevice,
    createdAt: r.now.toISOString(),
    customerFirm: firm,
    viaBinding: r.binding !== null,
    bindingRevoked: false,
    staleSource: false,
    priority: created.priority as RequestPriority,
    slaDueAt: created.slaDueAt?.toISOString() ?? null,
    afterHours: created.afterHours,
    // H3: oluşturma anı tahmini (soket henüz yok); kesin durum GET …/messages `customerChat` (soket yeteneği).
    // P19 (§8c.2 m.6): tarayıcı her zaman rs.cap.chat1 bildirir → WEB "SUPPORTED".
    customerChat:
      input.source === "WEB" || compareVersions(input.clientVersion, CHAT_MIN_CLIENT_VERSION) >= 0 ? "SUPPORTED" : "UNSUPPORTED",
    source: input.source,
  });
}

/**
 * AC-151: e-posta kanalı — WhatsApp ile aynı kişisel verisiz içerik, alıcı başına ayrı ileti, beklenmez (10 sn zaman
 * aşımı + 1 yeniden deneme mail/service.ts'de; ≤ 60 sn). Tenant saatlik 30 ileti sınırı (WhatsApp tenant sınırıyla aynı);
 * aşım bastırılır + metrik. Sonuç alıcı başına audit `mail.sent` + `request.notify{channel:"email"}`.
 */
function notifyEmail(svc: RequestService, tenantId: string, firm: string, recipients: readonly string[], requestCode: string): void {
  const content = newRequestMail({ publicBaseUrl: svc.d.env.PUBLIC_BASE_URL, firm, requestCode });
  const ctx = { ip: "", userAgent: "notify", requestId: "" };
  void (async () => {
    const cfg = await svc.d.mail.configFor(tenantId);
    if (!cfg) return;
    for (const to of recipients) {
      if (svc.emailHour.add(tenantId) > EMAIL_TENANT_PER_HOUR) {
        svc.d.metrics.inc("rs_request_notify_total", { channel: "email", result: "suppressed" });
        continue;
      }
      const out = await svc.d.mail.sendForTenant(ctx, { tenantId, kind: "request_notify", entity: "support_requests" }, to, content, cfg);
      svc.d.metrics.inc("rs_request_notify_total", { channel: "email", result: out.ok ? "ok" : "failed" });
      await writeAudit(svc.d.db, ctx, {
        tenantId,
        username: "system",
        action: "request.notify",
        entity: "support_requests",
        result: out.ok ? "success" : "fail",
        newValue: { channel: "email", recipient: maskEmail(to), result: out.ok ? "success" : "fail", attempts: 1 },
      });
    }
  })().catch((e: unknown) => svc.logErr(e, "request_notify_email"));
}
