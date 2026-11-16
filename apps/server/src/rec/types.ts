// P28e K3 ↔ K4 arayüzü (mimari-p28e r2 §5, §6, §11.2, §14 notu). K3 `rec/service.ts` `RecService`'i yazar; K4
// `signaling/rec.ts` onu çağırır ve `RecRoomPort`'u (oda belleği + yayın) sağlar — FsrvSink kalıbı, döngüsel import yok.
// Yalnız tipler ve metrik adları; davranış K3/K4'te. Belirteçler P28b `TokenTable`'da (yalnız SHA-256 tutulur, ADR-0005).
import type { Prisma } from "../generated/prisma/client.ts";
import type { ConsentMode } from "@remote/contracts/unattended-consent";
import type {
  RecBasis,
  RecConsentRejectCode,
  RecStartFailReason,
  RecStateReason,
  RecStopErrorCode,
  RecStopReason,
  RecViewEndReason,
} from "@remote/contracts/ws-rec";
import type { AuditContext } from "../audit/service.ts";

export type Tx = Prisma.TransactionClient;

// --- Belirteç girdileri (P28b `TokenTable` yeni `kind`'ları; K3 `fsrv/tokens.ts` birliğine ekler) ---

/**
 * Yükleme belirteci (S-P28e-6). Düşme: kayıt `STOPPED` + `REC_STOP_GRACE_MS`, kaydedici soketi (`connId`) kapanınca / teknisyen
 * odadan ayrılınca / oda kapanınca (+ pay); çıkış (`authSessionId`), kullanıcı ve tenant pasifleştirmede HEMEN. Her PUT kullanıcı
 * + `auth_session` etkinliğini yeniden denetler; URL `rid` ≠ `rid` → 404.
 */
export interface RecUploadTokenEntry {
  kind: "recUpload";
  rid: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  authSessionId: string;
  connId: string;
}

/**
 * İzleme belirteci (§5, S-P28e-3). Kayan süre: her GET `idleUntil = now + REC_VIEW_IDLE_MS`; `maxUntil` sabit. Sayaçlar
 * düşüşte `recording.view.end` satırına yazılır (süpürücü 60 sn). Kullanıcı + kayıt başına tek etkin belirteç.
 */
export interface RecViewTokenEntry {
  kind: "recView";
  rid: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  authSessionId: string;
  idleUntil: number;
  maxUntil: number;
  partsServed: number;
  bytesServed: number;
  throttled: number;
}

// --- Oda kayıt belleği (K4 sahibi; `room.rec`, §6.2) ---

export interface RoomRecSourceGone {
  at: number;
  series: number;
  next: number;
}

/** `room.rec` (kolon gerekmez; `hello`/`peer.joined` bundan türetilir). Sunucu yeniden başlarsa kaybolur (açılış süpürmesi). */
export interface RoomRec {
  rid: string;
  basis: RecBasis;
  state: "active" | "stopped";
  /** Kaydedici teknisyen soketi (`recorderOf(room)`; P28c genişleme noktası). */
  recorderConnId: string | undefined;
  series: number;
  nextPart: number;
  lastPartAt: number | undefined;
  /** Durma payı (S-P28e-1). */
  stopSeries?: number;
  stopNext?: number;
  stoppedAt?: number;
  /** Kaynak eş (misafir/cihaz) odada yok (S-P28e-2). */
  sourceGone?: RoomRecSourceGone;
  /** Oturum başına en çok bir `consent_rejected` audit satırı (S-P28e-10). */
  consentRejected?: boolean;
}

/** Odada kayıt yokken (`room.rec` tanımsız) kapı kararları için ek bellek: rıza penceresi ilk admit `hello`'sundan başlar. */
export interface RoomRecGate {
  firstAdmitHelloAt: number | undefined;
}

// --- Aktörler ---

/** Audit aktörü: müşteri (`start{consent}`/`stop{revoked}`), teknisyen (`tenant_policy`, view, delete) ya da sistem. */
export type RecActor =
  { kind: "customer"; ctx: AuditContext } | { kind: "user"; userId: string; username: string; ctx: AuditContext } | { kind: "system" };

// --- K4 → K3: servis (signaling, admit, oda kapanışı, işler bunu çağırır) ---

export interface RecStartConsentInput {
  tenantId: string;
  sessionId: string;
  /** Kayıt açılırken kaydedici olacak teknisyen (`recorder_user_id`). */
  recorderUserId: string | undefined;
  lineSha256: string;
  actor: RecActor;
}
export interface RecStartPolicyInput {
  tenantId: string;
  sessionId: string;
  recorderUserId: string;
  consentMode: ConsentMode;
  actor: RecActor;
}
/** Başlatma sonucu: açıldı ya da kayıt yok (kapalı / kota-disk). `unavailable`/`quota` → `rec.state{off, reason}`. */
export type RecStartResult =
  { ok: true; rid: string; startedAt: Date; basis: RecBasis } | { ok: false; reason: Extract<RecStateReason, "unavailable" | "quota"> };

export interface RecStopInput {
  tenantId: string;
  rid: string;
  reason: RecStopReason;
  code?: RecStopErrorCode;
  actor: RecActor;
}
export interface RecStopResult {
  /** false: zaten `STOPPED`/`DELETED` (idempotent; audit/yayın yok). */
  changed: boolean;
  durationMs: number;
  sizeBytes: number;
  stoppedAt: Date;
}

export interface RecIssueUploadInput {
  rid: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  authSessionId: string;
  connId: string;
}

/** Yükleme belirteçlerini düşürme kapsamı; `graceMs` verilirse ancak o süre sonra düşer (15 sn pay yalnız soket/oda/stop). */
export type RecTokenDropScope =
  | { by: "rid"; rid: string; graceMs?: number }
  | { by: "conn"; connId: string; graceMs?: number }
  | { by: "session"; sessionId: string; graceMs?: number }
  | { by: "authSession"; authSessionId: string }
  | { by: "user"; userId: string }
  | { by: "tenant"; tenantId: string };

export interface RecService {
  /** Rıza kapısı geçtikten sonra (§6.2) tek TX: kayıt INSERT + `session_consents(RECORDING, GRANTED, line_sha256)` + audit. */
  startConsent(input: RecStartConsentInput): Promise<RecStartResult>;
  /** Gözetimsiz admit TX'i içinde (§2.2; ayar TX'te yeniden okunur). Rıza satırı yazılmaz. */
  startPolicy(tx: Tx, input: RecStartPolicyInput): Promise<RecStartResult>;
  /** `recording.start` fail satırı (V-PE-2): `device_outdated`/`unsupported`/`quota` ya da `consent_rejected{code}`. */
  auditStartFail(input: {
    tenantId: string;
    sessionId: string;
    basis: RecBasis;
    reason: RecStartFailReason;
    code?: RecConsentRejectCode;
    consentMode?: ConsentMode;
    actor: RecActor;
  }): Promise<void>;
  /** Her kapanış (kilit `lockTenantRecording`, §5.5). `revoked` ise ayrıca `session_consents(RECORDING, REVOKED)`. */
  stop(input: RecStopInput): Promise<RecStopResult>;
  issueUploadToken(input: RecIssueUploadInput): string;
  dropUploadTokens(scope: RecTokenDropScope): void;
  /** `ConsentTextView.recording.offered`: `recording_enabled ∧ kota boş ∧ disk ≥ %10` (AC-381/384). */
  canOffer(tenantId: string): Promise<boolean>;
  /** Açılış süpürmesi: odası olmayan `ACTIVE` → `STOPPED{ERROR, orphan}` + audit. */
  sweepOrphans(liveSessionIds: ReadonlySet<string>): Promise<number>;
}

// --- K3 → K4: oda portu (parça kabulü, ayar kapatma ve oran tavanı oda belleğini okur / yayın ister) ---

export interface RecRoomPort {
  /** Odadaki kayıt belleği (oda yoksa undefined → parça 404). */
  get(sessionId: string): RoomRec | undefined;
  /** Parça kabul edildi: `nextPart`/`lastPartAt` (gözcü), bölüm değişimi. */
  partAccepted(sessionId: string, series: number, part: number, at: number): void;
  /**
   * Servis kaydı durdurdu (kota, oran tavanı, içerik hatası, politika kapatma): oda belleğine durma payı yazılır, `rec.state{off}`
   * tüm teknisyenlere + `rec1` misafire + `record1` cihaza yayınlanır, belirteç pay sonrası düşer.
   */
  stopped(sessionId: string, reason: RecStopReason, at: number): void;
}

// --- Metrikler (§11.2; `ops/metrics.ts` K4 kaydeder; tenant etiketi yok) ---

export const REC_METRICS = {
  ACTIVE: "rs_rec_active",
  PART_TOTAL: "rs_rec_part_total",
  STOP_TOTAL: "rs_rec_stop_total",
  BYTES_TOTAL: "rs_rec_bytes_total",
  PART_BYTES: "rs_rec_part_bytes",
  VIEW_THROTTLED_TOTAL: "rs_rec_view_throttled_total",
} as const;
/** `rs_rec_part_total{result}` (S-P28e-1/2/5: `stopped`, `nosource`, `busy`). */
export const REC_PART_RESULTS = ["ok", "dup", "order", "quota", "rate", "invalid", "gone", "busy", "stopped", "nosource"] as const;
export type RecPartResult = (typeof REC_PART_RESULTS)[number];

/** `recording.view.end` satırının alanları (S-P28e-3). */
export interface RecViewEndValue {
  recordingId: string;
  partsServed: number;
  bytesServed: number;
  throttled: number;
  endReason: RecViewEndReason;
}
