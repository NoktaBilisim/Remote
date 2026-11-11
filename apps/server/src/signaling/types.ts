// Sinyalizasyon bellek içi durumu (mimari §3.5, ADR-0005 tek instance): oda, lobi misafiri, teknisyen
// bağlantısı ve saat. DB'ye yazılmaz; süreç yeniden başlarsa ACTIVE oturumlar ENDED{server} yapılır.
import type { Cap, GuestKind, ServerOutbound, ShareSnapshot } from "@remote/contracts/ws";
import type { PermissionKey, Role } from "@remote/contracts/permissions";
import type { ControlAuditAction } from "@remote/contracts/audit";
import type { AuditContext } from "../audit/service.ts";
import type { JsonObject } from "../audit/mask.ts";
import type { GuestConsent } from "../public/consent.ts";

/** Misafir istemci ortamı (`env.state` alanları, `t`/`id` hariç). */
export type GuestEnv = Omit<Extract<ServerOutbound, { t: "env.state" }>, "t">;

/** Bir WS bağlantısının odadaki temsili; testler sahte Peer ile ağsız çalışır. */
export interface Peer {
  send(msg: ServerOutbound): void;
  close(code: number, reason: string): void;
  /** Soket OPEN mı (CLOSING/CLOSED değil) — reconnect çakışma kararı için (TEST-P4-1). */
  isOpen(): boolean;
}

/** Zamanlayıcı soyutlaması: üretimde gerçek saat, testlerde elle ilerletilen sahte saat (AC-13, AC-25). */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export type GuestState = "TICKETED" | "LOBBY" | "ADMITTED";

export interface Guest {
  id: string;
  name: string;
  /** P8: join'deki isteğe bağlı e-posta; admit UPDATE'inde customer_email'e yazılır (AC-62). */
  email?: string;
  kind: GuestKind;
  ipKey: string;
  /** sha256(guestId:admitCode) — düz kod bellekte de tutulmaz. */
  admitHash: string;
  /** Join anında onaylanan KVKK metni; admit TX'inde session_consents'e yazılır (P4, AC-29). */
  consent: GuestConsent;
  /** P7: son WS bağlantısının istemci bağlamı (kontrol onay kaydı ip/user_agent, audit). Yeniden bağlanmada yenilenir. */
  ctx?: AuditContext;
  state: GuestState;
  since: number;
  peer?: Peer;
  timer?: unknown;
}

export interface TechConn {
  peer: Peer;
  userId: string;
  username: string;
  /** /ws/tech 60 sn yeniden doğrulaması için çerez değeri (yalnız bellekte; loglanmaz). */
  authToken: string;
  /** 60 sn yeniden doğrulamasında tazelenir (S-P3-8); daralma `rooms.applyPermChange` ile caps'e yansır. */
  permissions: ReadonlySet<PermissionKey>;
  /** Bağlanma anındaki rol; yeniden doğrulamada farklıysa teknisyenin tüm odaları biter (AC-115). */
  role: Role;
  ctx: AuditContext;
}

/** session_consents.source CHECK kümesi (P4 + P7 `TECH`, ADR-0013). DENIED kararı UI kaynağıyla yazılır. */
export type ConsentSource = "UI" | "HOTKEY" | "RECONNECT" | "SYSTEM" | "TECH";

/** Kontrol kapanış kaydı (REVOKED): kim, hangi kaynakla, hangi audit adıyla (§3.3 tablo). */
export interface CloseRecord {
  source: ConsentSource;
  action: ControlAuditAction;
  ctx: AuditContext;
  actor: { userId?: string; username: string };
  extra: JsonObject;
}

/**
 * P7 uzaktan kontrol oda durumu (mimari-protokol §3.3, ADR-0013). Sunucu görüşü; izin kararı istemcide (Go gate).
 * `epoch` her kapatmada (revoke, kopma, bırakma/iptal, oturum sonu) artar — bekleyen GRANTED kaydı sonuçlanınca
 * eskimiş sayılır ve `interrupt` kaydıyla dengelenir.
 */
export interface ControlRoom {
  state: "VIEW" | "REQUESTED" | "GRANTED";
  /** GRANTED kaydı (session_consents + audit) yazılıyor; bu sırada gelen ikinci GRANTED yok sayılır. */
  granting: boolean;
  /** Açılış yazılırken gelen ilk kapatma: GRANTED geç commit edilirse bu kayıtla kapatılır (yoksa SYSTEM/superseded). */
  interrupt?: CloseRecord;
  epoch: number;
  /** İletilen control.request sayısı (oturum başına ≤ 5, G-03; iptal/bırakma düşürmez) ve son ret anı (30 sn bekleme). */
  requests: number;
  deniedAt?: number;
  /** İletilen monitor.request sayısı (kontrolden ayrı), tek bekleyen istek ve son ret/yanıtsızlık anı (30 sn bekleme; K4). */
  monitorRequests: number;
  /** `peer`: isteğin iletildiği misafir bağlantısı — karşılanma (monitor.granted) yalnız aynı bağlantıdan (S7-15). */
  monitorPending?: { id: number; at: number; peer: Peer };
  monitorDeniedAt?: number;
  /** Beklenmeyen misafir mesajı logu (control_state_unexpected / monitor_denied_unexpected) oda başına dakikada en çok 1. */
  unexpectedLogAt?: number;
  /** Kontrol kayıtları oda başına sırayla yazılır (DB yazımı araya girmesin). */
  chain: Promise<void>;
}

/**
 * `file.meta` kota sınıfı (alıcı raporu): OK/CORRUPT = kabul edilmiş transferin sonucu (`accepted`); REJECTED/CANCELLED =
 * ret/iptal (`declined`). Gönderen raporu sonuçtan bağımsız ayrı ve düşük kotalı `sender` sınıfındadır (S-P5-T2-3).
 */
export type FileMetaClass = "accepted" | "declined" | "sender";
export interface FileMetaQuota {
  windowStart: number;
  inWindow: number;
  total: number;
}

export interface Room {
  sessionId: string;
  tenantId: string;
  technicianId: string;
  technicianName: string;
  /** PENDING bitiş anı (ms); ret/hatalı kod durumu taşıyan boş oda en geç bu anda bellekten silinir (S-P3-4). */
  expiresAt: number;
  tech?: TechConn;
  /** TICKETED + LOBBY misafirler (≤ 3). */
  lobby: Map<string, Guest>;
  admitted?: Guest;
  admitting: boolean;
  admitFails: number;
  rejectedIps: Set<string>;
  reconnectHash?: string;
  maxEndsAt?: number;
  caps: Cap[];
  /** P5: tenant dosya üst sınırı (MB), admit anında okunur; hello/peer.joined ile iki tarafa (AC-53). */
  maxFileMb?: number;
  /**
   * P5 `file.meta` hız sınırı (db-notlari P5/1; S-P5-1): sayaç raporlayan taraf × sonuç sınıfı başına ayrı
   * (`tech:accepted`, `guest:declined`, `tech:sender` …) — ret seli kabul edilmiş transferin kaydını düşüremez. `auditAt`:
   * taraf × sınıf (`${side}:${cls}`) başına son `file.meta.rate_limited` audit anı (dakikada en çok 1; S-P5-T2-2).
   */
  fileMeta: { quotas: Map<string, FileMetaQuota>; auditAt: Map<string, number> };
  /** P5 `quality.summary` son yazım anı (ms); MIN aralıktan sık gelen özet DB'ye gitmez. */
  qualityAt?: number;
  /** S-P4-T3-2: son `reconnect.conflict` audit anı (ms); oda başına dakikada en çok 1 kayıt. */
  reconnectConflictAuditAt?: number;
  /** Misafirden gelen son `share.state` (QA-P4-12): teknisyen yeniden bağlanınca hello'da gönderilir; misafir ayrılınca "stopped". */
  share?: ShareSnapshot;
  /** P7 son `env.state` (AGENT; §3.3 K8): GRANTED audit'ine `selfElevated` yazılır; misafir ayrılınca/kopunca temizlenir. */
  guestEnv?: GuestEnv;
  /** P7 uzaktan kontrol durumu. */
  control: ControlRoom;
  timers: { disconnect?: unknown; warn?: unknown; maxEnd?: unknown; iceRefresh?: unknown; idle?: unknown };
  ending: boolean;
}

/** Süreler (ms). Testler kısaltabilir; varsayılanlar mimari-protokol değerleri. */
export interface Timing {
  lobbyMs: number;
  reconnectMs: number;
  ticketMs: number;
  nonceMs: number;
  warnBeforeMs: number;
  iceRefreshBeforeMs: number;
}

export const DEFAULT_TIMING: Timing = {
  lobbyMs: 5 * 60_000,
  reconnectMs: 120_000,
  ticketMs: 60_000,
  nonceMs: 60_000,
  warnBeforeMs: 5 * 60_000,
  iceRefreshBeforeMs: 5 * 60_000,
};

export const LOBBY_MAX = 3;
export const ADMIT_FAIL_MAX = 5;
