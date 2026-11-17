// P28c çoklu teknisyen WS sözleşmesi ve sabitleri (mimari-p28c r2 §1.1, §3.1, §4.4, §4.5, §6.1; ADR-0035; AC-364..372).
// Yaprak modül (yalnız zod): `ws.ts`, `dc.ts`, `api/multi.ts` buradan alır — import döngüsü yok (PT-K1). Şemalar `z.strictObject`.
// Çoklu teknisyene ait HİÇBİR alan/mesaj `rs.cap.multi1` bildirmeyen misafire gönderilmez (P28 §0 madde 3); misafir şeması
// `guestInboundSchemaFor(_, _, _, true)` yalnız bu belirteçli sokette `sdp.answer`/`ice` için `to`'yu zorunlu kılar ve
// `tech.remove`'u kabul eder. Go eşi `internal/signal/multi.go`; ortak örnekler `fixtures/multi.json`.
// Müşteriye yalnız opak `tid` + ad gider; `userId` hiçbir misafir mesajında yoktur (T10).
import { z } from "zod";

// --- Yetenek belirteci (§4.4; kimlik değildir, Caddy loglamaz — G-10) ---
/** `/ws/guest` (Go istemci + yardımcı 0.17.0, tarayıcı misafir): çoklu teknisyen alanları/mesajları yalnız bu sokete. */
export const WS_CAP_MULTI = "rs.cap.multi1";

// --- Sabitler (§3.1, §4, §6.1, §18 T8; Go eşi ve fikstür `constants` aynı değerler) ---
/** Oturum başına en çok teknisyen (sahip dahil; bekleyen davet koltuk tutar — AC-365). */
export const MAX_TECHS = 3;
/** Davet ömrü (AC-364). */
export const INVITE_TTL_MS = 120_000;
/** Kabul / İzle sonrası WS'ye dönme süresi (rezervasyon); dolarsa `participant_leave{no_show}`. */
export const MEMBER_RESERVE_MS = 60_000;
/** Üye kopma payı (120 sn; sahip için mevcut kural aynı süre). */
export const MEMBER_GRACE_MS = 120_000;
/** Oda başına dakikada en çok davet/devir/çıkarma komutu (T8). */
export const MULTI_ROOM_CMDS_PER_MIN = 10;
/** Kullanıcı başına dakikada en çok İzle / davet kabulü (D-PC-3). */
export const MULTI_JOIN_PER_MIN = 20;
/** `GET /sessions/invites` ve `GET /sessions/active` kullanıcı başına dakikada en çok (ADR-0029 yoklama kalıbı). */
export const MULTI_POLL_PER_MIN = 60;
/** Davet bildirimi yoklama aralığı (`invite-notifier.tsx`). */
export const INVITE_POLL_MS = 5_000;
/** Etkin oturumlar bölümü yoklama aralığı (yalnız sayfa açıkken). */
export const ACTIVE_POLL_MS = 10_000;
/** İkincil (düşük) akış tavanı (§6.1, AC-371): kare hızı ve taban. */
export const LOW_FPS = 8;
export const LOW_FPS_MIN = 5;
/** İkincil akış bit hızı tavanı (bps). */
export const LOW_BPS = 1_000_000;
/** Roster'daki ad üst sınırı (UTF-16 birimi). */
export const ROSTER_NAME_MAX = 100;
/** Teknisyen soket kapanış kodu: müşteri çıkardı / yetki düştü (§4.4). */
export const WS_CLOSE_REMOVED = 4403;

/** Oda içi opak teknisyen kimliği: `crypto.randomBytes(8)` → base64url (dolgusuz) = 11 karakter (D-PC-6). */
export const TID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const techIdSchema = z.string().regex(TID_PATTERN);

// --- Sözlükler ---
/** Üyenin oda rolü (`Member.role`); oturum sahibi üye değildir. */
export const MEMBER_ROLES = ["participant", "observer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
/** Roster rol etiketi: kontrol sahibi (ana akış) / katılımcı / izleyici. Oturum sahibi ayrıca `owner: true`. */
export const ROSTER_ROLES = ["controller", "participant", "observer"] as const;
export type RosterRole = (typeof ROSTER_ROLES)[number];
/** Teknisyen `hello.techRole`: bağlanan soketin oturumdaki yeri (sahip ya da üye rolü). */
export const TECH_ROLES = ["owner", ...MEMBER_ROLES] as const;
export type TechRole = (typeof TECH_ROLES)[number];
/** Katılma yolu (`Member.via`). */
export const MEMBER_VIAS = ["invite", "supervise"] as const;
export type MemberVia = (typeof MEMBER_VIAS)[number];

// --- Roster (S → tüm teknisyenler + multi1 misafir; teknisyen `hello.roster`) ---
export const techRosterEntrySchema = z.strictObject({
  tid: techIdSchema,
  name: z.string().min(1).max(ROSTER_NAME_MAX),
  role: z.enum(ROSTER_ROLES),
  owner: z.boolean(),
  connected: z.boolean(),
});
export type TechRosterEntry = z.infer<typeof techRosterEntrySchema>;

/** Roster değişmezleri: `tid` benzersiz, tam bir oturum sahibi, tam bir kontrol sahibi (Go `validRoster` aynı kural). */
const rosterValid = (a: readonly TechRosterEntry[]): boolean =>
  new Set(a.map((e) => e.tid)).size === a.length &&
  a.filter((e) => e.owner).length === 1 &&
  a.filter((e) => e.role === "controller").length === 1;
export const techRosterSchema = z
  .array(techRosterEntrySchema)
  .min(1)
  .max(MAX_TECHS)
  .refine(rosterValid, { message: "tid benzersiz; tam bir oturum sahibi ve bir kontrol sahibi olmalı" });

/** Her üyelik/rol/bağlantı değişiminde olay anında (≤ 2 sn, AC-366); misafire admit `hello`'sunun hemen ardından da. */
export const techsRosterSchema = z.strictObject({ t: z.literal("techs.roster"), techs: techRosterSchema });
export type TechsRosterMessage = z.infer<typeof techsRosterSchema>;

// --- Mesajlar ---
const id = z.string().max(26).optional();

// Teknisyen → sunucu (`/ws/tech`)
/** Oturum sahibi (+ `sessions.invite`): kontrolü bağlı katılımcıya verir ya da `to = kendi tid`'i ile geri alır (§5.1). */
export const controlHandoverSchema = z.strictObject({ t: z.literal("control.handover"), id, to: techIdSchema });
/** Oturum sahibi (+ `sessions.invite`): oturumu bağlı katılımcıya devreder (§5.2; tek TX, `support_sessions.technician_id`). */
export const sessionTransferSchema = z.strictObject({ t: z.literal("session.transfer"), id, to: techIdSchema });
/** Sahip olmayan üye: anında ayrılır (`participant_leave{left}`), soket 1000. */
export const memberLeaveSchema = z.strictObject({ t: z.literal("member.leave"), id });
export const techMultiInbound = [controlHandoverSchema, sessionTransferSchema, memberLeaveSchema] as const;

// Misafir → sunucu (yalnız multi1 sokette; `sdp.answer`/`ice` + `to` varyantları `ws.ts`'te kurulur)
/** Müşterinin "Çıkar"ı (§5.3): hedef oturum sahibi olamaz (→ `error{FORBIDDEN}`). */
export const techRemoveSchema = z.strictObject({ t: z.literal("tech.remove"), id, tid: techIdSchema });
export const guestMultiInbound = [techRemoveSchema] as const;

// Sunucu → istemci
export const serverMultiOutbound = [techsRosterSchema] as const;

/** Teknisyen `hello` ekleri (§4.4): `tid` kendi kimliği, `techRole` yeri, `roster` güncel liste. `role` (tech|guest) aynen kalır. */
export const helloMultiFields = {
  tid: techIdSchema.optional(),
  techRole: z.enum(TECH_ROLES).optional(),
  roster: techRosterSchema.optional(),
  /**
   * K1c (AC-372): kabul edilmiş misafir `rs.cap.multi1` bildirdi mi (kısa kopuklukta son değer). Alan yok = kabul edilmiş
   * misafir yok; `false` = desteklemiyor → konsol "Davet et"/"İzle" baştan pasif (AC-352 metni). `peer.joined{guest}`'te de var.
   */
  guestMulti: z.boolean().optional(),
};

// --- Rol kapısı (§1.1, §4.4; D-PC-6 varsayılan-ret) ---
/**
 * Teknisyen mesajını kim gönderebilir: `any` = her teknisyen soketi; `owner` = oturum sahibi; `controller` = kontrol
 * sahibi; `member` = sahip olmayan üye; `talker` = izleyici olmayan (sahip ya da katılımcı — P28d sesli görüşme, AC-378).
 * Anahtar kümesi `techInboundSchema` tiplerinin TAMAMIDIR (test: eksik/fazla anahtar kırar); listede olmayan tip `seatMay`
 * ile reddedilir.
 */
export const TECH_SEATS = ["any", "owner", "controller", "member", "talker"] as const;
export type TechSeat = (typeof TECH_SEATS)[number];
export const ROLE_MAY = {
  "sdp.offer": "any",
  ice: "any",
  "ice.restart": "any",
  "member.leave": "member",
  "guest.admit": "owner",
  "guest.reject": "owner",
  "session.end": "owner",
  "control.handover": "owner",
  "session.transfer": "owner",
  "control.request": "controller",
  "monitor.request": "controller",
  "control.release": "controller",
  "control.cancel": "controller",
  "file.meta": "controller",
  "quality.summary": "controller",
  "clip.push": "controller",
  "clip.pull": "controller",
  "print.request": "controller",
  "print.cancel": "controller",
  "fsrv.init": "controller",
  "fsrv.accept": "controller",
  "fsrv.reject": "controller",
  "fsrv.result": "controller",
  "fsrv.cancel": "controller",
  "rec.error": "controller",
  // P28d (mimari-p28d §4.2): izleyici istek yapamaz, katılamaz, bitiremez (yalnız dinler; sunucu `FORBIDDEN`).
  "voice.request": "talker",
  "voice.join": "talker",
  "voice.end": "talker",
} as const satisfies Readonly<Record<string, TechSeat>>;
export type RoleMayType = keyof typeof ROLE_MAY;

/**
 * Soketin oturumdaki yeri: sahip mi, kontrol sahibi mi (ikisi aynı kişi olabilir), izleyici mi (P28d; sahip asla izleyici
 * değildir). `observer` zorunludur: eksik alan `talker` kapısını açmaz (varsayılan-ret).
 */
export interface TechSeatOf {
  owner: boolean;
  controller: boolean;
  observer: boolean;
}
/** Varsayılan-ret kapı: `ROLE_MAY`'de olmayan tip hiç kimseye açık değildir. */
export function seatMay(t: string, seat: TechSeatOf): boolean {
  if (!Object.hasOwn(ROLE_MAY, t)) return false;
  switch (ROLE_MAY[t as RoleMayType]) {
    case "any":
      return true;
    case "owner":
      return seat.owner;
    case "controller":
      return seat.controller;
    case "member":
      return !seat.owner;
    case "talker":
      return seat.owner || seat.observer === false;
  }
}
