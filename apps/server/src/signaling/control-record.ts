// P7 kontrol kayıt yardımcıları (control.ts, control-grant.ts, control-revoke.ts ortak): onay satırı + audit tek TX,
// oda başına sıralı kayıt kuyruğu, süre sınırlı bekleme, hata log + referans. Kayıt hatası istemciye sızmaz.
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { JsonObject } from "../audit/mask.ts";
import { newId } from "../lib/ids.ts";
import type { Rooms } from "./rooms.ts";
import type { Clock, CloseRecord, ConsentSource, ControlRoom, Guest, Room, TechConn } from "./types.ts";

/** AC-111: GRANTED kaydı bu sürede yazılmazsa kontrol geri alınır (1 sn şartının içinde kalmak için pay bırakıldı). */
export const CONTROL_AUDIT_TIMEOUT_MS = 800;
/** Beklenmeyen misafir mesajı logu oda başına bu aralıkta en çok bir kez (log seli önlemi). */
const UNEXPECTED_LOG_INTERVAL_MS = 60_000;

type ConsentDecision = "GRANTED" | "DENIED" | "REVOKED";

export const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };
export const CUSTOMER = { username: "customer" } as const;
export const SYSTEM = { username: "system" } as const;

export const guestCtx = (g: Guest): AuditContext => g.ctx ?? { ip: g.consent.ip, userAgent: g.consent.userAgent, requestId: newId() };
export const techActor = (t: TechConn) => ({ userId: t.userId, username: t.username });
export const systemClose = (extra: JsonObject): CloseRecord => ({
  source: "SYSTEM",
  action: CONTROL_AUDIT.REVOKED,
  ctx: SYSTEM_CTX,
  actor: SYSTEM,
  extra,
});

/** Onay satırı + audit tek TX (AC-111 zaman çizelgesi). Müşteri kaynağı dışında (SYSTEM/RECONNECT/TECH) ip/user_agent yazılmaz. */
export async function recordControl(
  rooms: Rooms,
  room: Room,
  decision: ConsentDecision,
  source: ConsentSource,
  ctx: AuditContext,
  actor: { userId?: string; username: string },
  action: string,
  extra: JsonObject = {},
): Promise<void> {
  const client = source === "UI" || source === "HOTKEY";
  await rooms.db.$transaction(async (tx) => {
    await tx.sessionConsent.create({
      data: {
        id: newId(),
        sessionId: room.sessionId,
        tenantId: room.tenantId,
        level: "CONTROL",
        decision,
        source,
        ip: client ? ctx.ip.slice(0, 45) : null,
        userAgent: client ? ctx.userAgent.slice(0, 300) : null,
      },
    });
    await writeAudit(tx, ctx, {
      tenantId: room.tenantId,
      ...actor,
      action,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: { decision, source, ...extra },
    });
  });
}

/** Kapanış kaydını (REVOKED) yazar. */
export const recordRevoked = (rooms: Rooms, room: Room, rec: CloseRecord): Promise<void> =>
  recordControl(rooms, room, "REVOKED", rec.source, rec.ctx, rec.actor, rec.action, rec.extra);

/** Kayıt hatası istemciye sızmaz: log + referans (kalite standardı). */
export function logFail(rooms: Rooms, room: Room, event: string, err: unknown): string {
  const ref = newId();
  rooms.log.error({ err, ref, event, sessionId: room.sessionId }, "kontrol kaydı yazılamadı");
  return ref;
}

/** Beklenmeyen misafir mesajı: metrik her zaman, log oda başına dakikada en çok 1. */
export function unexpected(rooms: Rooms, room: Room, event: string, fields: JsonObject): void {
  rooms.metrics.inc("rs_control_total", { event });
  const c = room.control;
  const now = rooms.clock.now();
  if (c.unexpectedLogAt !== undefined && now - c.unexpectedLogAt < UNEXPECTED_LOG_INTERVAL_MS) return;
  c.unexpectedLogAt = now;
  rooms.log.warn({ event, sessionId: room.sessionId, serverState: c.state, ...fields }, "beklenmeyen kontrol mesajı");
}

/** Sözü süre içinde sonuçlanmazsa "timeout"; reddedilirse "error". */
export function settleWithin(clock: Clock, p: Promise<void>, ms: number): Promise<"ok" | "error" | "timeout"> {
  return new Promise((resolve) => {
    const h = clock.setTimeout(() => resolve("timeout"), ms);
    p.then(
      () => {
        clock.clearTimeout(h);
        resolve("ok");
      },
      () => {
        clock.clearTimeout(h);
        resolve("error");
      },
    );
  });
}

/** Oda başına sıralı kayıt: kontrol satırları birbirinin arasına girmez. */
export function enqueue(rooms: Rooms, room: Room, job: () => Promise<void>): Promise<void> {
  const next = room.control.chain.then(job).catch((err: unknown) => void logFail(rooms, room, "control_job_failed", err));
  room.control.chain = next;
  return next;
}

/**
 * Kapanış kaydı (REVOKED). Kontrol açıksa sırada yazılır (en iyi çaba; hata log + ref). Açılış hâlâ yazılıyorsa (granting)
 * kayıt `interrupt` olarak bırakılır; GRANTED commit edilirse `onGranted` bu kayıtla dengeler (ilk kapatma kazanır).
 */
export function recordClose(rooms: Rooms, room: Room, granting: boolean, rec: CloseRecord, event: string): Promise<void> {
  if (granting) {
    room.control.interrupt ??= rec;
    return Promise.resolve();
  }
  return enqueue(rooms, room, () => recordRevoked(rooms, room, rec).catch((err: unknown) => void logFail(rooms, room, event, err)));
}

/** Kapatma ortak adımı: VIEW + epoch; kontrol açık mıydı / açılış yazılıyor muydu. VIEW'daysa null. */
export function closeState(c: ControlRoom): { opened: boolean; granting: boolean } | null {
  if (c.state === "VIEW" && !c.granting) return null;
  const r = { opened: c.state === "GRANTED" || c.granting, granting: c.granting };
  c.state = "VIEW";
  c.epoch += 1;
  return r;
}

/**
 * İstek audit'i iletimden **önce** (QA-P7-5): zaman çizelgesinde istek satırı müşterinin kararından önce gelir. Açma
 * yönü değil — yazılamazsa (hata / 800 ms) log + ref + metrik `*_request_audit_failed`, istek yine iletilir.
 */
export async function auditBeforeForward(
  rooms: Rooms,
  room: Room,
  tech: TechConn,
  action: string,
  newValue: JsonObject,
  event: string,
): Promise<void> {
  const write = writeAudit(rooms.db, tech.ctx, {
    tenantId: room.tenantId,
    ...techActor(tech),
    action,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "success",
    newValue,
  }).then(
    () => undefined,
    (err: unknown) => {
      logFail(rooms, room, event, err);
      rooms.metrics.inc("rs_control_total", { event });
      throw err;
    },
  );
  if ((await settleWithin(rooms.clock, write, CONTROL_AUDIT_TIMEOUT_MS)) === "timeout") {
    logFail(rooms, room, event, "timeout");
    rooms.metrics.inc("rs_control_total", { event });
  }
}
