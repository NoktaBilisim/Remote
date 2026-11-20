// LG hedef çözücü (mimari-link-gonderme §4.3–§4.5, §6). Hedefi tenant kapsamında yükler; hata sırası her uçta aynı:
// 404 (yok / başka tenant / sahibi değil; K2'de `manage` yokluğu da 404) → 403 (K1/K3 kanal yetkisi yok) → 400 (K1 bağlantı,
// K2 kod HMAC'i) → 409 (durum). Çıktı şablon girdisi, yetkili kanallar ve alıcı önerileridir; gönderim/sayaç yoktur.
import { CHANNELS_BY_KIND, type CustomerSendChannel, type RecipientChoice, type SendTarget } from "@remote/contracts/api/customer-send";
import { UNATTENDED_CODE_SENDS_MAX } from "@remote/contracts/api/customer-send";
import { sessionTokenSchema } from "@remote/contracts/api/sessions";
import { formatRegistrationCode, normalizeRegistrationCode } from "@remote/contracts/api/unattended";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import type { AuthContext } from "../auth/session.ts";
import type { SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { safeEqual, sha256Hex } from "../lib/ids.ts";
import type { TemplateInput } from "../notify/customer-templates.ts";
import { agentLinkFor, type AgentLinkDeps } from "../public/agent.ts";
import { webFormUrl } from "../requests/panel-settings.ts";
import { requestDownloadUrl } from "../requests/ref.ts";
import type { UnattendedGate } from "../unattended/gate.ts";
import { codeHash, downloadToken } from "../unattended/registration.ts";

export const UNATTENDED_PUBLIC_DOWNLOAD_PATH = "/api/v1/public/unattended/download";

export interface TargetDeps {
  db: Db;
  secrets: SecretBox;
  gate: UnattendedGate;
  publicBaseUrl: string;
  unattendedSha256: string | undefined;
  agent: AgentLinkDeps;
}

export interface Resolved {
  kind: SendTarget["kind"];
  entity: string;
  entityId: string;
  customerId: string | null;
  input: TemplateInput;
  /** Yetkili kanallar (CHANNELS_BY_KIND ∩ yetki). Yetkisiz kanal listeye hiç girmez (AC-406, 413). */
  allowed: CustomerSendChannel[];
  recipientsLocked: boolean;
  recipients: { email: RecipientChoice[]; phone: RecipientChoice[] };
  remainingSends: number | null;
}

const base = (u: string): string => u.replace(/\/+$/, "");
const has = (auth: AuthContext, p: Parameters<AuthContext["permissions"]["has"]>[0]): boolean => auth.permissions.has(p);
const dedupe = (xs: RecipientChoice[]): RecipientChoice[] => {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.value.toLowerCase()) ? false : (seen.add(x.value.toLowerCase()), true)));
};
const notPending = (): AppError => new AppError("CONFLICT", { message: "Yalnız bekleyen oturumun bağlantısı gönderilebilir." });
const codeGone = (): AppError => new AppError("CONFLICT", { message: "Kayıt kodu artık geçerli değil; yeni kod oluşturun." });

function tokenFromLink(publicBaseUrl: string, link: string): string | null {
  const prefix = `${base(publicBaseUrl)}/session/`;
  if (!link.startsWith(prefix)) return null;
  const t = sessionTokenSchema.safeParse(link.slice(prefix.length));
  return t.success ? t.data : null;
}

/** K1: yalnız oturumun kendi teknisyeni (aksi 404); EMAIL `sessions.create`, WA/SMS `sessions.send_link`. */
async function resolveSession(
  d: TargetDeps,
  auth: AuthContext,
  tenantId: string,
  t: { sessionId: string; link: string },
): Promise<Resolved> {
  const s = await d.db.supportSession.findFirst({
    where: { id: t.sessionId, tenantId, technicianId: auth.user.id },
    select: {
      status: true,
      expiresAt: true,
      tokenHash: true,
      activeCode: true,
      customerId: true,
      tenant: { select: { name: true } },
      request: { select: { customerPhone: true } },
      customer: { select: { email: true, phone: true, anonymizedAt: true } },
    },
  });
  if (!s) throw new AppError("NOT_FOUND");
  const allowed = CHANNELS_BY_KIND.SESSION.filter((c) => has(auth, c === "EMAIL" ? "sessions.create" : "sessions.send_link"));
  if (allowed.length === 0) throw new AppError("FORBIDDEN");
  if (s.status !== "PENDING" || s.expiresAt <= new Date() || !s.activeCode) throw notPending();
  const token = tokenFromLink(d.publicBaseUrl, t.link);
  if (!token || !safeEqual(sha256Hex(token), s.tokenHash))
    throw new AppError("VALIDATION", { fields: { link: "Bağlantı bu oturuma ait değil." } });
  const c = s.customer && s.customer.anonymizedAt === null ? s.customer : null;
  const phone: RecipientChoice[] = [
    ...(s.request?.customerPhone ? [{ value: s.request.customerPhone, source: "request" as const }] : []),
    ...(c?.phone ? [{ value: c.phone, source: "customer" as const }] : []),
  ];
  return {
    kind: "SESSION",
    entity: "support_sessions",
    entityId: t.sessionId,
    customerId: s.customerId,
    input: {
      kind: "SESSION",
      firm: s.tenant.name,
      technician: auth.user.fullName,
      link: t.link,
      code: s.activeCode,
      expiresAt: s.expiresAt,
      agent: await agentLinkFor(d.agent, t.sessionId),
    },
    allowed: [...allowed],
    recipientsLocked: false,
    recipients: { email: c?.email ? [{ value: c.email, source: "customer" }] : [], phone: dedupe(phone) },
    remainingSends: null,
  };
}

/**
 * K2 (§4.5, AC-415/416, D-LG-5): `manage` yoksa ya da kod bu kullanıcının değilse 404. Satır silinmişse (iptal) 409 yalnız
 * aynı tenant + aynı kullanıcı + aynı entity_id iptal audit'i varken — bu kontrol `manage` ve kapsamdan SONRA.
 */
async function resolveCode(d: TargetDeps, auth: AuthContext, tenantId: string, t: { codeId: string; code: string }): Promise<Resolved> {
  if (!has(auth, "unattended.manage")) throw new AppError("NOT_FOUND");
  const row = await d.db.unattendedRegistrationCode.findFirst({
    where: { id: t.codeId, tenantId, createdBy: auth.user.id },
    select: {
      codeHash: true,
      customerId: true,
      usedAt: true,
      expiresAt: true,
      sentCount: true,
      downloadTokenHash: true,
      tenant: { select: { name: true } },
      customer: { select: { status: true, anonymizedAt: true } },
    },
  });
  if (!row) {
    const cancelled = await d.db.auditLog.count({
      where: { tenantId, userId: auth.user.id, action: UNATTENDED_AUDIT.CODE_CANCELLED, entityId: t.codeId },
    });
    throw cancelled > 0 ? codeGone() : new AppError("NOT_FOUND");
  }
  const code = normalizeRegistrationCode(t.code);
  if (!safeEqual(codeHash(d.secrets, code), row.codeHash))
    throw new AppError("VALIDATION", { fields: { code: "Kayıt kodu bu kayıtla eşleşmiyor." } });
  if (!d.gate.status().available) throw new AppError("UNATTENDED_DISABLED");
  if (row.usedAt !== null || row.expiresAt <= new Date() || row.downloadTokenHash === null) throw codeGone();
  if (row.customer.status !== "ACTIVE" || row.customer.anonymizedAt !== null)
    throw new AppError("CONFLICT", { message: "Müşteri pasif; kayıt kodu gönderilemez." });
  const contacts = await d.db.customerNotifyContact.findMany({
    where: { tenantId, customerId: row.customerId },
    select: { email: true, phone: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const token = downloadToken(d.secrets, code);
  return {
    kind: "UNATTENDED_CODE",
    entity: "unattended_registration_codes",
    entityId: t.codeId,
    customerId: row.customerId,
    input: {
      kind: "UNATTENDED_CODE",
      firm: row.tenant.name,
      downloadUrl: `${base(d.publicBaseUrl)}${UNATTENDED_PUBLIC_DOWNLOAD_PATH}?t=${token}`,
      code: formatRegistrationCode(code),
      expiresAt: row.expiresAt,
      sha256: d.unattendedSha256 ?? "",
    },
    allowed: [...CHANNELS_BY_KIND.UNATTENDED_CODE],
    recipientsLocked: true,
    recipients: {
      email: dedupe(contacts.map((c) => ({ value: c.email, source: "contact" as const }))),
      phone: dedupe(contacts.flatMap((c) => (c.phone ? [{ value: c.phone, source: "contact" as const }] : []))),
    },
    remainingSends: Math.max(0, UNATTENDED_CODE_SENDS_MAX - row.sentCount),
  };
}

/** K3 (AC-421..423): `customers.view` + `sessions.send_link` (aksi 403); pasif/anonim/bağlantısız 409; güncel ref. */
async function resolveCustomer(d: TargetDeps, auth: AuthContext, tenantId: string, customerId: string): Promise<Resolved> {
  const c = await d.db.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { status: true, anonymizedAt: true, requestRef: true, email: true, phone: true, tenant: { select: { name: true } } },
  });
  if (!c) throw new AppError("NOT_FOUND");
  if (!has(auth, "customers.view") || !has(auth, "sessions.send_link")) throw new AppError("FORBIDDEN");
  if (c.status !== "ACTIVE" || c.anonymizedAt !== null)
    throw new AppError("CONFLICT", { message: "Müşteri pasif; bağlantı gönderilemez." });
  const rs = await d.db.tenantRequestSettings.findUnique({ where: { tenantId }, select: { webFormEnabled: true } });
  const downloadUrl = requestDownloadUrl(d.publicBaseUrl, c.requestRef);
  const form = rs?.webFormEnabled ? webFormUrl(d.publicBaseUrl, c.requestRef) : null;
  const contacts = await d.db.customerNotifyContact.findMany({
    where: { tenantId, customerId },
    select: { email: true, phone: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return {
    kind: "CUSTOMER",
    entity: "customers",
    entityId: customerId,
    customerId,
    input: {
      kind: "CUSTOMER",
      firm: c.tenant.name,
      downloadUrl,
      webFormUrl: form,
      origin: d.publicBaseUrl.replace(/\/+$/, ""),
    },
    allowed: [...CHANNELS_BY_KIND.CUSTOMER],
    recipientsLocked: false,
    recipients: {
      email: dedupe([
        ...(c.email ? [{ value: c.email, source: "customer" as const }] : []),
        ...contacts.map((x) => ({ value: x.email, source: "contact" as const })),
      ]),
      phone: dedupe([
        ...(c.phone ? [{ value: c.phone, source: "customer" as const }] : []),
        ...contacts.flatMap((x) => (x.phone ? [{ value: x.phone, source: "contact" as const }] : [])),
      ]),
    },
    remainingSends: null,
  };
}

export function resolveTarget(d: TargetDeps, auth: AuthContext, tenantId: string, target: SendTarget): Promise<Resolved> {
  switch (target.kind) {
    case "SESSION":
      return resolveSession(d, auth, tenantId, target);
    case "UNATTENDED_CODE":
      return resolveCode(d, auth, tenantId, target);
    case "CUSTOMER":
      return resolveCustomer(d, auth, tenantId, target.customerId);
  }
}
