// P28e oturum kaydı sinyal katmanı (mimari-p28e r2 §2.1, §5.3, §6; AC-381, 382, 384, 388, 448, 450; S-P28e-1, 2, 10). Oda
// kayıt belleği (`room.rec`, yalnız commit sonrası), `rec.consent`/`rec.revoke`/`rec.error` kapıları (ilk tutan döner),
// `rec.state` yayını (teknisyen + `rec1` misafir + `record1` cihaz; rol biçimleri ayrı), durma payı belleği, kaynak eş yok
// belleği, parça gözcüsü (30 sn) ve kaydedici dönüş süresi (120 sn). Servis (`RecService`, K3) DB/audit/belirteç işini yapar;
// burası `RecRoomPort`'u sağlar (FsrvSink kalıbı). Kayıt yalnız kaydedici konsol `rs.cap.rec1` bildirdiyse başlar (K-P28e-9).
import {
  REC_CONSENT_LINE_SHA256,
  REC_CONSENT_WINDOW_MS,
  REC_RECORDER_RETURN_MS,
  REC_STOP_GRACE_MS,
  REC_WATCHDOG_MS,
  type RecErrorCode,
  type RecStateGuestMessage,
  type RecStateReason,
  type RecStateTechMessage,
  type RecStopErrorCode,
  type RecStopReason,
} from "@remote/contracts/ws-rec";
import type { AuditContext } from "../audit/service.ts";
import { newId } from "../lib/ids.ts";
import type { RecActor, RecRoomPort, RecService, RoomRec } from "../rec/types.ts";
import type { Rooms } from "./rooms.ts";
import type { Guest, Peer, RecGate, Room, TechConn } from "./types.ts";

const SYSTEM: RecActor = { kind: "system" };
const gateOf = (room: Room): RecGate => (room.recGate ??= {});
const customer = (g: Guest): RecActor => ({ kind: "customer", ctx: g.ctx ?? { ip: "", userAgent: "signaling", requestId: "" } });
const techActor = (t: TechConn): RecActor => ({ kind: "user", userId: t.userId, username: t.username, ctx: t.ctx });

/** P28c genişleme noktası (§6.3): bugün odadaki tek teknisyen — yalnız `rs.cap.rec1` bildirmiş konsol kaydedebilir. */
export function recorderOf(room: Room): TechConn | undefined {
  return room.tech?.peer.rec ? room.tech : undefined;
}

/** Kapanan odaların kayıt belleği: oda kapanışında 15 sn son parça payı (§6.4) için yan harita. */
const closedRecs = new WeakMap<Rooms, Map<string, RoomRec>>();
const closedOf = (rooms: Rooms): Map<string, RoomRec> => {
  let m = closedRecs.get(rooms);
  if (!m) closedRecs.set(rooms, (m = new Map()));
  return m;
};

/** Uygulama bağlantısı (ws.ts / wiring): servis ↔ oda portu; gösterge `rs_rec_active`. Port servisi çağrı anında okur. */
export function bindRec(rooms: Rooms, svc: RecService): RecRoomPort {
  rooms.rec = svc;
  const port = recRoomPort(rooms);
  svc.room = port;
  rooms.metrics.gauge("rs_rec_active", "Etkin (ACTIVE) oturum kayıtları", () => {
    let n = 0;
    for (const r of rooms.values()) if (r.rec?.state === "active" && !r.ending) n++;
    return n;
  });
  return port;
}

export function recRoomPort(rooms: Rooms): RecRoomPort {
  return {
    get(sessionId) {
      const room = rooms.get(sessionId);
      if (room && rooms.live(room)) return room.rec;
      return closedOf(rooms).get(sessionId);
    },
    partAccepted(sessionId, series, part, at) {
      const room = rooms.get(sessionId);
      const rec = room && rooms.live(room) ? room.rec : closedOf(rooms).get(sessionId);
      if (!rec) return;
      if (series > rec.series || (series === rec.series && part + 1 > rec.nextPart)) {
        rec.series = series;
        rec.nextPart = part + 1;
      }
      rec.lastPartAt = at;
      // D-P28e-K1-1: kaynak eş yokken `sourceGone.next` İLERLEMEZ — yalnız yoldaki tek parça (accept.ts `gate`).
      if (room && rooms.live(room)) armWatchdog(rooms, room, at);
    },
    stopped(sessionId, reason, at) {
      const room = rooms.get(sessionId);
      if (room && rooms.live(room)) applyStopped(rooms, room, reason, at);
      else {
        const rec = closedOf(rooms).get(sessionId);
        if (rec) markStopped(rec, at);
      }
    },
  };
}

// --- Mesaj kurucuları (rol başına ayrı; Go katı ayrıştırıcısı misafirde rid/basis/upload'ı reddeder) ---

function guestState(rec: RoomRec, reason?: RecStateReason): RecStateGuestMessage {
  return rec.state === "active" ? { t: "rec.state", on: true } : { t: "rec.state", on: false, ...(reason ? { reason } : {}) };
}

function techState(rec: RoomRec, reason?: RecStateReason, upload?: RecStateTechMessage["upload"]): RecStateTechMessage {
  if (rec.state !== "active") return { t: "rec.state", on: false, ...(reason ? { reason } : {}) };
  return { t: "rec.state", on: true, rid: rec.rid, basis: rec.basis, ...(upload ? { upload } : {}) };
}

/** Kaydediciye yeni yükleme belirteci (S-P28e-6); bağlam eksikse (eski TechConn) belirteç yok. */
function uploadFor(rooms: Rooms, room: Room, rec: RoomRec, t: TechConn): RecStateTechMessage["upload"] {
  const svc = rooms.rec;
  if (!svc || !t.authSessionId || !t.connId) return undefined;
  rec.recorderConnId = t.connId;
  const token = svc.issueUploadToken({
    rid: rec.rid,
    sessionId: room.sessionId,
    tenantId: room.tenantId,
    userId: t.userId,
    authSessionId: t.authSessionId,
    connId: t.connId,
  });
  return { token, series: rec.series, nextPart: rec.nextPart };
}

function sendDevice(rooms: Rooms, room: Room, on: boolean): void {
  const u = room.unattended;
  if (u) rooms.devices?.sendRecord(u.deviceId, { t: "rec.state", on });
}

/** `rec.state` yayını: teknisyen (kaydediciye `upload` yalnız `withUpload`), `rec1` misafir, `record1` cihaz. */
function broadcast(rooms: Rooms, room: Room, reason?: RecStateReason, withUpload = false): void {
  const rec = room.rec;
  if (!rec) return;
  const t = room.tech;
  if (t) {
    const upload = withUpload && recorderOf(room) === t ? uploadFor(rooms, room, rec, t) : undefined;
    t.peer.send(techState(rec, reason, upload));
  }
  const g = room.admitted?.peer;
  if (g?.rec && !room.unattended) g.send(guestState(rec, reason));
  sendDevice(rooms, room, rec.state === "active");
}

// --- hello ekleri (active.ts) ---

/** `hello.rec` = `rec.state` gövdesi (`t` yok). */
function withoutT<T extends { t: string }>(m: T): Omit<T, "t"> {
  const o: Partial<T> = { ...m };
  delete o.t;
  return o as Omit<T, "t">;
}

/** Teknisyen `hello.rec`: kaydediciye yeni belirteç; içinde parça gelmişse yeni bölüm (`series = son + 1`, §6.3). */
export function recHelloTech(rooms: Rooms, room: Room): { rec?: Omit<RecStateTechMessage, "t"> } {
  const rec = room.rec;
  const t = room.tech;
  if (!rec || !t) return {};
  let upload: RecStateTechMessage["upload"];
  if (rec.state === "active" && recorderOf(room) === t) {
    if (rec.nextPart > 0) {
      rec.series += 1;
      rec.nextPart = 0;
    }
    upload = uploadFor(rooms, room, rec, t);
    clearRecorderGone(rooms, room);
    armWatchdog(rooms, room, rooms.clock.now());
  }
  return { rec: withoutT(techState(rec, rec.state === "active" ? undefined : rec.stopReason, upload)) };
}

/**
 * Misafir `hello` (admit ve yeniden bağlanma): rıza penceresi ilk admit hello'sundan başlar; kaynak eş döndü → `sourceGone`
 * temizlenir (konsol `peer.joined` ile yeni bölüm açar). `rec` alanı yalnız `rec1` sokete ve katılımlı odada.
 */
export function recHelloGuest(rooms: Rooms, room: Room, guest: Guest): { rec?: Omit<RecStateGuestMessage, "t"> } {
  const now = rooms.clock.now();
  const gate = gateOf(room);
  gate.firstAdmitHelloAt ??= now;
  const rec = room.rec;
  if (rec?.sourceGone) {
    rec.sourceGone = undefined;
    armWatchdog(rooms, room, now);
  }
  if (!rec || room.unattended || !guest.peer?.rec) return {};
  return { rec: withoutT(guestState(rec, rec.stopReason)) };
}

// --- Kapılar ---

async function auditConsentRejected(rooms: Rooms, room: Room, guest: Guest, code: "sha" | "window"): Promise<void> {
  const gate = gateOf(room);
  if (gate.consentRejected || !rooms.rec) return;
  gate.consentRejected = true;
  await rooms.rec.auditStartFail({
    tenantId: room.tenantId,
    sessionId: room.sessionId,
    basis: "consent",
    reason: "consent_rejected",
    code,
    actor: customer(guest),
  });
}

/** §6.2 `rec.consent` kapı tablosu (sıra bağlayıcı; ilk tutan döner, sessiz yok sayılır + log). */
export async function handleRecConsent(rooms: Rooms, room: Room, guest: Guest, peer: Peer, lineSha256: string): Promise<void> {
  const svc = rooms.rec;
  const ignore = (why: string): void => {
    rooms.log.info({ event: "rec_consent_ignored", why, sessionId: room.sessionId }, "rec.consent yok sayıldı");
  };
  if (room.unattended) return ignore("unattended");
  if (lineSha256 !== REC_CONSENT_LINE_SHA256) {
    ignore("sha");
    return auditConsentRejected(rooms, room, guest, "sha");
  }
  const gate = gateOf(room);
  const first = gate.firstAdmitHelloAt;
  if (first === undefined || rooms.clock.now() - first > REC_CONSENT_WINDOW_MS) {
    ignore("window");
    return auditConsentRejected(rooms, room, guest, "window");
  }
  if (room.rec || gate.starting || !svc) return ignore("exists");
  const recorder = recorderOf(room);
  gate.starting = true;
  try {
    if (room.tech && !recorder) {
      // K-P28e-9: konsol MediaRecorder VP8 desteklemiyor → kayıt başlamaz, nedeni görünür.
      await svc.auditStartFail({
        tenantId: room.tenantId,
        sessionId: room.sessionId,
        basis: "consent",
        reason: "unsupported",
        actor: customer(guest),
      });
      if (peer.rec) peer.send({ t: "rec.state", on: false, reason: "unavailable" });
      return;
    }
    const r = await svc.startConsent({
      tenantId: room.tenantId,
      sessionId: room.sessionId,
      recorderUserId: recorder?.userId,
      lineSha256,
      actor: customer(guest),
    });
    if (!rooms.live(room)) return;
    if (!r.ok) {
      // Kota fail audit'i servis yazar (K3 `startConsent`); burada yalnız misafire neden.
      room.admitted?.peer?.send({ t: "rec.state", on: false, reason: r.reason });
      return;
    }
    activate(rooms, room, r.rid, "consent");
  } finally {
    gate.starting = false;
  }
}

/** Commit sonrası oda belleği + yayın (kaydediciye belirteç) + gözcü. */
function activate(rooms: Rooms, room: Room, rid: string, basis: RoomRec["basis"]): void {
  room.rec = { rid, basis, state: "active", recorderConnId: undefined, series: 0, nextPart: 0, lastPartAt: undefined };
  if (!room.admitted?.peer) room.rec.sourceGone = { at: rooms.clock.now(), series: 0, next: 0 };
  broadcast(rooms, room, undefined, true);
  armWatchdog(rooms, room, rooms.clock.now());
}

/** §6.2 `rec.revoke`: yalnız `basis=consent ∧ active`; aksi yok sayılır (yeniden bağlanmada ilk mesaj olarak da gelir). */
export async function handleRecRevoke(rooms: Rooms, room: Room, guest: Guest): Promise<void> {
  const rec = room.rec;
  if (!rec || rec.basis !== "consent" || rec.state !== "active" || room.unattended) return;
  await stopRec(rooms, room, "revoked", customer(guest));
}

/** §6.2 `rec.error`: yalnız kaydedici soketinden; `ACTIVE` → `STOPPED{ERROR, code}`. */
export async function handleRecError(rooms: Rooms, room: Room, tech: TechConn, code: RecErrorCode): Promise<void> {
  const rec = room.rec;
  if (!rec || rec.state !== "active" || recorderOf(room) !== tech) return;
  if (rec.recorderConnId !== undefined && rec.recorderConnId !== tech.connId) return;
  await stopRec(rooms, room, "error", techActor(tech), code);
}

/** Sinyal kaynaklı durma: servis (DB + audit) → değiştiyse oda belleği + yayın (idempotent). */
export async function stopRec(rooms: Rooms, room: Room, reason: RecStopReason, actor: RecActor, code?: RecStopErrorCode): Promise<void> {
  const svc = rooms.rec;
  const rec = room.rec;
  if (!svc || !rec || rec.state !== "active") return;
  try {
    const r = await svc.stop({ tenantId: room.tenantId, rid: rec.rid, reason, ...(code ? { code } : {}), actor });
    if (r.changed) applyStopped(rooms, room, reason, r.stoppedAt.getTime());
  } catch (err) {
    rooms.log.error({ err, ref: newId(), sessionId: room.sessionId }, "kayıt durdurulamadı");
  }
}

function markStopped(rec: RoomRec, at: number, reason?: RecStopReason): boolean {
  if (rec.state !== "active") return false;
  rec.state = "stopped";
  rec.stopSeries = rec.series;
  rec.stopNext = rec.nextPart;
  rec.stoppedAt = at;
  if (reason) rec.stopReason = reason;
  return true;
}

/** Durma belleği (S-P28e-1) + `rec.state{off}` yayını. İdempotent (servis `room.stopped` da çağırabilir). */
export function applyStopped(rooms: Rooms, room: Room, reason: RecStopReason, at: number): void {
  const rec = room.rec;
  if (!rec || !markStopped(rec, at, reason)) return;
  clearTimers(rooms, room);
  broadcast(rooms, room, reason); // metrik + belirteç düşümü servisin stop()'unda (K3 `afterStop`)
}

function clearTimers(rooms: Rooms, room: Room): void {
  const g = room.recGate;
  if (!g) return;
  rooms.clock.clearTimeout(g.watchdog);
  rooms.clock.clearTimeout(g.recorderGone);
  g.watchdog = undefined;
  g.recorderGone = undefined;
}

// --- Gözcü (K-P28e-8) ---

/** Sayılır mı: kaydedici bağlı, kaynak eş var ve görüntü akıyor (katılımlıda `share=sharing`, gözetimsizde cihaz bağlı). */
function watching(room: Room): boolean {
  const rec = room.rec;
  if (!rec || rec.state !== "active" || rec.sourceGone || !recorderOf(room) || !room.admitted?.peer) return false;
  return room.unattended ? true : room.share?.state === "sharing";
}

export function armWatchdog(rooms: Rooms, room: Room, from: number): void {
  const g = gateOf(room);
  g.watchFrom = from;
  rooms.clock.clearTimeout(g.watchdog);
  if (room.rec?.state !== "active") return;
  g.watchdog = rooms.clock.setTimeout(() => {
    g.watchdog = undefined;
    if (!rooms.live(room) || room.rec?.state !== "active") return;
    const now = rooms.clock.now();
    if (!watching(room)) return armWatchdog(rooms, room, now); // kaynak/kaydedici yokken saymaz
    if (now - (g.watchFrom ?? now) < REC_WATCHDOG_MS) return armWatchdog(rooms, room, g.watchFrom ?? now);
    void stopRec(rooms, room, "error", SYSTEM, "no_upload");
  }, REC_WATCHDOG_MS);
}

function clearRecorderGone(rooms: Rooms, room: Room): void {
  const g = room.recGate;
  if (!g) return;
  rooms.clock.clearTimeout(g.recorderGone);
  g.recorderGone = undefined;
}

// --- Oda olayları (rooms.ts) ---

/** Teknisyen bağlandı: misafir/cihaz göstergesi sürer; belirteç `hello.rec` ile gider (recHelloTech). */
export function recTechAttached(rooms: Rooms, room: Room, old: TechConn | undefined): void {
  if (old?.connId) rooms.rec?.dropUploadTokens({ by: "conn", connId: old.connId });
}

/** Teknisyen ayrıldı (§6.3): kayıt sürer; belirteç 15 sn pay sonrası düşer; 120 sn dönmezse `STOPPED{ERROR, no_upload}`. */
export function recTechDetached(rooms: Rooms, room: Room, tech: TechConn): void {
  if (tech.connId) rooms.rec?.dropUploadTokens({ by: "conn", connId: tech.connId, graceMs: REC_STOP_GRACE_MS });
  if (room.rec?.state !== "active") return;
  const g = gateOf(room);
  clearRecorderGone(rooms, room);
  g.recorderGone = rooms.clock.setTimeout(() => {
    g.recorderGone = undefined;
    if (rooms.live(room) && !recorderOf(room)) void stopRec(rooms, room, "error", SYSTEM, "no_upload");
  }, REC_RECORDER_RETURN_MS);
}

/** Kaynak eş ayrıldı (S-P28e-2): yalnız uçuştaki tek parça kabul edilir; kayıt ACTIVE kalır. */
export function recSourceGone(rooms: Rooms, room: Room): void {
  const rec = room.rec;
  if (!rec || rec.state !== "active") return;
  rec.sourceGone = { at: rooms.clock.now(), series: rec.series, next: rec.nextPart };
}

/** Oda kapandı (§6.4): `STOPPED{SESSION_END}`; bellek 15 sn yan haritada (son parça payı), belirteç pay sonrası düşer. */
export function recRoomClosed(rooms: Rooms, room: Room): void {
  clearTimers(rooms, room);
  const rec = room.rec;
  if (!rec) return;
  const closed = closedOf(rooms);
  closed.set(room.sessionId, rec);
  rooms.clock.setTimeout(() => {
    if (closed.get(room.sessionId) === rec) closed.delete(room.sessionId);
  }, REC_STOP_GRACE_MS);
  rooms.rec?.dropUploadTokens({ by: "session", sessionId: room.sessionId, graceMs: REC_STOP_GRACE_MS });
  const svc = rooms.rec;
  if (rec.state !== "active" || !svc) return;
  const at = rooms.clock.now();
  markStopped(rec, at, "session_end");
  void svc
    .stop({ tenantId: room.tenantId, rid: rec.rid, reason: "session_end", actor: SYSTEM })
    .then((r) => {
      if (r.changed) rec.stoppedAt = r.stoppedAt.getTime();
    })
    .catch((err: unknown) => rooms.log.error({ err, ref: newId(), sessionId: room.sessionId }, "kayıt oturum sonunda durdurulamadı"));
}

// --- Gözetimsiz (§2.2; P28u §13 kancaları) ---

/** admit-device TX'i commit oldu: politika kaydı açıldıysa oda belleği + yayın; açılmadıysa cihaz göstergesi kalkar. */
export function recPolicyAdmitted(rooms: Rooms, room: Room, rid: string | null): void {
  if (rid) return activate(rooms, room, rid, "tenant_policy");
  if (room.unattended?.recording) sendDevice(rooms, room, false);
}

/** Audit aktörü: `tenant_policy` → bağlanan teknisyen (bağlı değilse oda kaydındaki ad). */
export function policyActor(room: Room, ctx: AuditContext): RecActor {
  const t = room.tech;
  return t ? techActor(t) : { kind: "user", userId: room.technicianId, username: room.technicianName, ctx };
}
