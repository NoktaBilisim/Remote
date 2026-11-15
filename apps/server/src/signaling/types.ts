// Sinyalizasyon bellek içi durumu (mimari §3.5, ADR-0005 tek instance): oda, lobi misafiri, teknisyen
// bağlantısı ve saat. DB'ye yazılmaz; süreç yeniden başlarsa ACTIVE oturumlar ENDED{server} yapılır.
import type { Cap, GuestKind, ServerOutbound, ShareSnapshot } from "@remote/contracts/ws";
import type { ClipDirection, GuestFeature } from "@remote/contracts/ws-clip-print";
import type { PermissionKey, Role } from "@remote/contracts/permissions";
import type { ControlAuditAction } from "@remote/contracts/audit";
import { LOBBY_GUEST_MAX } from "@remote/contracts/api/sessions";
import type { AuditContext } from "../audit/service.ts";
import type { JsonObject } from "../audit/mask.ts";
import type { GuestConsent } from "../public/consent.ts";
import type { IceGrant, TurnConfig } from "./turn.ts";

/** Misafir istemci ortamı (`env.state` alanları, `t`/`id` hariç). */
export type GuestEnv = Omit<Extract<ServerOutbound, { t: "env.state" }>, "t">;

/** Bir WS bağlantısının odadaki temsili; testler sahte Peer ile ağsız çalışır. */
export interface Peer {
  send(msg: ServerOutbound): void;
  close(code: number, reason: string): void;
  /** Soket OPEN mı (CLOSING/CLOSED değil) — reconnect çakışma kararı için (TEST-P4-1). */
  isOpen(): boolean;
  /**
   * P28a (mimari-p28 §4.2): bu misafir soketinin bildirdiği `rs.cap.*` özellikleri (ws-auth; gözetimsiz odada / tarayıcıda
   * boş). Oda özelliği bağlı ADMITTED misafirin soketinden okunur — misafir ayrılınca kendiliğinden boşalır.
   */
  features?: ReadonlySet<GuestFeature>;
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
  /** P8b: ağ öneki (netKey) — admit UPDATE'inde guest_ip_key ile birlikte yazılır (§13.1, G-E9-15). */
  netKey?: string;
  /** P8b r2 (§13.4): AGENT sürümü (resolve/talep kaydından; /ws/guest MIN_AGENT_VERSION kontrolü). */
  clientVersion?: string;
  /** P8b: ön-kabullü misafir (talepten doğan oturum) — lobi/admitCode atlanır (mimari-protokol §5.2). */
  requestId?: string;
  /** P8b: geçerli ticket kuşağı; yeniden bağlanan /ws/request yeni ticket alınca eskisi geçersiz. */
  ticketGen?: number;
  /** P8c: `binding.offer` gönderilen bağlantı — `binding.request` yalnız bu soketten kabul edilir (protokol §6). */
  bindingOfferPeer?: Peer;
  /** P20 (protokol §6.1): bu bağlantıya `binding.offer.multi` gitti — `previousKeys` yalnız o zaman kabul edilir. */
  bindingOfferMulti?: boolean;
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
export type ConsentSource = "UI" | "HOTKEY" | "RECONNECT" | "SYSTEM" | "TECH" | "UNATTENDED";

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

/** P28a pano/yazdırma işini isteyen teknisyen (audit aktörü). */
export interface ClipPrintActor {
  userId: string;
  username: string;
  ctx: AuditContext;
}

/**
 * P28a oda durumu (mimari-p28 §3, §4.3; r2 O-P28a-1/5, Y-P28a-1). Bellekte; içerik (pano metni, PDF, dosya adı) yok.
 * `consent` müşteri anahtarının sunucu aynası; kontrol VIEW'a dönünce / misafir kopunca / oturum bitince false.
 */
export interface ClipPrintRoom {
  consent: boolean;
  /** Son 60 sn'de işlenen müşteri `clip.consent` değişimleri (≤ CLIP_CONSENT_PER_MIN). */
  consentTimes: number[];
  /** Oda başına tek bekleyen pano işi (CLIP_PENDING_TIMEOUT_MS). */
  clipPending: { cid: string; dir: ClipDirection; actor: ClipPrintActor; timer: unknown } | null;
  /** Son 60 sn'de iletilen pano istekleri (≤ CLIP_PER_MIN). */
  clipTimes: number[];
  /** Oda başına tek bekleyen yazdırma işi (PRINT_PENDING_TIMEOUT_MS). */
  printPending: { pid: string; sizeBytes: number; actor: ClipPrintActor; timer: unknown } | null;
  /** Oturum başına iletilen yazdırma isteği (≤ PRINT_PER_SESSION) ve ret/yanıtsızlık sonrası bekleme sonu (ms). */
  printCount: number;
  printCooldownUntil: number;
  /** İletilmiş son ID_REUSE_WINDOW cid/pid (yeniden kullanım → VALIDATION). */
  usedIds: string[];
  /** Kapı reddi / eşleşmeyen rapor logu oda başına dakikada en çok 1. */
  logAt?: number;
}

export interface Room {
  sessionId: string;
  /** P8b: talepten doğan oturum (guest.admit/guest.reject → CONFLICT; P15 `acceptCode` açıksa izinli). */
  requestId?: string;
  /** P27 (mimari-p27 §4.4, §4.6): gözetimsiz oda — cihaz; yalnız bu odada misafir `control.state{source:UNATTENDED}` kabul edilir. */
  unattended?: { deviceId: string; deviceName: string; customerId: string; dbEndReason?: string };
  /** P15 (AC-239): talep oturumu kabul koduyla — misafir lobiye düşer, teknisyen 4 haneli kodu girer (AC-112 kuralları). */
  acceptCode?: boolean;
  tenantId: string;
  technicianId: string;
  technicianName: string;
  /** PENDING bitiş anı (ms); ret/hatalı kod durumu taşıyan boş oda en geç bu anda bellekten silinir (S-P3-4). */
  expiresAt: number;
  tech?: TechConn;
  /** TICKETED + LOBBY misafirler (≤ 3). */
  lobby: Map<string, Guest>;
  /** P13b-L (mimari-lobi §3): misafirin LOBBY durumuna her geçişinde +1; hiç azalmaz (toast tekilleştirme `arrivals`). */
  lobbyArrivals: number;
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
  /** P15 (S17-2): teknisyene son `share.state` iletim anı (ms); `SHARE_STATE_MIN_INTERVAL_MS` içinde gelenler birleştirilir. */
  shareSentAt?: number;
  /** P7 son `env.state` (AGENT; §3.3 K8): GRANTED audit'ine `selfElevated` yazılır; misafir ayrılınca/kopunca temizlenir. */
  guestEnv?: GuestEnv;
  /** P7 uzaktan kontrol durumu. */
  control: ControlRoom;
  /** P28a pano + uzaktan yazdırma durumu (clip-print.ts). */
  clipPrint: ClipPrintRoom;
  /** P8c: oturum başına iletilen `binding.request` sayısı (≤ 3, mimari-e10 §5.3). */
  bindingRequests?: number;
  /** G-P13b-1: son verilen TURN credential (yeniden bağlanmada aynısı; `active.ts` grant). */
  iceGrant?: { cfg: TurnConfig; grant: IceGrant };
  /** `share`: P15 (S17-2) birleştirilmiş `share.state`'in gecikmeli iletimi. */
  timers: { disconnect?: unknown; warn?: unknown; maxEnd?: unknown; iceRefresh?: unknown; idle?: unknown; share?: unknown };
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
  /** P8b: kabulden sonra müşterinin bağlanma (onay dahil) penceresi (AC-155). */
  requestConnectMs: number;
  /** P8b: /ws/request kopma toleransı (AC-141). */
  requestDisconnectMs: number;
}

export const DEFAULT_TIMING: Timing = {
  lobbyMs: 5 * 60_000,
  reconnectMs: 120_000,
  ticketMs: 60_000,
  nonceMs: 60_000,
  warnBeforeMs: 5 * 60_000,
  iceRefreshBeforeMs: 5 * 60_000,
  requestConnectMs: 60_000,
  requestDisconnectMs: 120_000,
};

/** Tek kaynak: sözleşmedeki LOBBY_GUEST_MAX (mimari-lobi §3). */
export const LOBBY_MAX = LOBBY_GUEST_MAX;
export const ADMIT_FAIL_MAX = 5;

/**
 * Canlı oturumlara yetki/hesap değişikliğinin yansıması (S-P3-8, AC-115, G-04). Kullanıcı/yetki/oturum servisleri
 * (P9 deaktivasyon/yetki/rol, P10 logout-all/reset-mfa) commit sonrası `app.rooms` üzerinden doğrudan çağırır;
 * /ws/tech 60 sn yeniden doğrulaması yalnız yedek yoldur.
 */
export interface TechnicianLiveControl {
  /** Teknisyenin tüm odaları `session.ended{auth_revoked}` ile biter (teknisyen soketi 4401). */
  endByTechnician(userId: string): Promise<void>;
  /** Yeni etkin yetkiler: caps daralırsa `caps.update`, `remote_control` düştüyse `control.revoke{permission}`. */
  applyPermChange(userId: string, permissions: Iterable<PermissionKey>): Promise<void>;
}
