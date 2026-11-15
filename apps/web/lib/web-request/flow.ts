/*
 * P19 (AC-259; mimari-e11 §8c.2): herkese açık web talep formu `/r/<ref>` — saf yardımcılar (bileşenlerden ayrı, testli).
 * Kurallar: talep sırrı YALNIZ sessionStorage (`rs.wr.<ref>`, sekme kapsamı); form token'ı alındıktan `minDelayMs` (2 sn)
 * geçmeden gönderilmez; her 4xx/429/503 sonrası yeni token alınır ve sayaç yeniden kurulur (S-P19-T4).
 */
import {
  requestSecretSchema,
  webRequestInputSchema,
  type NotifyChoice,
  type WebFormInfo,
  type WebRequestData,
} from "@remote/contracts/api/requests";
import { WS_SUBPROTOCOL } from "@remote/contracts/ws";
import { WS_REQUEST_CAP_CHAT, WS_REQUEST_PREFIX } from "@remote/contracts/ws-request";
import { ApiError } from "@/lib/api";

export const storeKeyOf = (ref: string): string => `rs.wr.${ref}`;

export interface StoredRequest {
  requestSecret: string;
  requestCode: string;
  customerName: string;
}

export function readStored(ref: string, store: Pick<Storage, "getItem"> | null): StoredRequest | null {
  try {
    const raw = store?.getItem(storeKeyOf(ref));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredRequest>;
    if (!requestSecretSchema.safeParse(v.requestSecret).success || typeof v.requestCode !== "string") return null;
    return { requestSecret: v.requestSecret!, requestCode: v.requestCode, customerName: String(v.customerName ?? "") };
  } catch {
    return null;
  }
}

/** `/ws/request` alt protokolleri: `rs.v1, rs.req.<sır>, rs.cap.chat1` (tarayıcı her zaman sohbet yeteneği bildirir). */
export const requestProtocols = (secret: string): string[] => [WS_SUBPROTOCOL, WS_REQUEST_PREFIX + secret, WS_REQUEST_CAP_CHAT];

/** 22 karakter base64url (128 bit) — `clientInstanceSchema`. */
export function newClientInstanceId(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = rand(16);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Token alındıktan sonra gönderime kalan bekleme (ms, ≥ 0). */
export const remainingDelay = (issuedAt: number, now: number, minDelayMs: number): number => Math.max(0, issuedAt + minDelayMs - now);

export interface FormDraft {
  customerName: string;
  phone: string;
  email: string;
  description: string;
  consent: boolean;
  notify: NotifyChoice;
  /** Gizli alan; insan boş bırakır. */
  website: string;
}

export const emptyDraft = (): FormDraft => ({
  customerName: "",
  phone: "",
  email: "",
  description: "",
  consent: false,
  notify: { sms: false, whatsapp: false, email: false },
  website: "",
});

/** Taslak → POST gövdesi (contracts zod, sunucuyla aynı kural). Yalnız firmanın açtığı kanallar `true` olabilir. */
export function buildWebRequest(
  d: FormDraft,
  ctx: { ref: string; formToken: string; clientInstanceId: string; info: Pick<WebFormInfo, "consentText" | "channels"> },
): { body?: WebRequestData; errors: Record<string, string> } {
  const notify = {
    sms: d.notify.sms && ctx.info.channels.sms,
    whatsapp: d.notify.whatsapp && ctx.info.channels.whatsapp,
    email: d.notify.email && ctx.info.channels.email,
  };
  const r = webRequestInputSchema.safeParse({
    ref: ctx.ref,
    formToken: ctx.formToken,
    website: d.website,
    clientInstanceId: ctx.clientInstanceId,
    customerName: d.customerName,
    phone: d.phone,
    email: d.email.trim() === "" ? undefined : d.email,
    description: d.description,
    consentTextId: ctx.info.consentText.id,
    consentAccepted: d.consent,
    notify,
  });
  if (r.success) return { body: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? "form");
    const key = k === "consentAccepted" ? "consent" : k;
    errors[key] ??= i.message;
  }
  return { errors };
}

export type SubmitFailure =
  | { kind: "fields"; fields: Record<string, string> }
  | { kind: "fast"; message: string }
  | { kind: "token"; message: string }
  | { kind: "busy"; message: string }
  | { kind: "outsideHours"; message: string }
  | { kind: "notFound" }
  | { kind: "other"; message: string };

/**
 * POST hatası → ekran. `refreshToken`: sunucu token'ı harcamış olabilir (her 4xx/429/503) → yeni `GET …/form`.
 * < 2 sn 429 `RATE_LIMITED` token'ı harcamaz ama yeniden almak da güvenlidir (sayaç yeniden kurulur).
 */
export function submitFailure(e: unknown, fallback: string): { failure: SubmitFailure; refreshToken: boolean } {
  if (!(e instanceof ApiError)) return { failure: { kind: "other", message: fallback }, refreshToken: false };
  const refreshToken = (e.status >= 400 && e.status < 500) || e.status === 503;
  if (e.status === 404) return { failure: { kind: "notFound" }, refreshToken };
  if (e.code === "FORM_TOKEN_INVALID") return { failure: { kind: "token", message: e.message }, refreshToken };
  if (e.code === "OUTSIDE_HOURS") return { failure: { kind: "outsideHours", message: e.message }, refreshToken };
  if (e.code === "QUEUE_FULL") return { failure: { kind: "busy", message: e.message }, refreshToken };
  if (e.status === 429) return { failure: { kind: "fast", message: e.message }, refreshToken };
  if (e.status === 400 && e.fields && Object.keys(e.fields).length) return { failure: { kind: "fields", fields: e.fields }, refreshToken };
  return { failure: { kind: "other", message: e.message || fallback }, refreshToken };
}

/** `/ws/request` kapanışı: 4xxx (sır geçersiz/tür uyuşmazlığı/değiştirildi) ve 1008 → dur; diğerleri yeniden bağlan. */
export const shouldReconnect = (code: number): boolean => !(code === 1008 || (code >= 4000 && code < 5000));
/** Yeniden bağlanma gecikmesi: 1 → 30 sn üstel. */
export const reconnectDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, 30_000);
