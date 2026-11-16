// WS sinyalizasyon sözleşmesi (docs/mimari-protokol.md §1–3, P3 kapsamı). Tek kaynak: sunucu gelen her
// mesajı bu şemalarla doğrular (strict — ekstra alan reddedilir); Go istemci aynı sözleşmeyi
// `packages/contracts/fixtures/ws-messages.json` örnekleriyle doğrular (ADR-0004).
// P5: quality.summary, file.meta (+ hello/peer.joined `maxFileMb`). P7: control.request/state/revoke, monitor.request,
// env.state, caps.update (mimari-protokol §3, akış A3/A5). P7 düzeltme 1 (§3.3, ADR-0013): control.release/cancel,
// monitor.denied, kaynak `TECH`, revoke nedenleri `reconnect`/`stale`, misafir kaynak kısıtı.
// P28a (mimari-p28 §4.2–4.3): pano/yazdırma tipleri `ws-clip-print.ts`'te; burada yalnız birlik bağlantısı + `CAPS` +
// `guestFeatures`/`clipConsent` alanları. P28b (mimari-p28b §5): `fsrv.*` tipleri `ws-fsrv.ts`'te; burada birlik bağlantısı +
// `hello`/`peer.joined` `fileMode` + `guestFeatures` `fsrv` değeri.
import { z } from "zod";
import { guestClipInbound, guestPrintInbound, serverClipPrintOutbound, techClipPrintInbound, type GuestFeature } from "./ws-clip-print.ts";
import { FILE_MODES, fsrvInbound, PEER_FEATURES, serverFsrvOutbound } from "./ws-fsrv.ts";
import { CONSENT_MODES } from "./unattended-consent.ts";

export const WS_SUBPROTOCOL = "rs.v1";
export const WS_TICKET_PREFIX = "rs.ticket.";
export const WS_RECONNECT_PREFIX = "rs.reconnect.";
/** Tek mesaj üst sınırı (AC-17); aşım → 1009 (ws maxPayload, S-P3-1). */
export const WS_MAX_PAYLOAD = 64 * 1024;

/** Kapanış kodları (RFC 6455 + uygulama). */
export const WS_CLOSE = { NORMAL: 1000, POLICY: 1008, TOO_BIG: 1009, AUTH_REVOKED: 4401, REPLACED: 4409 } as const;

export const GUEST_KINDS = ["BROWSER", "AGENT"] as const;
export type GuestKind = (typeof GUEST_KINDS)[number];

export const SESSION_ENDED_REASONS = [
  "tech",
  "customer",
  "timeout",
  "max_duration",
  "cancelled",
  "tenant_passive",
  "server",
  "admin",
  "auth_revoked",
  "rejected",
  "lobby_timeout",
  // P27 (mimari-p27 §4.4, §4.6): gözetimsiz oda bitişleri. `permission` = cihaz yetkisi / `unattended.connect` geri alındı.
  "permission",
  "device_revoked",
  "local_disabled",
  "indicator_failed",
  "device_timeout",
  "session_changed",
  // P28u (mimari-p28u §6.2): kullanıcı onay diyaloğunu reddetti / 60 sn yanıt vermedi; `ask` odası onay sonucu olmadan
  // `/ws/guest`'e geldi (K-P28u-3).
  "consent_denied",
  "consent_timeout",
  "consent_missing",
] as const;
export type SessionEndedReason = (typeof SESSION_ENDED_REASONS)[number];

/** P7: `INTERNAL` — sunucu kaydı yazamadı (ör. kontrol verme audit'i; fail-closed, G-15). Mesaj referans kimliği taşır. */
export const WS_ERROR_CODES = [
  "ADMIT_CODE_INVALID",
  "CONFLICT",
  "FORBIDDEN",
  "RATE_LIMITED",
  "NOT_FOUND",
  "VALIDATION",
  "INTERNAL",
  /** P20 (§6.1): `full: true` isteğinde oturum firmasının kaydı yok — kayıt verilmez, oturum sürer. */
  "BINDING_LIMIT",
] as const;
export type WsErrorCode = (typeof WS_ERROR_CODES)[number];

/**
 * P28a (§4.1, G-09): `clipboard` ← `remote_control.clipboard`, `print` ← `file_transfer.print`. Misafire giden `hello.caps` /
 * `caps.update` yeni değerleri yalnız misafir ilgili özelliği bildirdiyse içerir (eski istemciye bugünkü iki değer).
 */
export const CAPS = ["remote_control", "file_transfer", "clipboard", "print"] as const;
export type Cap = (typeof CAPS)[number];

const id = z.string().max(26).optional();
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const iso = z.iso.datetime();

// --- İstemci → sunucu ---
const sdp = z.string().min(1).max(60_000);
export const sdpOfferSchema = z.strictObject({ t: z.literal("sdp.offer"), id, sdp });
export const sdpAnswerSchema = z.strictObject({ t: z.literal("sdp.answer"), id, sdp });
export const iceSchema = z.strictObject({
  t: z.literal("ice"),
  id,
  candidate: z.string().max(2000),
  sdpMid: z.string().max(32).optional(),
  sdpMLineIndex: z.number().int().min(0).max(16).optional(),
});
export const iceRestartSchema = z.strictObject({ t: z.literal("ice.restart"), id });
export const sessionEndSchema = z.strictObject({ t: z.literal("session.end"), id });
export const guestAdmitSchema = z.strictObject({ t: z.literal("guest.admit"), id, admitCode: z.string().regex(/^\d{4}$/) });
export const guestRejectSchema = z.strictObject({ t: z.literal("guest.reject"), id, guestId: ulid });
/**
 * P15 (AC-234, S17-2): paylaşım başlatılamadı / yayında kalıcı hata nedeni. İstemcinin sabit kodu (Go `capture.Reason`;
 * ör. `DXGI_UNSUPPORTED`, `NO_H264_ENCODER`, `OTHER`). Enum DEĞİL: yeni istemcinin bilinmeyen kodu mesajı düşürmesin —
 * konsol `SHARE_FAIL_REASON_LABELS`'ta yoksa ham gösterir. Büyük harf/rakam/alt çizgi, ≤ 32 (kişisel veri taşıyamaz).
 */
export const SHARE_FAIL_REASON_PATTERN = /^[A-Z0-9_]{1,32}$/;
/** P15 (AC-234): son denenen yakalama yolu. `WGC` P17 pencere modu (AC-248). */
export const SHARE_METHODS = ["DXGI", "GDI", "WGC"] as const;
export type ShareMethod = (typeof SHARE_METHODS)[number];
/** P15 (S17-2): sunucu oda başına `share.state` iletimini bu aralıkla sınırlar; aradakiler birleştirilip sonuncusu iletilir. */
export const SHARE_STATE_MIN_INTERVAL_MS = 1_000;

export const shareStateSchema = z.strictObject({
  t: z.literal("share.state"),
  id,
  state: z.enum(["sharing", "stopped"]),
  /** P15 (AC-234): isteğe bağlı — 0.10.x istemci göndermez. */
  reason: z.string().regex(SHARE_FAIL_REASON_PATTERN).optional(),
  method: z.enum(SHARE_METHODS).optional(),
  monitors: z
    .array(
      z.strictObject({
        id: z.number().int().min(0).max(64),
        name: z.string().max(64),
        w: z.number().int().min(1).max(16384),
        h: z.number().int().min(1).max(16384),
        primary: z.boolean(),
      }),
    )
    .max(16)
    .optional(),
  activeMonitor: z.number().int().min(0).max(64).optional(),
});

// --- P5: dosya meta verisi + kalite özeti (mimari-protokol §3; AC-46, AC-55) ---
export const FILE_DIRECTIONS = ["TO_CUSTOMER", "TO_TECH"] as const;
export type FileDirection = (typeof FILE_DIRECTIONS)[number];
export const FILE_RESULTS = ["OK", "REJECTED", "CANCELLED", "CORRUPT"] as const;
export type FileResult = (typeof FILE_RESULTS)[number];
/** Tenant `max_file_mb` tavanı (bayt) — DB CHECK ile aynı. */
const FILE_SIZE_CAP = 2048 * 1024 * 1024;

/**
 * İçerik asla WS'den geçmez (AC-55). P15 (AC-238): `fid` varsa iki tarafın raporu da `session_files`'a yazılır
 * (`reported_by` TECH|CUSTOMER); `fid` yoksa yalnız **alıcı tarafın** raporu (P5 kuralı).
 * `fileName` ham gelir; sunucu `sanitizeFileName` uygular.
 */
export const fileMetaSchema = z.strictObject({
  t: z.literal("file.meta"),
  id,
  /**
   * P15 (AC-238): DC transfer kimliği (`file.offer.fid`, gönderen üretir). Varsa iki tarafın raporu ayrı satır olarak
   * yazılır ve `match_key` ile eşlenir; yoksa (0.10.x) eski kural: yalnız alıcının raporu satır olur.
   */
  fid: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,26}$/)
    .optional(),
  direction: z.enum(FILE_DIRECTIONS),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(0).max(FILE_SIZE_CAP),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  result: z.enum(FILE_RESULTS),
});
export type FileMeta = z.infer<typeof fileMetaSchema>;

const stat = (max: number) =>
  z.strictObject({ avg: z.number().min(0).max(max), min: z.number().min(0).max(max), max: z.number().min(0).max(max) });
/** AC-46: oturum kalite özeti; teknisyen 60 sn'de bir ve oturum sonunda gönderir, sunucu üzerine yazar. */
export const qualitySummarySchema = z.strictObject({
  t: z.literal("quality.summary"),
  id,
  fps: stat(240),
  kbps: stat(1_000_000),
  rttMs: stat(60_000),
  connType: z.enum(["host", "srflx", "relay"]),
});
export type QualitySummary = Omit<z.infer<typeof qualitySummarySchema>, "t" | "id">;

// --- P7: uzaktan kontrol (mimari-protokol §3, §4.3; akış A3, A5; AC-43, 47–51, 99–105, 111, 115, 116) ---
/** Müşteri tarafındaki izin durumu. İzin kararı istemcide (Go `gate`); sunucu kaydeder ve iletir. */
export const CONTROL_STATES = ["VIEW", "GRANTED"] as const;
export type ControlState = (typeof CONTROL_STATES)[number];
/**
 * `DENIED` = diyalogda "Reddet"; `RECONNECT` = yeniden bağlanmada sıfırlama; `SYSTEM` = `control.revoke` sonrası;
 * `TECH` = teknisyen bıraktı/iptal etti (§3.3 K1–K2). `RECONNECT` ve `TECH` yalnız sunucu üretir. P27: `UNATTENDED` =
 * gözetimsiz yardımcının otomatik GRANTED'ı (AC-273) — sunucu yalnız `room.unattended` odasında kabul eder (başka oda: hata + audit).
 */
export const CONTROL_SOURCES = ["UI", "HOTKEY", "DENIED", "RECONNECT", "SYSTEM", "TECH", "UNATTENDED"] as const;
export type ControlSource = (typeof CONTROL_SOURCES)[number];
/** Misafirden kabul edilen kaynaklar (§3 tablo, S7-10): GRANTED yalnız UI; VIEW yalnız bu küme. */
export const GUEST_VIEW_SOURCES = ["UI", "HOTKEY", "DENIED", "SYSTEM"] as const;
export type GuestControlSource = (typeof GUEST_VIEW_SOURCES)[number];
/** Misafirden GRANTED kaynağı: `UI` (yerel "İzin ver"); P27 `UNATTENDED` yalnız gözetimsiz odada geçerli (oda denetimi sunucuda). */
const GUEST_GRANT_SOURCES: readonly ControlSource[] = ["UI", "UNATTENDED"];
/**
 * Sunucu kaynaklı kapatma nedeni (§3.3). İstemci her nedende aynı davranır (kapıyı kapatır); yeni neden buraya eklenir.
 * `reconnect` = teknisyen bağlantısı gitti / sekme değişti (K3); `stale` = sunucu VIEW iken gelen GRANTED (K2).
 */
export const CONTROL_REVOKE_REASONS = ["permission", "audit", "admin", "reconnect", "stale"] as const;
export type ControlRevokeReason = (typeof CONTROL_REVOKE_REASONS)[number];
/** G-03 / AC-116: oturum başına iletilen en çok istek ve ret sonrası bekleme (control.request ve monitor.request ayrı sayılır). */
export const CONTROL_REQUEST_MAX = 5;
export const CONTROL_DENY_COOLDOWN_MS = 30_000;
/** Monitör kimliği aralığı (`share.state.monitors[].id` ile aynı). */
const monitorId = z.number().int().min(0).max(64);

export const controlRequestSchema = z.strictObject({ t: z.literal("control.request"), id });
export const monitorRequestSchema = z.strictObject({ t: z.literal("monitor.request"), id, monitorId });
/** tech → S → guest (§3.3 K1): teknisyen kontrolü bırakır; istemci kapıyı kapatır, yanıt göndermez. */
export const controlReleaseSchema = z.strictObject({ t: z.literal("control.release"), id });
/** tech → S → guest (§3.3 K2): bekleyen isteği geri çeker; GRANTED iken bırakma sayılır. */
export const controlCancelSchema = z.strictObject({ t: z.literal("control.cancel"), id });
/**
 * guest → S → tech. `GRANTED` yalnız `UI` (yerel "İzin ver") ya da P27 `UNATTENDED`; `VIEW` yalnız `UI|HOTKEY|DENIED|SYSTEM`.
 * `RECONNECT`/`TECH` yalnız sunucu üretir — misafirden gelirse şema hatası → 1008 (S7-10).
 */
export const controlStateSchema = z
  .strictObject({ t: z.literal("control.state"), id, state: z.enum(CONTROL_STATES), source: z.enum(CONTROL_SOURCES) })
  .refine(
    (m) => (m.state === "GRANTED" ? GUEST_GRANT_SOURCES.includes(m.source) : (GUEST_VIEW_SOURCES as readonly string[]).includes(m.source)),
    {
      message: "Misafir kaynağı geçersiz",
    },
  );
/** guest(AGENT) → S → tech (§3.3 K4): müşteri monitör isteğini reddetti. */
export const monitorDeniedSchema = z.strictObject({ t: z.literal("monitor.denied"), id, monitorId });
/** guest(AGENT) → S → tech (AC-105). */
/** AC-105; `selfElevated` zorunlu (§3.3 K8, S7-9): istemci süreci yönetici belirteciyle mi çalışıyor. */
export const envStateSchema = z.strictObject({
  t: z.literal("env.state"),
  id,
  elevatedForeground: z.boolean(),
  secureDesktop: z.boolean(),
  selfElevated: z.boolean(),
});

/** Teknisyenden kabul edilen mesajlar. */
export const techInboundSchema = z.discriminatedUnion("t", [
  guestAdmitSchema,
  guestRejectSchema,
  sdpOfferSchema,
  iceSchema,
  iceRestartSchema,
  sessionEndSchema,
  fileMetaSchema,
  qualitySummarySchema,
  controlRequestSchema,
  monitorRequestSchema,
  controlReleaseSchema,
  controlCancelSchema,
  ...techClipPrintInbound,
  ...fsrvInbound,
]);
export type TechInbound = z.infer<typeof techInboundSchema>;

// --- P8c: bilgisayar kaydı (mimari-protokol §6, ADR-0017) ---
/** Kayıt anahtarı `rsb_` + base64url(32 bayt) (api/bindings.ts `bindingKeySchema` ile aynı ifade). */
const bindingKey = z.string().regex(/^rsb_[A-Za-z0-9_-]{43}$/);
/**
 * guest(AGENT) → S: yalnız `binding.offer` alındıktan sonra, bir kez. `previousKey` yalnız dosyadaki kaydın sunucu kökeni
 * bu sunucuysa. Kaydın müşterisi istemciden ALINMAZ (oturumdan gelir).
 */
/** P20 (protokol §6.1): çoklu firma teklifi yalnız bu sürüm ve üstündeki AGENT ticket'ına (≤ 0.11.x sıkı ayrıştırıcı). */
export const BINDING_MULTI_MIN_VERSION = "0.12.0";
/** P20 (AC-254): bir bilgisayarın aynı sunucuda en çok kaç firma kaydı olur (`previousKeys` üst sınırı). */
export const BINDING_MAX_PER_DEVICE = 5;
/**
 * Zarf: alan biçimleri. P20 `previousKeys` (1..5, benzersiz) + `full` yalnız `multi` teklifinden sonra (aksi CONFLICT).
 * Biçim dışı → 1008 (§1); yalnız `previousKey` + `previousKeys` birlikteliği `error VALIDATION` (soket açık, §6.1).
 */
export const bindingRequestEnvelopeSchema = z.strictObject({
  t: z.literal("binding.request"),
  id,
  previousKey: bindingKey.optional(),
  previousKeys: z
    .array(bindingKey)
    .min(1)
    .max(BINDING_MAX_PER_DEVICE)
    .refine((a) => new Set(a).size === a.length, { message: "Anahtarlar benzersiz olmalı" })
    .optional(),
  full: z.literal(true).optional(),
});
export const BINDING_REQUEST_EXCLUSIVE_MESSAGE = "previousKey ve previousKeys birlikte gönderilemez";
export const bindingRequestSchema = bindingRequestEnvelopeSchema.superRefine((m, ctx) => {
  if (m.previousKey !== undefined && m.previousKeys !== undefined)
    ctx.addIssue({ code: "custom", path: ["previousKeys"], message: BINDING_REQUEST_EXCLUSIVE_MESSAGE });
});

/** Misafirden kabul edilen mesajlar (lobideyken yalnız `session.end`, mimari-protokol §3.1). */
const guestInboundBase = [
  sdpAnswerSchema,
  iceSchema,
  shareStateSchema,
  sessionEndSchema,
  fileMetaSchema,
  controlStateSchema,
  envStateSchema,
  monitorDeniedSchema,
  bindingRequestSchema,
] as const;
export const guestInboundSchema = z.discriminatedUnion("t", [...guestInboundBase]);
export type GuestInbound = z.infer<typeof guestInboundSchema>;

type GuestOption =
  (typeof guestInboundBase)[number] | (typeof guestClipInbound)[number] | (typeof guestPrintInbound)[number] | (typeof fsrvInbound)[number];
const guestFullSchema = z.discriminatedUnion("t", [...guestInboundBase, ...guestClipInbound, ...guestPrintInbound, ...fsrvInbound]);
export type GuestInboundFull = z.infer<typeof guestFullSchema>;
const guestSchemaCache = new Map<number, z.ZodType<GuestInboundFull>>([
  [0, guestInboundSchema],
  [7, guestFullSchema],
]);
/**
 * P28a (§4.3, S-P18-T1 kalıbı): misafir şeması soketin bildirdiği özelliğe göre seçilir — `clip.*` yalnız `clipboard`,
 * `print.report` yalnız `print` bildiren sokette şemadadır; yeteneksiz sokette bu tipler şema dışı → 1008.
 * P28b (§5.2 adım 1): `fsrv = true` yalnız SERVER odasında ve `hasFsrv(peer)` sokette; aksi `fsrv.*` şema dışı → 1008.
 */
export function guestInboundSchemaFor(features: ReadonlySet<GuestFeature>, fsrv = false): z.ZodType<GuestInboundFull> {
  const key = (features.has("clipboard") ? 1 : 0) | (features.has("print") ? 2 : 0) | (fsrv ? 4 : 0);
  const cached = guestSchemaCache.get(key);
  if (cached) return cached;
  const options: [GuestOption, ...GuestOption[]] = [...guestInboundBase];
  if (key & 1) options.push(...guestClipInbound);
  if (key & 2) options.push(...guestPrintInbound);
  if (key & 4) options.push(...fsrvInbound);
  const schema = z.discriminatedUnion("t", options);
  guestSchemaCache.set(key, schema);
  return schema;
}
/** P28a misafir özellikleri + P28b `fsrv` (teknisyene giden `guestFeatures`). */
const guestFeatures = z
  .array(z.enum(PEER_FEATURES))
  .max(PEER_FEATURES.length)
  .refine((a) => new Set(a).size === a.length, { message: "Özellikler benzersiz olmalı" });

// --- Sunucu → istemci ---
export const iceServerSchema = z.strictObject({
  urls: z.array(z.string().max(300)).min(1),
  username: z.string().max(200).optional(),
  credential: z.string().max(200).optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

export const serverOutboundSchema = z.discriminatedUnion("t", [
  z.strictObject({
    t: z.literal("hello"),
    role: z.enum(["tech", "guest"]),
    sessionId: ulid,
    peerPresent: z.boolean(),
    guestKind: z.enum(GUEST_KINDS).optional(),
    iceServers: z.array(iceServerSchema),
    /** PENDING oturumda (teknisyen hello'su) null; ACTIVE'de consumedAt + max_active_hours. */
    maxEndsAt: iso.nullable(),
    caps: z.array(z.enum(CAPS)).optional(),
    /** P5: tenant dosya üst sınırı (MB, AC-53); ACTIVE oturumda iki tarafa (teknisyene ayrıca peer.joined'da). */
    maxFileMb: z.number().int().min(1).max(2048).optional(),
    reconnectToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    /** Yalnız role=tech hello'sunda, ACTIVE oturumda kabul edilmiş misafirin adı (QA-P4-12, yeniden bağlanma). */
    guestName: z.string().max(100).optional(),
    /** Yalnız role=tech hello'sunda: misafirden gelen son paylaşım durumu (misafir ayrıldıysa "stopped"). */
    share: shareStateSchema.omit({ t: true, id: true }).optional(),
    /** P27 (§4.6): yalnız role=tech hello'sunda, gözetimsiz odada — konsol "Gözetimsiz" rozeti + cihaz adı. */
    // P28u (§6.4): `consentMode` oda kipi (yoksa henüz belli değil — `ask` odası `consent.result`'a kadar); `intervene` cihaz
    // `consent1` bildirdi → konsol "Müdahale et"/"Kilitle"/"Oturumu kapat" düğmeleri (yoksa false, AC-352 metni).
    unattended: z
      .strictObject({
        deviceId: ulid,
        deviceName: z.string().min(1).max(64),
        consentMode: z.enum(CONSENT_MODES).optional(),
        intervene: z.boolean().optional(),
      })
      .optional(),
    /** P28a (§4.2): yalnız role=tech hello'sunda — bağlı misafirin bildirdiği özellikler (yoksa `[]`). */
    guestFeatures: guestFeatures.optional(),
    /** P28a (§4.2): yalnız role=tech hello'sunda — müşteri pano anahtarı (sunucu aynası). */
    clipConsent: z.boolean().optional(),
    /**
     * P28b (§5.1, AC-355): oturumun dosya modu (yoksa P2P). Teknisyene her zaman; misafire YALNIZ `hasFsrv(peer)` soketine
     * (eski Go istemcinin katı ayrıştırıcısına yeni alan gitmez).
     */
    fileMode: z.enum(FILE_MODES).optional(),
  }),
  z.strictObject({ t: z.literal("lobby.wait"), expiresAt: iso }),
  z.strictObject({ t: z.literal("peer.pending"), guestId: ulid, name: z.string().max(100), guestKind: z.enum(GUEST_KINDS), since: iso }),
  z.strictObject({ t: z.literal("peer.pending.left"), guestId: ulid, reason: z.enum(["left", "timeout", "rejected"]) }),
  z.strictObject({ t: z.literal("ice.servers"), iceServers: z.array(iceServerSchema) }),
  z.strictObject({
    t: z.literal("peer.joined"),
    role: z.enum(["tech", "guest"]),
    guestKind: z.enum(GUEST_KINDS).optional(),
    /** role=guest (teknisyene giden) mesajda kabul edilmiş misafirin adı (QA-P4-12). */
    guestName: z.string().max(100).optional(),
    /** role=guest (teknisyene giden) mesajda ACTIVE oturumun bitişi: consumedAt + max_active_hours (TEST-P4-2). */
    maxEndsAt: iso.optional(),
    /** P5: role=guest (teknisyene giden) mesajda tenant dosya üst sınırı (MB). */
    maxFileMb: z.number().int().min(1).max(2048).optional(),
    /** P28a (§4.2): role=guest (teknisyene giden) mesajda misafirin bildirdiği özellikler (yoksa `[]`). */
    guestFeatures: guestFeatures.optional(),
    /** P28b (§5.1): role=guest (teknisyene giden) mesajda oturumun dosya modu (yoksa P2P). */
    fileMode: z.enum(FILE_MODES).optional(),
  }),
  z.strictObject({ t: z.literal("peer.left"), role: z.enum(["tech", "guest"]), reason: z.enum(["disconnect", "ended"]).optional() }),
  z.strictObject({ t: z.literal("sdp.offer"), sdp }),
  z.strictObject({ t: z.literal("sdp.answer"), sdp }),
  iceSchema.omit({ id: true }),
  z.strictObject({ t: z.literal("ice.restart") }),
  shareStateSchema.omit({ id: true }),
  z.strictObject({ t: z.literal("session.ended"), reason: z.enum(SESSION_ENDED_REASONS) }),
  z.strictObject({ t: z.literal("session.warning"), kind: z.literal("max_duration_5min"), endsAt: iso }),
  z.strictObject({ t: z.literal("error"), code: z.enum(WS_ERROR_CODES), message: z.string().max(300) }),
  // P7 — misafire: kontrol/monitör isteği, bırakma/iptal, sunucu kaynaklı kapatma, yetenek daralması;
  // teknisyene: izin durumu (sunucu kaynaklı SYSTEM/RECONNECT/TECH dahil), ortam, monitör reddi.
  z.strictObject({ t: z.literal("control.request") }),
  z.strictObject({ t: z.literal("control.release") }),
  z.strictObject({ t: z.literal("control.cancel") }),
  z.strictObject({ t: z.literal("monitor.request"), monitorId }),
  z.strictObject({ t: z.literal("monitor.denied"), monitorId }),
  z.strictObject({ t: z.literal("control.revoke"), reason: z.enum(CONTROL_REVOKE_REASONS) }),
  z.strictObject({ t: z.literal("caps.update"), caps: z.array(z.enum(CAPS)) }),
  z.strictObject({ t: z.literal("control.state"), state: z.enum(CONTROL_STATES), source: z.enum(CONTROL_SOURCES) }),
  envStateSchema.omit({ id: true }),
  // P8c (protokol §6): yalnız ≥ 0.10.0 AGENT misafire; `hello` şeması değişmez (0.9.x sıkı ayrıştırıcı).
  // P20 (§6.1): `multi` yalnız ≥ BINDING_MULTI_MIN_VERSION; `previousIndex` yalnız `previousKeys`'li isteğe.
  z.strictObject({ t: z.literal("binding.offer"), multi: z.literal(true).optional() }),
  z.strictObject({
    t: z.literal("binding.issued"),
    bindingKey,
    tenantName: z.string().max(120),
    customerFirmName: z.string().max(100).nullable(),
    renewed: z.boolean(),
    previousIndex: z
      .number()
      .int()
      .min(0)
      .max(BINDING_MAX_PER_DEVICE - 1)
      .nullable()
      .optional(),
  }),
  // P28a (§4.3): pano/yazdırma iletimi (misafire) ve durum (teknisyene).
  ...serverClipPrintOutbound,
  // P28b (§5.2): sunucu üzerinden dosya — yükleme belirteci, durum, teklif, indirme belirteci.
  ...serverFsrvOutbound,
]);
export type ServerOutbound = z.infer<typeof serverOutboundSchema>;
/** Odada saklanan son paylaşım durumu (teknisyen hello `share` alanı). */
export type ShareSnapshot = NonNullable<Extract<ServerOutbound, { t: "hello" }>["share"]>;
