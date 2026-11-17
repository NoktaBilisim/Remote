// P28d sesli görüşme WS sözleşmesi ve sabitleri (mimari-p28d r2 §4; ADR-0036; AC-373..379).
// Yaprak modül (zod + `ws-multi.ts`'ten `techIdSchema`): `ws.ts` buradan alır, `ws-multi.ts` buraya bağlanmaz (PT-K1 döngü yok).
// Şemalar `z.strictObject`. Ses mesajları YALNIZ `rs.cap.voice1` bildiren (ya da tarayıcı) misafirin şemasındadır; eski Go
// istemciye hiçbir `voice.*` mesajı gitmez (P28 §0 m.3). Go eşi `internal/signal/voice.go`; ortak örnekler `fixtures/voice.json`.
// Medya (Opus) WebRTC'den gider; buradaki mesajlar yalnız sinyaldir. Mikrofonu YALNIZ yerel "Kabul et" tıklaması açar (K-PD-2):
// `voice.request` / `voice.state` mikrofon açmaz, yalnız kapatabilir.
import { z } from "zod";
import { MAX_TECHS, techIdSchema } from "./ws-multi.ts";

// --- Yetenek belirteci (§4.1; kimlik değildir, Caddy loglamaz — G-10) ---
/** `/ws/guest` (Go istemci 0.18.0): ses mesajları yalnız bu belirteçli sokete. Tarayıcı misafir destekli sayılır (`hasFsrv` kalıbı). */
export const WS_CAP_VOICE = "rs.cap.voice1";

// --- Sabitler (§4.2; Go eşi ve fikstür `constants` aynı değerler) ---
/** Bekleyen isteğin müşteri yanıtı süresi; dolarsa `voice.reject{timeout}` + `voice.state{idle, timeout}` (AC-373). */
export const VOICE_REQUEST_TIMEOUT_MS = 60_000;
/** Ret / zaman aşımı ve `endReason ∈ {customer, device}` bitişinden sonra yeni istek bekleme süresi (AC-116 / G-03, D-PD-2). */
export const VOICE_DENY_COOLDOWN_MS = 30_000;
/** Oturum başına en çok `voice.request` (11. istek `RATE_LIMITED`). */
export const VOICE_REQUESTS_PER_SESSION = 10;
/** Tek Opus paketi üst sınırı (RFC 6716); Go çözücü önünde boyut kapısı (Y-PD-2). */
export const VOICE_MAX_OPUS_BYTES = 1275;
/** Teknisyen (tid) başına saniyede en çok Opus paketi (Y-PD-2). */
export const VOICE_MAX_PKT_PER_SEC = 100;

/** Görüşme kimliği: sunucu `crypto.randomBytes(16)` → base64url (dolgusuz) = 22 karakter (Y-PD-1). İstemci üretmez. */
export const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const callIdSchema = z.string().regex(CALL_ID_PATTERN);

// --- Sözlükler ---
/** `Room.voice.phase` (§3). */
export const VOICE_PHASES = ["idle", "pending", "active"] as const;
export type VoicePhase = (typeof VOICE_PHASES)[number];
/** `voice.state.endReason` (idle bitiş yayını) ve audit `voice.end.reason` (§4.2, §6). */
export const VOICE_END_REASONS = ["tech", "customer", "timeout", "left", "device", "disconnect", "session_ended"] as const;
export type VoiceEndReason = (typeof VOICE_END_REASONS)[number];
/** Misafirin `voice.end.reason`'ı: müşteri bitirdi / rıza kaydı yok → `customer`; mikrofon açılamadı → `device` (V-PD-1). */
export const VOICE_GUEST_END_REASONS = ["customer", "device"] as const;
export type VoiceGuestEndReason = (typeof VOICE_GUEST_END_REASONS)[number];

// --- Mesajlar ---
const id = z.string().max(26).optional();

// Teknisyen → sunucu (`/ws/tech`; rol kapısı `ROLE_MAY` "talker": sahip ve katılımcı, izleyici değil — AC-378)
/** Görüşme isteği (§4.2): kapılar sunucuda (yetki, rol, `hasVoice`, faz, bekleme, oturum sayacı); `callId` sunucu üretir. */
export const voiceRequestTechSchema = z.strictObject({ t: z.literal("voice.request"), id });
/** Etkin görüşmeye konuşan olarak katıl (`callId` `voice.state`'ten). Zaten konuşan ise no-op (D-PD-2). */
export const voiceJoinSchema = z.strictObject({ t: z.literal("voice.join"), id, callId: callIdSchema });
/** Görüşmeyi herkes için bitir (V-PD-2); gönderen `talkers` içinde olmalı (yoksa `FORBIDDEN`). Neden sunucuda `tech`. */
export const voiceEndTechSchema = z.strictObject({ t: z.literal("voice.end"), id, callId: callIdSchema });
export const techVoiceInbound = [voiceRequestTechSchema, voiceJoinSchema, voiceEndTechSchema] as const;

// Misafir → sunucu (yalnız voice1 / tarayıcı misafir soketi)
/** Kabul/ret tıklama anında; aynı anda yerel rıza kaydı (`consent = callId`) yazılır (K-PD-2). Yalnız pending + eşleşen callId. */
export const voiceAnswerSchema = z.strictObject({ t: z.literal("voice.answer"), id, callId: callIdSchema, accept: z.boolean() });
/** Yalnız active iken; pending'de düşer (ret `voice.answer{accept:false}` ile). İki neden de 30 sn bekleme başlatır. */
export const voiceEndGuestSchema = z.strictObject({
  t: z.literal("voice.end"),
  id,
  callId: callIdSchema,
  reason: z.enum(VOICE_GUEST_END_REASONS),
});
export const guestVoiceInbound = [voiceAnswerSchema, voiceEndGuestSchema] as const;

// Sunucu → istemci
/** S → voice1 misafir: diyalog açar, mikrofon AÇMAZ. Roster'da olmayan `by` misafirde yok sayılır (Y-PC-4 kalıbı). */
export const voiceRequestGuestSchema = z.strictObject({ t: z.literal("voice.request"), callId: callIdSchema, by: techIdSchema });

const tidList = z
  .array(techIdSchema)
  .max(MAX_TECHS)
  .refine((a) => new Set(a).size === a.length, { message: "tid benzersiz olmalı" });

/**
 * `voice.state` değişmezleri (§4.2, V-PD-3; Go `validVoiceState` aynı kural):
 *  - pending/active → `callId` zorunlu; idle → `callId` yalnız `endReason` ile birlikte (biten görüşmenin kimliği).
 *  - `endReason` yalnız idle'da.
 *  - `talkers ⊆ listeners`.
 */
export const voiceStateSchema = z
  .strictObject({
    t: z.literal("voice.state"),
    phase: z.enum(VOICE_PHASES),
    callId: callIdSchema.optional(),
    by: techIdSchema.optional(),
    talkers: tidList,
    listeners: tidList,
    endReason: z.enum(VOICE_END_REASONS).optional(),
  })
  .refine((m) => (m.phase === "idle" ? (m.callId !== undefined) === (m.endReason !== undefined) : m.callId !== undefined), {
    message: "callId pending/active'de zorunlu; idle'da yalnız endReason ile",
  })
  .refine((m) => m.endReason === undefined || m.phase === "idle", { message: "endReason yalnız idle'da" })
  .refine((m) => m.talkers.every((t) => m.listeners.includes(t)), { message: "talkers ⊆ listeners" });
export type VoiceStateMessage = z.infer<typeof voiceStateSchema>;

/** S → tüm teknisyenler + voice1 misafir: `voice.state`; yalnız voice1 misafire: `voice.request{callId, by}`. */
export const serverVoiceOutbound = [voiceRequestGuestSchema, voiceStateSchema] as const;

/**
 * Teknisyen `hello` ve `peer.joined{role:guest}` eki (§4.1, `guestMulti` kalıbı): kabul edilmiş misafir sesi destekliyor mu
 * (`hasVoice`: gözetimsiz değil ve (`voice1` ya da BROWSER)). Alan yok = kabul edilmiş misafir yok; `false` → düğme pasif.
 * Misafire giden hello'da YOKTUR (Go katı ayrıştırıcı reddeder).
 */
export const helloVoiceFields = { guestVoice: z.boolean().optional() };
