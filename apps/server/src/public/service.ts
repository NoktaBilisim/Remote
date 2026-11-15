// Public join (mimari-api "Public müşteri uçları", A1/A2, AC-6/16/112/113): tek kullanımlık joinNonce
// (bellekte, aynı senkron adımda kontrol + silme) → checkPublicClient(nonce.kind) → oturum PENDING ve süresi
// dolmamış mı (yalnız okuma — tüketim admit'te) → lobiye TICKETED misafir + wsTicket + admitCode. Audit guest.pending.
import type { GuestKind } from "@remote/contracts/ws";
import type { JoinSessionInput, JoinSessionResponse } from "@remote/contracts/api/sessions";
import type { ErrorCode } from "@remote/contracts/errors";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { ipKey, netKey } from "../lib/ip.ts";
import { isOutdated } from "../lib/version.ts";
import { outdated } from "../sessions/public.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import * as repo from "../sessions/repo.ts";
import { acceptConsent } from "./consent.ts";
import type { Rooms } from "../signaling/rooms.ts";

const GONE: Partial<Record<string, ErrorCode>> = {
  ACTIVE: "SESSION_CONSUMED",
  ENDED: "SESSION_CONSUMED",
  EXPIRED: "SESSION_EXPIRED",
  CANCELLED: "SESSION_CANCELLED",
};

/** Resolve başarılıysa çağrılır: 60 sn'lik, istemci türüne bağlı nonce (ADR-0012). */
export function issueJoinNonce(
  rooms: Rooms,
  sessionId: string,
  kind: GuestKind,
  clientVersion?: string,
): { joinNonce: string; nonceExpiresAt: string } {
  const { token, expiresAt } = rooms.nonces.issue({ sessionId, kind, ...(clientVersion ? { clientVersion } : {}) });
  return { joinNonce: token, nonceExpiresAt: new Date(expiresAt).toISOString() };
}

/** AC-7: join'de 410 → audit `session.join` result=fail (yalnız neden kodu; token/kod/ad yok). Nonce tek kullanımlık ve IP limitli olduğundan tekilleştirme gerekmez. */
async function goneAudit(db: Db, ctx: AuditContext, row: { id: string; tenantId: string }, code: ErrorCode): Promise<AppError> {
  await writeAudit(db, ctx, {
    tenantId: row.tenantId,
    username: "customer",
    action: "session.join",
    entity: "support_sessions",
    entityId: row.id,
    result: "fail",
    newValue: { reason: code },
  });
  return new AppError(code);
}

export async function joinPublicSession(
  db: Db,
  rooms: Rooms,
  joinIp: FixedWindowCounter,
  ctx: AuditContext,
  checkClient: (kind: GuestKind) => void,
  input: JoinSessionInput,
  minAgentVersion?: string,
): Promise<JoinSessionResponse> {
  const ip = ipKey(ctx.ip);
  const wait = joinIp.blockedFor(ip);
  if (wait > 0 || joinIp.hit(ip)) throw new AppError("RATE_LIMITED", { retryAfterSec: Math.max(1, wait || 60) });
  const nonce = rooms.nonces.take(input.joinNonce);
  if (!nonce) throw new AppError("NONCE_INVALID");
  checkClient(nonce.kind); // kind istemci beyanı değil, nonce kaydından
  // P8b r2 (§13.4): sürüm nonce kaydından (yeniden beyan alınmaz).
  if (nonce.kind === "AGENT" && isOutdated(nonce.clientVersion, minAgentVersion)) throw outdated(minAgentVersion);

  const row = await repo.findForSignal(db, nonce.sessionId);
  if (!row) throw new AppError("NONCE_INVALID");
  const gone = row.status === "PENDING" && row.expiresAt.getTime() <= Date.now() ? "SESSION_EXPIRED" : GONE[row.status];
  if (gone) throw await goneAudit(db, ctx, row, gone);
  // G-24, AC-127: onaylanan metin oturumun tenant'ının güncel sürümü olmalı (aksi 400). Nonce tüketildi; istemci yeniden resolve eder.
  const consent = await acceptConsent(db, row.tenantId, input.consentTextId, ctx);

  let g: ReturnType<Rooms["addGuest"]>;
  try {
    g = rooms.addGuest(row, {
      name: input.customerName,
      ...(input.customerEmail ? { email: input.customerEmail } : {}),
      kind: nonce.kind,
      ipKey: ip,
      netKey: netKey(ctx.ip),
      ...(nonce.clientVersion ? { clientVersion: nonce.clientVersion } : {}),
      consent,
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "SESSION_CONSUMED") throw await goneAudit(db, ctx, row, err.code);
    throw err;
  }
  await writeAudit(db, ctx, {
    tenantId: row.tenantId,
    username: "customer",
    action: "guest.pending",
    entity: "support_sessions",
    entityId: row.id,
    result: "success",
    // S-P13a-1: ad audit'e yazılmaz (oturum satırında; saklama işiyle silinir). Zaman çizelgesi adı oturumdan alır.
    newValue: { guestId: g.guestId, guestKind: nonce.kind, consentTextId: consent.textId, consentVersion: String(consent.version) },
  });
  return { wsTicket: g.wsTicket, admitCode: g.admitCode, technicianName: row.technician.fullName };
}
