// Destek talepleri (P8b) REST sözleşmesi — mimari-api "Destek talepleri (P8b)", mimari-e9 §3–§13 (r2), ADR-0016.
// Tek kaynak: sunucu girdileri bu şemalarla doğrular; web aynı tipleri kullanır; Go istemci `fixtures/request-form.json`
// örnekleriyle aynı kuralları uygular (AC-134). Durum makinesi (AC-140) `REQUEST_TRANSITIONS`'ta.
// G-E9-15 (koordinatör kararı a, dba sapması): `knownNetwork: bool` yerine `networkMatch` + `knownDevice` döner.
// P8c (mimari-api "Müşteriler ve bilgisayar kaydı", mimari-e10 §15): `ref` | `bindingKey`, iptal nedenleri, müşteri filtresi,
// `customerFirm`/`viaBinding`/`bindingRevoked`/`staleSource`, tek kayıt iptali.
import { z } from "zod";
import type { CustomerFirmRef } from "./customers.ts";
import { UNSAFE_NAME_CHARS } from "./sessions.ts";

// ---------------------------------------------------------------------------------------------------------------
// Enum'lar ve durum makinesi
// ---------------------------------------------------------------------------------------------------------------

export const REQUEST_STATUSES = ["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED", "REJECTED", "CONNECT_FAILED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
/** Geçmiş sekmesinin durum filtresi: kapanmış durumlar (ACCEPTED son durumdur — admit sonrası değişmez, §3.4). */
export const CLOSED_REQUEST_STATUSES = ["ACCEPTED", "CANCELLED", "EXPIRED", "REJECTED", "CONNECT_FAILED"] as const;
export type ClosedRequestStatus = (typeof CLOSED_REQUEST_STATUSES)[number];

/** P8c: `CUSTOMER_PASSIVE` (müşteri pasife alındı), `BINDING_REVOKED` (r2 §15.2: panelden tek kayıt iptali). */
export const CANCEL_REASONS = ["CUSTOMER", "DISCONNECTED", "TENANT_PASSIVE", "CUSTOMER_PASSIVE", "BINDING_REVOKED"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/**
 * Bilinen ağ sinyali (G-E9-15): `IP` = tam ipKey (IPv4 /32, IPv6 /64) son 90 günde admit edilmiş oturumla eşleşti;
 * `TRUSTED` = Admin'in güvenilen CIDR listesi; `PREFIX` = yalnız /24–/48 öneki eşleşti (nötr, uyarıyı kaldırmaz); `NONE`.
 * Panel rozeti yalnız IP/TRUSTED; hız/kuyruk ayrıcalığı yalnız TRUSTED veya `knownDevice` (sunucu kuralı).
 */
export const NETWORK_MATCHES = ["NONE", "PREFIX", "IP", "TRUSTED"] as const;
export type NetworkMatch = (typeof NETWORK_MATCHES)[number];

/** Güven veren rozet gösterilir mi (G-E9-15). PREFIX nötr metin, "İlk kez görülen kaynak" uyarısını kaldırmaz. */
export const networkBadge = (m: NetworkMatch): boolean => m === "IP" || m === "TRUSTED";
/** Uyarı rozeti ("İlk kez görülen kaynak"): güven veren ağ rozeti ve bilinen cihaz yoksa. */
export const isFirstSeenSource = (m: NetworkMatch, knownDevice: boolean): boolean => !networkBadge(m) && !knownDevice;

/**
 * İzinli geçişler (mimari-e9 §3.4 + §13.3). Diğer her (kaynak, hedef) çifti sunucuda 409 (AC-140).
 * ACCEPTED → CANCELLED yalnız oturum hâlâ PENDING iken (müşteri "Vazgeç"); ACCEPTED admit sonrası son durumdur.
 */
export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  PENDING: ["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"],
  ACCEPTED: ["CONNECT_FAILED", "CANCELLED"],
  CANCELLED: [],
  EXPIRED: [],
  REJECTED: [],
  CONNECT_FAILED: [],
};

export const canTransition = (from: RequestStatus, to: RequestStatus): boolean => REQUEST_TRANSITIONS[from].includes(to);

// ---------------------------------------------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------------------------------------------

/** Tenant başına bekleyen talep üst sınırı ve "yalnız bilinen kaynak" eşiği (AC-143, §13.6). */
export const REQUEST_QUEUE_MAX = 50;
export const REQUEST_QUEUE_KNOWN_ONLY_FROM = 40;
/** Kabul sonrası müşterinin bağlanma (onay dahil) penceresi (AC-155). */
export const REQUEST_CONNECT_WINDOW_SEC = 60;
/** Geçmiş sekmesi penceresi (AC-146). */
export const REQUEST_HISTORY_DAYS = 30;
export const REQUEST_PAGE_SIZE_MAX = 100;
export const REQUEST_WAIT_MIN = 10;
export const REQUEST_WAIT_MAX = 120;
export const REQUEST_WAIT_DEFAULT = 30;
export const REQUEST_RECIPIENTS_MAX = 5;
export const REQUEST_TRUSTED_CIDRS_MAX = 10;
/** Panel bildirimi önizlemesi: açıklamanın ilk 100 kod noktası (§6). */
export const REQUEST_PREVIEW_MAX = 100;

/** Ret için hazır metinler (AC-157; UI'da varsayılan seçili). Hepsi `rejectMessageSchema`'dan geçer (test). */
export const REQUEST_REJECT_PRESETS = [
  "Şu an müsait değiliz, sizi arayacağız",
  "Mesai saatleri dışındayız, sizi arayacağız",
  "Lütfen firmanızı telefonla arayın",
] as const;

/** Kalıcı panel ipucu (§13.1, AC-146). */
export const REQUEST_VERIFY_HINT =
  "Müşteriyi firmanın kayıtlı numarasından arayın (talepteki numaradan değil) ve ekrandaki talep kodunu sorun.";

/** Müşteri metni (AC-143): kuyruk dolu / yeni kaynak eşiği / bekleyen sınırı. */
export const REQUEST_BUSY_MESSAGE = "Şu an çok yoğunuz, lütfen firmanızı telefonla arayın.";

// ---------------------------------------------------------------------------------------------------------------
// Firma dosyası adı → tenantRef (ADR-0006 r4; Go `internal/pairing` aynı ifadeyi kullanır, fixture ortak)
// ---------------------------------------------------------------------------------------------------------------

/** `NoktaDestek-<label>-<ref>.exe` (+ tarayıcının eklediği ` (1)`); önek büyük/küçük harf duyarsız, ref küçük harfe indirilir. */
export const REQUEST_FILE_NAME_RE = /^NoktaDestek-[A-Za-z0-9]{1,20}-([a-z2-7]{16})(?: ?\(\d+\))?\.exe$/i;

export function refFromFileName(fileName: string): string | null {
  const m = REQUEST_FILE_NAME_RE.exec(fileName);
  return m?.[1] ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Ortak alan şemaları (mimari-api "Ortak alan şemaları")
// ---------------------------------------------------------------------------------------------------------------

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const codePoints = (v: string): number => [...v].length;

export const tenantRefSchema = z.string().regex(/^[a-z2-7]{16}$/, "Geçersiz firma bağlantısı");
export const requestCodeSchema = z.string().regex(/^\d{6}$/, "Talep kodu 6 haneli olmalı");
/** 128 bit, base64url 22 karakter; yalnız "hatırla" açıkken istemcide üretilir (§13.1). */
export const deviceKeySchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Geçersiz cihaz anahtarı");
export const clientInstanceSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Geçersiz istemci örneği");
export const clientVersionSchema = z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/, "Geçersiz istemci sürümü");
export const requestSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Geçersiz talep");
export const requestStatusSchema = z.enum(REQUEST_STATUSES);
export const cancelReasonSchema = z.enum(CANCEL_REASONS);
export const networkMatchSchema = z.enum(NETWORK_MATCHES);
/** P8c bilgisayar kaydı anahtarı: `rsb_` + base64url(32 bayt) = 47 karakter (ADR-0017). Asıl dışa aktarım `api/bindings.ts`. */
export const bindingKeySchema = z.string().regex(/^rsb_[A-Za-z0-9_-]{43}$/, "Geçersiz kayıt");
/** P8c talepler filtresi (AC-176): `general` (müşterisiz) ya da müşteri kimliği. */
export const customerFilterSchema = z.union([z.literal("general"), z.string().regex(ULID, "Geçersiz müşteri")]);
export type CustomerFilter = z.infer<typeof customerFilterSchema>;

/** Ad soyad (AC-134): trim, 2..80 kod noktası, Cc/Cf/Zl/Zp yok. */
export const customerNameSchema = z
  .string()
  .max(400)
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Ad görünmez veya kontrol karakteri içeremez")
  .trim()
  .refine((v) => codePoints(v) >= 2, "Ad en az 2 karakter olmalı")
  .refine((v) => codePoints(v) <= 80, "Ad en çok 80 karakter olabilir");

const PHONE_INVALID = "Telefon numarası geçersiz";

/** Telefon → E.164 (`+905xxxxxxxxx`) ya da null (AC-134). Boşluk, `-`, `(`, `)` yok sayılır. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s\-()]/g, "");
  const tr = /^(?:\+90|0)?(5\d{9})$/.exec(s);
  if (tr?.[1]) return `+90${tr[1]}`;
  const intl = /^\+?([1-9]\d{7,14})$/.exec(s);
  return intl?.[1] ? `+${intl[1]}` : null;
}

export const phoneSchema = z
  .string()
  .max(40, PHONE_INVALID)
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: PHONE_INVALID });
      return z.NEVER;
    }
    return n;
  });

/** E-posta (opsiyonel): boş → undefined; ≤ 254, geçerli biçim. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .max(254, "E-posta en çok 254 karakter olabilir")
  .transform((v) => (v === "" ? undefined : v))
  .pipe(z.email("E-posta adresi geçersiz").optional())
  .optional();

/** Açıklamayı tek satıra indirir (r2, G-E9-5): CR/LF/TAB ve tüm boşluk dizileri → tek boşluk, trim. */
export const normalizeDescription = (v: string): string =>
  v
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Sorun açıklaması (AC-134): normalize sonra 10..500 kod noktası; Cc ve bidi/sıfır genişlik Cf yasak. */
export const descriptionSchema = z
  .string()
  .max(2000, "Açıklama en çok 500 karakter olabilir")
  .overwrite(normalizeDescription)
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Açıklama görünmez veya kontrol karakteri içeremez")
  .refine((v) => codePoints(v) >= 10, "Açıklama en az 10 karakter olmalı")
  .refine((v) => codePoints(v) <= 500, "Açıklama en çok 500 karakter olabilir");

export const REJECT_MESSAGE_LINK_ERROR = "Mesaj bağlantı, e-posta veya telefon içeremez";

/** Ret mesajında bağlantı / alan adı / e-posta / telefon izi (G-E9-12). */
export function hasContactLike(v: string): boolean {
  if (v.includes("://") || /www\./i.test(v) || v.includes("@")) return true;
  if (/[a-z0-9-]+\.[a-z]{2,}/i.test(v)) return true;
  return /\d{7,}/.test(v.replace(/[\s-]/g, ""));
}

/** Ret mesajı (AC-157): trim, tek satır, 5..200, Cc/Cf yasak, bağlantı/e-posta/telefon yok. */
export const rejectMessageSchema = z
  .string()
  .max(800, "Mesaj en çok 200 karakter olabilir")
  .trim()
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Mesaj tek satır olmalı; görünmez veya kontrol karakteri içeremez")
  .refine((v) => codePoints(v) >= 5, "Mesaj en az 5 karakter olmalı")
  .refine((v) => codePoints(v) <= 200, "Mesaj en çok 200 karakter olabilir")
  .refine((v) => !hasContactLike(v), REJECT_MESSAGE_LINK_ERROR);

// --- Güvenilen CIDR (§13.6): saf TS (web de kullanır; node:net yok) ---

function parseIPv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || (p.length > 1 && p.startsWith("0"))) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** IPv6 → 8 adet 16 bitlik grup; gömülü IPv4 ve zone id desteklenmez (CIDR girdisi için gerekmez). */
function parseIPv6(s: string): number[] | null {
  if (!/^[0-9a-fA-F:]+$/.test(s) || s.includes(":::")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const side = (h: string): string[] | null => (h === "" ? [] : h.split(":"));
  const left = side(halves[0] ?? "");
  const right = halves.length === 2 ? side(halves[1] ?? "") : [];
  if (!left || !right) return null;
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < (halves.length === 2 ? 1 : 0) || left.length + right.length + fill !== 8) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function formatIPv6(g: number[]): string {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = g.map((n) => n.toString(16));
  if (bestStart < 0) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`;
}

const maskBits = (values: number[], width: number, prefix: number): number[] =>
  values.map((v, i) => {
    const keep = Math.max(0, Math.min(width, prefix - i * width));
    return keep === 0 ? 0 : v & (((1 << width) - 1) ^ ((1 << (width - keep)) - 1));
  });

const inV4 = (a: number[], net: [number, number, number, number], bits: number): boolean => {
  const m = maskBits(a, 8, bits);
  return m.every((v, i) => v === maskBits(net, 8, bits)[i]);
};

/** Özel/loopback/link-local/CGNAT/belgeleme dışı olmayan (sunucunun göremeyeceği) aralıklar (§13.6). */
function isNonPublicV4(a: number[]): boolean {
  return (
    inV4(a, [0, 0, 0, 0], 8) ||
    inV4(a, [10, 0, 0, 0], 8) ||
    inV4(a, [100, 64, 0, 0], 10) ||
    inV4(a, [127, 0, 0, 0], 8) ||
    inV4(a, [169, 254, 0, 0], 16) ||
    inV4(a, [172, 16, 0, 0], 12) ||
    inV4(a, [192, 168, 0, 0], 16) ||
    (a[0] ?? 0) >= 224
  );
}

function isNonPublicV6(g: number[]): boolean {
  const first = g[0] ?? 0;
  if (g.every((v, i) => (i < 7 ? v === 0 : true))) return true; // ::, ::1
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return g.slice(0, 5).every((v) => v === 0) && g[5] === 0xffff; // ::ffff:0:0/96 (IPv4-mapped)
}

export type CidrCheck = { ok: true; cidr: string } | { ok: false; message: string };

/** CIDR doğrulama + ağ adresine normalize (ör. `203.0.113.7/24` → `203.0.113.0/24`). */
export function checkTrustedCidr(raw: string): CidrCheck {
  const v = raw.trim();
  const [addr = "", bitsRaw, ...rest] = v.split("/");
  if (bitsRaw === undefined || rest.length > 0 || !/^\d{1,3}$/.test(bitsRaw))
    return { ok: false, message: "CIDR biçiminde olmalı (ör. 203.0.113.0/24)" };
  const bits = Number(bitsRaw);
  const v4 = parseIPv4(addr);
  if (v4) {
    if (bits > 32) return { ok: false, message: "IPv4 önek uzunluğu en çok 32 olabilir" };
    if (bits < 16) return { ok: false, message: "IPv4 aralığı en geniş /16 olabilir" };
    const net = maskBits(v4, 8, bits);
    if (isNonPublicV4(net)) return { ok: false, message: "Özel, yerel veya ayrılmış adres aralığı eklenemez" };
    return { ok: true, cidr: `${net.join(".")}/${bits}` };
  }
  const v6 = parseIPv6(addr);
  if (v6) {
    if (bits > 128) return { ok: false, message: "IPv6 önek uzunluğu en çok 128 olabilir" };
    if (bits < 32) return { ok: false, message: "IPv6 aralığı en geniş /32 olabilir" };
    const net = maskBits(v6, 16, bits);
    if (isNonPublicV6(net)) return { ok: false, message: "Özel, yerel veya ayrılmış adres aralığı eklenemez" };
    return { ok: true, cidr: `${formatIPv6(net)}/${bits}` };
  }
  return { ok: false, message: "CIDR biçiminde olmalı (ör. 203.0.113.0/24)" };
}

export const trustedCidrSchema = z
  .string()
  .max(60, "CIDR biçiminde olmalı (ör. 203.0.113.0/24)")
  .transform((v, ctx) => {
    const r = checkTrustedCidr(v);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.message });
      return z.NEVER;
    }
    return r.cidr;
  });

const uniqueList = <T extends z.ZodType<string>>(item: T, max: number, label: string) =>
  z
    .array(item)
    .max(max, `En çok ${max} ${label} eklenebilir`)
    .superRefine((list, ctx) => {
      const seen = new Set<string>();
      list.forEach((v, i) => {
        if (seen.has(v)) ctx.addIssue({ code: "custom", path: [i], message: "Aynı değer iki kez eklenemez" });
        seen.add(v);
      });
    });

// ---------------------------------------------------------------------------------------------------------------
// Public uçlar (çerezsiz)
// ---------------------------------------------------------------------------------------------------------------

/** GET /public/requests/tenant?ref= ve GET /public/agent/request-download?ref= */
export const tenantRefQuerySchema = z.strictObject({ ref: tenantRefSchema });

/** GET /public/requests/tenant yanıtı (AC-133, 135, §13.4). */
export interface TenantRequestInfo {
  tenant: { name: string; logoUrl: string | null };
  consentText: { id: string; version: number; body: string; sha256: string };
  waitMinutes: number;
  abuseEmail: string | null;
  /** `MIN_AGENT_VERSION`; boşsa null (istemci açılışta karşılaştırır). */
  minAgentVersion: string | null;
}

/**
 * POST /public/requests (AC-134, 135, 139; P8c AC-176, 182, 191): `ref` (Genel ya da müşteri ref'i) **ya da** `bindingKey`
 * — tam biri. 0.9.x istemci yalnız `ref` gönderir (gövde aynen geçer).
 */
export const createRequestInputSchema = z
  .strictObject({
    ref: tenantRefSchema.optional(),
    bindingKey: bindingKeySchema.optional(),
    clientInstanceId: clientInstanceSchema,
    clientVersion: clientVersionSchema,
    customerName: customerNameSchema,
    phone: phoneSchema,
    email: optionalEmailSchema,
    description: descriptionSchema,
    consentTextId: z.string().regex(ULID, "Aydınlatma metni geçersiz"),
    consentAccepted: z.literal(true, "Aydınlatma metni onaylanmalı"),
    deviceKey: deviceKeySchema.optional(),
  })
  .superRefine((b, ctx) => {
    if ((b.ref === undefined) === (b.bindingKey === undefined))
      ctx.addIssue({ code: "custom", path: ["ref"], message: "Firma bağlantısı ya da bilgisayar kaydından tam biri gerekli" });
  });
export type CreateRequestInput = z.input<typeof createRequestInputSchema>;
export type CreateRequestData = z.output<typeof createRequestInputSchema>;

export interface CreateRequestResponse {
  requestId: string;
  /** 43 karakter; yalnız bu yanıtta döner (diske/loga yazılmaz). `/ws/request` subprotocol'ünde `rs.req.<sır>`. */
  requestSecret: string;
  requestCode: string;
  expiresAt: string;
  position: number;
}

/** POST /public/requests/cancel (AC-141, §13.3). Yanıt her durumda 204 (sır oracle'ı yok). */
export const cancelRequestInputSchema = z.strictObject({ requestSecret: requestSecretSchema });
export type CancelRequestInput = z.infer<typeof cancelRequestInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Panel uçları (çerez; tenantScope)
// ---------------------------------------------------------------------------------------------------------------

export const REQUEST_TABS = ["pending", "history"] as const;
export type RequestTab = (typeof REQUEST_TABS)[number];

/** GET /support-requests (AC-146). `pending`'de sayfalama yok sayılır (≤ 50); `status` yalnız `history`'de. */
export const listRequestsQuerySchema = z
  .strictObject({
    tab: z.enum(REQUEST_TABS).default("pending"),
    status: z.enum(CLOSED_REQUEST_STATUSES).optional(),
    /** P8c (AC-176): `general` | müşteri kimliği; kuyruk ve geçmişte. */
    customer: customerFilterSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(REQUEST_PAGE_SIZE_MAX).default(25),
  })
  .superRefine((q, ctx) => {
    if (q.status && q.tab !== "history")
      ctx.addIssue({ code: "custom", path: ["status"], message: "Durum filtresi yalnız geçmiş sekmesinde kullanılır" });
  });
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

export interface SupportRequestItem {
  id: string;
  requestCode: string;
  /** G-E9-15: rozet `networkBadge()`; PREFIX nötr metin. */
  networkMatch: NetworkMatch;
  knownDevice: boolean;
  status: RequestStatus;
  cancelReason: CancelReason | null;
  createdAt: string;
  closedAt: string | null;
  /** Kapalıysa (accepted_at ?? closed_at) − created_at; açıksa now − created_at (saniye, aşağı yuvarlanmış). */
  waitSec: number;
  /** Anonimleştirilmiş kayıtta PII null. */
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  description: string | null;
  clientVersion: string;
  acceptedBy: { id: string; name: string } | null;
  rejectMessage: string | null;
  sessionId: string | null;
  /** P8c (AC-175, 176): müşteri firma; null = Genel. */
  customerFirm: CustomerFirmRef | null;
  /** r2 (§15.1): kayıtla açıldı **ve** kayıt hâlâ etkin → "Kayıtlı bilgisayar — <firma | Genel>" rozeti. */
  viaBinding: boolean;
  /** r2 (§15.1): kayıtla açıldı, kayıt artık geçersiz → uyarı rozeti "Kaydı iptal edilmiş bilgisayar". */
  bindingRevoked: boolean;
  /** r2 (§15.1): ref yenilemesinden önce açıldı ya da kaydı iptal edildi → "Bu talep bağlantı yenilenmeden önce açıldı". */
  staleSource: boolean;
}

export interface SupportRequestListResponse {
  items: SupportRequestItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SupportRequestCountResponse {
  pending: number;
}

export const acceptRequestInputSchema = z.strictObject({});
export interface AcceptRequestResponse {
  sessionId: string;
  consoleUrl: string;
}

/** POST /support-requests/:id/revoke-binding (r2 §15.2, G-E10-2): gövde `{}`; kayıt talebin `binding_id`'sinden bulunur. */
export const revokeBindingInputSchema = z.strictObject({});

export const rejectRequestInputSchema = z.strictObject({ message: rejectMessageSchema });
export type RejectRequestInput = z.infer<typeof rejectRequestInputSchema>;

// --- Ayarlar (settings.edit) ---

export interface SupportRequestSettings {
  /** `${PUBLIC_BASE_URL}/api/v1/public/agent/request-download?ref=<ref>` */
  downloadUrl: string;
  /** `NoktaDestek-<fileLabel>-<ref>.exe` */
  fileName: string;
  refPrefix: string;
  refRotatedAt: string | null;
  waitMinutes: number;
  trustedCidrs: string[];
  whatsapp: { enabled: boolean; recipients: string[]; serviceConfigured: boolean; insecure: boolean };
  email: { enabled: boolean; recipients: string[]; smtpConfigured: boolean };
}

/** PUT /settings/support-requests (AC-142, 152). Mevcut bekleyenlerin `expires_at`'i değişmez. */
export const updateRequestSettingsInputSchema = z
  .strictObject({
    waitMinutes: z
      .number()
      .int("Tam sayı olmalı")
      .min(REQUEST_WAIT_MIN, `En az ${REQUEST_WAIT_MIN} dakika`)
      .max(REQUEST_WAIT_MAX, `En çok ${REQUEST_WAIT_MAX} dakika`),
    trustedCidrs: uniqueList(trustedCidrSchema, REQUEST_TRUSTED_CIDRS_MAX, "aralık"),
    whatsapp: z.strictObject({ enabled: z.boolean(), recipients: uniqueList(phoneSchema, REQUEST_RECIPIENTS_MAX, "alıcı") }),
    email: z.strictObject({
      enabled: z.boolean(),
      recipients: uniqueList(z.string().trim().max(254).pipe(z.email("E-posta adresi geçersiz")), REQUEST_RECIPIENTS_MAX, "alıcı"),
    }),
  })
  .superRefine((s, ctx) => {
    if (s.whatsapp.enabled && s.whatsapp.recipients.length === 0)
      ctx.addIssue({ code: "custom", path: ["whatsapp", "recipients"], message: "Kanal açıkken en az bir alıcı girin" });
    if (s.email.enabled && s.email.recipients.length === 0)
      ctx.addIssue({ code: "custom", path: ["email", "recipients"], message: "Kanal açıkken en az bir alıcı girin" });
  });
export type UpdateRequestSettingsInput = z.input<typeof updateRequestSettingsInputSchema>;
export type UpdateRequestSettingsData = z.output<typeof updateRequestSettingsInputSchema>;

export const SMTP_REQUIRED_MESSAGE = "Önce SMTP ayarlarını yapın";

export const rotateRefInputSchema = z.strictObject({});

/** POST /settings/support-requests/whatsapp/test (AC-152). */
export const whatsappTestInputSchema = z.strictObject({ phone: phoneSchema });
export type WhatsappTestInput = z.input<typeof whatsappTestInputSchema>;
export interface WhatsappTestResponse {
  ok: boolean;
  message: string;
}

/**
 * P10 (AC-151): POST /settings/support-requests/email/test — bildirim e-postası örneğini tenant SMTP'siyle gönderir.
 * 5/dk/tenant (SMTP testiyle ortak kova); SMTP yok → 502 `UPSTREAM` "Önce SMTP ayarlarını yapın"; gönderim hatası
 * 200 `{ ok: false, message }` (WhatsApp testiyle aynı biçim; mesaj genel).
 */
export const emailTestInputSchema = z.strictObject({
  to: z.string().trim().max(254, "E-posta en çok 254 karakter olabilir").pipe(z.email("E-posta adresi geçersiz")),
});
export type EmailTestInput = z.input<typeof emailTestInputSchema>;
export type EmailTestResponse = WhatsappTestResponse;
