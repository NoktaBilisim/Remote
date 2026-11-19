/*
 * P21 K-P21-2: portal "Yeni destek talebi" kaynağı — P19 form bileşeni aynen, uçlar `GET /portal/request-form` +
 * `POST /portal/requests`. Gövde `portalRequestInputSchema` ile (strict: ref/formToken/website/customerId → 400; müşteri ve
 * ref yalnız sunucuda oturumdan kurulur, r2 S-P21-1). Bot kapısı yok → token boş, bekleme 0.
 */
import type { PortalMe, PortalRequestFormInfo } from "@remote/contracts/api/portal";
import { portalRequestInputSchema } from "@remote/contracts/api/portal";
import type { CreateRequestResponse, WebFormInfo } from "@remote/contracts/api/requests";
import type { FormDraft } from "@/lib/web-request/flow";
import type { RequestBody, WebRequestSource } from "@/lib/web-request/source";
import { portalApi } from "./api";

/** Sekme deposu anahtarı portal kullanıcısına bağlı: aynı sekmede başka hesap önceki talep sırrını devralmaz. */
export const portalStoreKey = (portalUserId: string): string => `rs.wr.portal.${portalUserId}`;

export const portalFormInfo = (i: PortalRequestFormInfo): WebFormInfo => ({ ...i, formToken: "", minDelayMs: 0 });

/** Taslak → `POST /portal/requests` gövdesi (sunucuyla aynı zod). Yalnız firmanın açtığı kanallar `true` olabilir. */
export function buildPortalRequest(
  d: FormDraft,
  clientInstanceId: string,
  info: Pick<WebFormInfo, "consentText" | "channels">,
): { body?: RequestBody; errors: Record<string, string> } {
  const r = portalRequestInputSchema.safeParse({
    clientInstanceId,
    customerName: d.customerName,
    phone: d.phone,
    email: d.email.trim() === "" ? undefined : d.email,
    description: d.description,
    consentTextId: info.consentText.id,
    consentAccepted: d.consent,
    notify: {
      sms: d.notify.sms && info.channels.sms,
      whatsapp: d.notify.whatsapp && info.channels.whatsapp,
      email: d.notify.email && info.channels.email,
    },
  });
  if (r.success) return { body: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? "form");
    errors[k === "consentAccepted" ? "consent" : k] ??= i.message;
  }
  return { errors };
}

export function portalRequestSource(me: PortalMe, onGateError: (e: unknown) => boolean): WebRequestSource {
  return {
    storeKey: portalStoreKey(me.user.id),
    loadInfo: async () => portalFormInfo(await portalApi<PortalRequestFormInfo>("GET", "/portal/request-form")),
    build: (d, id, info) => buildPortalRequest(d, id, info),
    create: (body) => portalApi<CreateRequestResponse>("POST", "/portal/requests", body),
    downloadHref: me.links.downloadUrl,
    initialDraft: { customerName: me.user.fullName, email: me.user.email },
    framed: false,
    onGateError,
  };
}
