// Talep kabul TX'i ve commit sonrası adımları (AC-153, 154, 239; mimari-e9 §3.4) — PT-K9: panel.ts `acceptRequest`
// gövdesinden mekanik çıkarım. Kilit sırası (S-P19-T12): ayarlar → teknisyen → müşteri → talep (oluşturma/ret/süre dolumu ile
// aynı; 1213 yok). Tüm TX adımları aynı `tx` nesnesini alır.
import {
  ACCEPT_CODE_MIN_CLIENT_VERSION,
  REQUEST_CONNECT_WINDOW_SEC,
  requestClientOsSchema,
  type RequestClientOs,
} from "@remote/contracts/api/requests";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import * as crepo from "../customers/repo.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { compareVersions } from "../lib/version.ts";
import { newTechVerifyCode } from "../sessions/codes.ts";
import * as srepo from "../sessions/repo.ts";
import { who } from "./panel-settings.ts";
import * as repo from "./repo.ts";
import type { RequestService } from "./service.ts";

/** DB değeri (CHECK'li) şemayla daraltılır; yalnız AGENT talebinde. */
const clientOsOf = (r: repo.SecretRow): { clientOs?: RequestClientOs } => {
  const p = requestClientOsSchema.safeParse(r.clientOs);
  return r.source === "AGENT" && p.success ? { clientOs: p.data } : {};
};

const sec = (ms: number): number => Math.max(0, Math.floor(ms / 1000));

type Head = Awaited<ReturnType<typeof repo.findStatusInTenant>>;
interface Accepted {
  r: repo.SecretRow;
  sessionId: string;
  techVerifyCode: string;
  now: Date;
  acceptCode: boolean;
}
type Who = { svc: RequestService; ctx: AuditContext; auth: AuthContext; tenantId: string; id: string };

/** Kabul TX'i: `customer_passive` / `client_unsupported` / null (yarış kaybı) ya da açılan oturum. */
export async function acceptTx(w: Who, tx: Prisma.TransactionClient): Promise<"customer_passive" | "client_unsupported" | Accepted | null> {
  const { svc, auth, tenantId, id } = w;
  await repo.lockSettings(tx, tenantId);
  await srepo.lockTechnician(tx, auth.user.id);
  const settings = await srepo.sessionSettings(tx, tenantId);
  if (!settings) throw new Error("tenant_settings satırı yok");
  const now = new Date(svc.d.clock.now());
  if ((await srepo.countOpen(tx, auth.user.id, now)) >= settings.maxOpenSessions) throw new AppError("OPEN_SESSION_LIMIT");
  // B-P8c-1: müşterili talepte müşteri, talep satırından ÖNCE paylaşımlı kilitlenir (pasife alma ile aynı sıra:
  // customers → support_requests; kilitlenme yok). Pasifse kabul edilmez; talep commit sonrası CUSTOMER_PASSIVE iptal.
  const head = await repo.findStatusInTenant(tx, tenantId, id);
  if (head?.status === "PENDING" && head.customerId && (await crepo.shareStatus(tx, tenantId, head.customerId)) !== "ACTIVE")
    return "customer_passive" as const;
  // P15 (AC-239, S15-6): kabul kodu ayarı kabul TX'inde okunur. Ayar açıkken kodu desteklemeyen (istemci beyanı
  // < ACCEPT_CODE_MIN_CLIENT_VERSION) talep kabul edilmez (fail-closed): düşük sürüm beyanı doğrulamayı atlatamaz.
  // Talep PENDING kalır (kuyruktan düşmez); yalnız fail audit'i commit edilir.
  const acceptCode = (await repo.settingsByTenant(tx, tenantId))?.requireAcceptCode === true;
  if (acceptCode && clientUnsupported(head)) {
    await writeAudit(tx, w.ctx, {
      ...who(auth, tenantId),
      action: "request.accepted",
      entity: "support_requests",
      entityId: id,
      result: "fail",
      // Anahtar adı "code" içermez: audit maskesi (MASKED_KEY) onu "***" yapardı.
      newValue: { acceptVerification: false, reason: "client_unsupported", clientVersion: head.clientVersion },
    });
    return "client_unsupported" as const;
  }
  if ((await repo.acceptPending(tx, tenantId, id, auth.user.id, now)) === 0) return null;
  return openSession(w, tx, now, acceptCode);
}

/**
 * P19 (S-P19-13, T2): sürüm kapısı yalnız AGENT dalında. WEB (tarayıcı) kabul kodunu destekler sayılır → asla
 * client_unsupported almaz; AGENT satırında client_version DB CHECK'i gereği NULL olamaz (NULL ise yine fail-closed).
 */
function clientUnsupported(head: Head): head is NonNullable<Head> {
  return (
    head?.status === "PENDING" &&
    head.source === "AGENT" &&
    (head.clientVersion === null || compareVersions(head.clientVersion, ACCEPT_CODE_MIN_CLIENT_VERSION) < 0)
  );
}

async function openSession(w: Who, tx: Prisma.TransactionClient, now: Date, acceptCode: boolean): Promise<Accepted> {
  const { svc, auth, tenantId, id } = w;
  const r = await repo.findById(tx, id);
  if (!r) throw new Error("request_missing_after_accept");
  const sessionId = newId();
  const techVerifyCode = newTechVerifyCode();
  // P15 (AC-239): kod penceresi aynı 60 sn (DB `support_sessions_ttl_chk` talep oturumunu 55..65 sn'ye bağlar); kodun
  // bu sürede girilmesi gerekir (implementation.md P15 sapma notu).
  await srepo.insertSession(tx, {
    id: sessionId,
    tenantId,
    technicianId: auth.user.id,
    tokenHash: sha256Hex(newSecretToken()), // hiç döndürülmez (§3.3)
    activeCode: null,
    techVerifyCode,
    status: "PENDING",
    createdAt: now,
    expiresAt: new Date(now.getTime() + REQUEST_CONNECT_WINDOW_SEC * 1000),
    requestId: id,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    customerId: r.customerId, // P8c AC-177: talebin müşterisi oturuma kopyalanır (aynı tenant — bileşik FK)
  });
  const waitSec = sec(now.getTime() - r.createdAt.getTime());
  await writeAudit(tx, w.ctx, {
    ...who(auth, tenantId),
    action: "request.accepted",
    entity: "support_requests",
    entityId: id,
    result: "success",
    oldValue: { status: "PENDING" },
    newValue: {
      status: "ACCEPTED",
      sessionId,
      waitSec,
      // Anahtar adı "code" içermez: audit maskesi (MASKED_KEY) onu "***" yapardı.
      ...(acceptCode ? { acceptVerification: true } : {}),
    },
  });
  await svc.d.outbox.enqueue(tx, tenantId, id, "REQ_ACCEPTED"); // P19 (AC-261): aynı TX, lockSettings'ten sonra (T12)
  return { r, sessionId, techVerifyCode, now, acceptCode };
}

/** Commit sonrası (§3.4): ön-kabullü misafir + ticket → bekleyen istemciye; panellere kaldırma; 60 sn penceresi. */
export async function afterAccept(w: Omit<Who, "ctx">, res: Accepted): Promise<void> {
  const { svc, auth, tenantId, id } = w;
  const { r, sessionId, techVerifyCode, now, acceptCode } = res;
  const ticket = svc.d.rooms.preAdmitGuest(
    {
      id: sessionId,
      tenantId,
      technicianId: auth.user.id,
      technician: { fullName: auth.user.fullName },
      expiresAt: new Date(now.getTime() + REQUEST_CONNECT_WINDOW_SEC * 1000),
    },
    {
      requestId: id,
      // P19 (§8c.2 m.5): WEB talebi tarayıcı modunda ön-kabul (input kanalı yok); AGENT yolu değişmez.
      kind: r.source === "WEB" ? "BROWSER" : "AGENT",
      name: r.customerName ?? "Müşteri",
      ...(r.customerEmail ? { email: r.customerEmail } : {}),
      clientVersion: r.clientVersion,
      // P31 (AC-511, D-2): talepteki beyan → misafir clientOs (OS_PERMISSION kabulü). NULL/WEB → alan yok (= windows).
      ...clientOsOf(r),
      consent: { textId: r.consentTextId, version: r.consentText.version, sha256: r.consentSha256, at: now, ip: "", userAgent: "" },
      acceptCode,
    },
  );
  svc.d.hub.clearDisconnect(id);
  svc.d.hub.sendChat(id, { t: "request.chat", enabled: false }); // P18 H3: yalnız yetenekli soket; kabul öncesi sohbet biter
  svc.d.hub.sendToRequest(id, {
    t: "request.accepted",
    wsTicket: ticket.wsTicket,
    technicianName: auth.user.fullName.slice(0, 100),
    techVerifyCode,
    ticketExpiresAt: new Date(ticket.expiresAt).toISOString(),
    ...(ticket.admitCode ? { admitCode: ticket.admitCode } : {}),
  });
  svc.d.hub.publish(tenantId, { t: "request.removed", id, status: "ACCEPTED" });
  svc.countSlaBreach(id);
  svc.d.hub.queueChanged(tenantId);
  await svc.publishCount(tenantId);
  svc.startConnectTimer(id);
}
