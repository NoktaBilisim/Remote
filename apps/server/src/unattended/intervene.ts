// P28u müdahale ucu `POST /sessions/:id/unattended/{lock,logoff}` (mimari-p28u §5.3, §7.5, §8.3; AC-442–444). Ön koşullar
// sırayla: `unattended.connect` (403) → oturum bu tenant'ta (404) → çağıran oturumun teknisyeni (403) → oda canlı ∧
// gözetimsiz (katılımlı → 403) → cihaz grant'ı (404) → kontrol GRANTED (izleme → 403) → cihaz `consent1` (409
// DEVICE_OUTDATED) → bekleyen komut yok (409 INTERVENE_PENDING) → oda başına 6/dk (429). Sonra `intervene` → `intervene.result`
// (kilit 5 sn, oturum kapatma 15 sn; aşım 502 `timeout`). Her sonuç audit (`failReason`, başarısız dahil) + metrik.
import {
  INTERVENE_LOCK_TIMEOUT_MS,
  INTERVENE_LOGOFF_TIMEOUT_MS,
  INTERVENE_PER_MIN,
  interveneLockInputSchema,
  interveneLogoffInputSchema,
  type InterveneLockResponse,
  type InterveneLogoffResponse,
} from "@remote/contracts/api/unattended";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import type { InterveneCommand } from "@remote/contracts/ws-device";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContext, writeAudit, type AuditContext } from "../audit/service.ts";
import { authOf, requireAuth, requirePerm, tenantScope } from "../auth/guards.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { AppError, parseInput } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import { clearRejoinWindow, issueRejoin, openRejoinWindow } from "../signaling/rejoin-device.ts";
import type { Rooms } from "../signaling/rooms.ts";
import type { Room } from "../signaling/types.ts";
import { createGate } from "./gate.ts";
import type { DeviceHub } from "./hub.ts";

export interface InterveneDeps {
  db: Db;
  rooms: Rooms;
  hub: DeviceHub;
  metrics: Metrics;
  /** Gösterge metninde "TEST — imzasız" öneki (`UNATTENDED_MODE=unsigned`). */
  test: boolean;
}

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const TIMEOUT_MS: Record<InterveneCommand, number> = { lock: INTERVENE_LOCK_TIMEOUT_MS, logoff: INTERVENE_LOGOFF_TIMEOUT_MS };

/** Ön koşul zinciri (sırayla); geçerse canlı gözetimsiz oda. */
async function precheck(d: InterveneDeps, auth: AuthContext, tenantId: string, sessionId: string): Promise<Room> {
  const row = await d.db.supportSession.findFirst({ where: { id: sessionId, tenantId }, select: { technicianId: true } });
  if (!row) throw new AppError("NOT_FOUND");
  const room = d.rooms.get(sessionId);
  // P28c (§6): müdahale/kilit/oturum kapatma yalnız kontrol sahibi (varsayılan oturum sahibi; devirden sonra devralan).
  const controller = room ? room.multi.controllerId : row.technicianId;
  if (controller !== auth.user.id) throw new AppError("FORBIDDEN");
  const u = room?.unattended;
  if (!room || !u || !d.rooms.live(room) || !room.admitted) throw new AppError("FORBIDDEN");
  const grant = await d.db.unattendedDeviceGrant.findFirst({ where: { tenantId, deviceId: u.deviceId, userId: auth.user.id } });
  if (!grant) throw new AppError("NOT_FOUND");
  if (room.control.state !== "GRANTED") throw new AppError("FORBIDDEN", { message: "Önce kontrolü alın (kontrol açık olmalı)." });
  if (!d.hub.has(u.deviceId, "consent1")) throw new AppError("DEVICE_OUTDATED");
  if (d.hub.intervene.has(sessionId)) throw new AppError("INTERVENE_PENDING");
  const now = d.rooms.clock.now();
  const recent = (u.interveneAt ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= INTERVENE_PER_MIN) throw new AppError("RATE_LIMITED", { retryAfterSec: 60 });
  u.interveneAt = [...recent, now];
  return room;
}

/** Komutu gönderir, sonucu bekler, audit + metrik; başarısızsa 502 `INTERVENE_FAILED{fields.reason}`. */
export async function intervene(
  d: InterveneDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  sessionId: string,
  cmd: InterveneCommand,
): Promise<{ rejoin: boolean }> {
  const room = await precheck(d, auth, tenantId, sessionId);
  const u = room.unattended;
  if (!u) throw new AppError("FORBIDDEN");
  const id = newId();
  const started = d.rooms.clock.now();
  if (cmd === "logoff") openRejoinWindow(d.rooms, room);
  const wait = d.hub.intervene.wait(sessionId, id, cmd, TIMEOUT_MS[cmd]);
  if (!d.hub.sendConsent(u.deviceId, { t: "intervene", sessionId, id, cmd }))
    d.hub.intervene.settle(sessionId, { id, cmd, ok: false, reason: "no_session" });
  const out = await wait;
  let rejoin = false;
  if (cmd === "logoff") {
    if (out.ok) rejoin = await issueRejoin(d.rooms, d.hub, room, d.test);
    if (!rejoin) clearRejoinWindow(d.rooms, room);
  }
  const failReason = out.ok ? undefined : (out.reason ?? "api_error");
  d.metrics.inc("rs_unattended_intervene_total", { cmd, result: failReason ?? "ok" });
  await writeAudit(d.db, ctx, {
    tenantId,
    userId: auth.user.id,
    username: auth.user.email,
    action: cmd === "lock" ? UNATTENDED_AUDIT.LOCK : UNATTENDED_AUDIT.LOGOFF,
    entity: "support_sessions",
    entityId: sessionId,
    result: out.ok ? "success" : "fail",
    newValue: {
      deviceId: u.deviceId,
      consentMode: u.consentMode ?? null,
      durationMs: d.rooms.clock.now() - started,
      ...(failReason ? { failReason } : {}),
      ...(cmd === "logoff" ? { rejoin } : {}),
    },
  });
  if (failReason) throw new AppError("INTERVENE_FAILED", { fields: { reason: failReason } });
  return { rejoin };
}

function sessionIdOf(req: FastifyRequest): string {
  const r = ulid.safeParse((req.params as { id?: string }).id);
  if (!r.success) throw new AppError("NOT_FOUND");
  return r.data;
}

/** `/api/v1/sessions` altına (app-routes tek satır): requireAuth (CSRF) → `unattended.connect` → tenantScope → zod → servis. */
export async function interveneRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);
  const d = (): InterveneDeps => ({
    db: app.db,
    rooms: app.rooms,
    hub: app.unattendedHub,
    metrics: app.metrics,
    test: createGate(app.env).mode === "unsigned",
  });
  const perm = { preHandler: requirePerm("unattended.connect") };
  app.post("/:id/unattended/lock", perm, async (req): Promise<InterveneLockResponse> => {
    const { tenantId } = tenantScope(req);
    parseInput(interveneLockInputSchema, req.body);
    await intervene(d(), auditContext(req), authOf(req), tenantId, sessionIdOf(req), "lock");
    return { ok: true };
  });
  app.post("/:id/unattended/logoff", perm, async (req): Promise<InterveneLogoffResponse> => {
    const { tenantId } = tenantScope(req);
    parseInput(interveneLogoffInputSchema, req.body);
    const r = await intervene(d(), auditContext(req), authOf(req), tenantId, sessionIdOf(req), "logoff");
    return { ok: true, rejoin: r.rejoin };
  });
}
