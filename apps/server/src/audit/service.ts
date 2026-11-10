// Audit yazımı (ortak standart 1.1, AC-75). Tek giriş noktası `writeAudit`; değerler her zaman
// maskelenir. Çoklu yazmada çağıran kendi transaction istemcisini verir (aynı TX'te kayıt).
import type { FastifyRequest } from "fastify";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { maskValue, type JsonObject } from "./mask.ts";

export interface AuditContext {
  ip: string;
  userAgent: string;
  requestId: string;
}

export interface AuditEntry {
  tenantId?: string | null;
  userId?: string | null;
  username?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: JsonObject;
  newValue?: JsonObject;
  result: "success" | "fail";
}

type DbOrTx = Db | Prisma.TransactionClient;

export function auditContext(req: FastifyRequest): AuditContext {
  return { ip: req.ip, userAgent: String(req.headers["user-agent"] ?? ""), requestId: req.id };
}

export async function writeAudit(db: DbOrTx, ctx: AuditContext, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: entry.tenantId ?? null,
      userId: entry.userId ?? null,
      username: entry.username?.slice(0, 190) ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      ...(entry.oldValue ? { oldValue: maskValue(entry.oldValue) as Prisma.InputJsonObject } : {}),
      ...(entry.newValue ? { newValue: maskValue(entry.newValue) as Prisma.InputJsonObject } : {}),
      ipAddress: ctx.ip.slice(0, 45),
      userAgent: ctx.userAgent.slice(0, 300),
      result: entry.result,
      correlationId: ctx.requestId,
    },
  });
}
