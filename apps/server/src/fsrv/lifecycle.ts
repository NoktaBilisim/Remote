// P28b teklif yaşam döngüsü (mimari-p28b §3.2, §5.2 accept/reject/result/cancel; AC-357, AC-360). Yalnız bellekte kaydı olan
// (oda açık) aktarımlar işlenir; satır geçişleri koşullu (repo) — CANCELLED satıra geç gelen `fsrv.result` count 0 ile yok sayılır.
// Teslim sonrası FILE kaydı bellekten düşer (disk `expires_at`'e kadar kalır); PRINT diski teslimde/P28a son durumunda/oda kapanışında
// silinir → EXPIRED. Oda kapanınca açık tüm aktarımlar CANCELLED (PRINT CLEAN → EXPIRED).
import { FSRV_AUDIT } from "@remote/contracts/audit";
import { FSRV_DOWNLOAD_TOKENS_PER_FILE } from "@remote/contracts/ws-fsrv";
import { CUSTOMER_USERNAME, type AuditContext } from "../audit/service.ts";
import * as repo from "./repo.ts";
import { recipientSide, senderSide, type FsrvService, type Side, type Transfer } from "./service.ts";
import { TokenTable, type TokenActor } from "./tokens.ts";

const MAX_FAILURES = 3;

function forSide(svc: FsrvService, sessionId: string, fid: string, side: Side, role: "recipient" | "any"): Transfer | null {
  const t = svc.transfers.get(fid);
  if (!t || t.sessionId !== sessionId) return null;
  if (role === "recipient" && recipientSide(t.direction) !== side) return null;
  return t;
}

async function isOpenOffer(svc: FsrvService, t: Transfer): Promise<boolean> {
  const row = await repo.findRow(svc.d.db, t.fid);
  return row?.state === "CLEAN" && row.deliveredAt === null;
}

/** `fsrv.accept`: yalnız teklifin alıcısı, fid başına ≤ 3 belirteç → `fsrv.download`. */
export async function accept(svc: FsrvService, sessionId: string, fid: string, side: Side, actor: TokenActor): Promise<void> {
  const t = forSide(svc, sessionId, fid, side, "recipient");
  if (!t || t.downloads >= FSRV_DOWNLOAD_TOKENS_PER_FILE || !(await isOpenOffer(svc, t))) return;
  t.downloads += 1;
  const expiresAt = TokenTable.ttl(svc.d.clock.now());
  const token = svc.tokens.issue({ kind: "download", fid, sessionId, tenantId: t.tenantId, actor, expiresAt });
  svc.send(t, side, { t: "fsrv.download", fid, token, expiresAt: new Date(expiresAt).toISOString() });
}

/** `fsrv.reject`: alıcı reddi → REJECTED, disk hemen silinir. */
export async function reject(svc: FsrvService, sessionId: string, fid: string, side: Side): Promise<void> {
  const t = forSide(svc, sessionId, fid, side, "recipient");
  if (!t) return;
  svc.forget(t);
  await svc.d.store.remove(t.rel).catch(() => undefined);
  if ((await repo.toFinal(svc.d.db, fid, ["CLEAN"], "REJECTED", svc.now())) !== 1) return;
  svc.send(t, senderSide(t.direction), { t: "fsrv.status", fid, state: "REJECTED" });
}

/** `fsrv.result`: ok → teslim (session_files OK; PRINT diski silinir); 3. başarısızlık → CANCELLED + session_files CORRUPT. */
export async function result(svc: FsrvService, sessionId: string, fid: string, side: Side, ok: boolean): Promise<void> {
  const t = forSide(svc, sessionId, fid, side, "recipient");
  if (!t) return;
  const reportedBy = side === "tech" ? "TECH" : "CUSTOMER";
  if (ok) {
    const n = await repo.deliver(svc.d.db, { ...t, fid }, svc.now(), t.retentionDays, reportedBy);
    if (n !== 1) return;
    svc.forget(t);
    if (t.purpose === "PRINT") await svc.d.store.remove(t.rel).catch(() => undefined);
    svc.send(t, senderSide(t.direction), { t: "fsrv.status", fid, state: "DELIVERED" });
    return;
  }
  t.failures += 1;
  if (t.failures < MAX_FAILURES) return;
  svc.forget(t);
  await svc.d.store.remove(t.rel).catch(() => undefined);
  const moved = await svc.d.db.$transaction(async (tx) => {
    if ((await repo.toFinal(tx, fid, ["CLEAN"], "CANCELLED", svc.now())) !== 1) return false;
    if (t.purpose === "FILE") await repo.insertSessionFile(tx, { ...t, fid }, "CORRUPT", reportedBy);
    return true;
  });
  if (!moved) return;
  for (const s of ["tech", "guest"] as const) svc.send(t, s, { t: "fsrv.status", fid, state: "CANCELLED" });
}

/** `fsrv.cancel` (gönderen ya da alıcı): yükleme/tarama/açık teklif → CANCELLED + disk silinir. */
export async function cancel(svc: FsrvService, sessionId: string, fid: string, side: Side): Promise<void> {
  const t = forSide(svc, sessionId, fid, side, "any");
  if (t) await svc.abortUpload(t, "cancel");
}

/** P28a son durumu (basıldı/reddedildi/ABANDONED): bekleyen PRINT aktarımının diski silinir. */
export async function printDone(svc: FsrvService, sessionId: string, pid: string): Promise<void> {
  for (const t of [...svc.transfers.values()])
    if (t.sessionId === sessionId && t.purpose === "PRINT" && t.pid === pid) await closePrint(svc, t);
}

async function closePrint(svc: FsrvService, t: Transfer): Promise<void> {
  svc.forget(t);
  await svc.d.store.remove(t.rel).catch(() => undefined);
  const n = await repo.toFinal(svc.d.db, t.fid, ["CLEAN"], "EXPIRED", svc.now());
  if (n !== 1) await svc.abortUpload(t, "print_done");
}

/** Oda kapanışı: tüm belirteçler + açık aktarımlar (PRINT teklifi EXPIRED, diğerleri CANCELLED). */
export async function roomClosed(svc: FsrvService, sessionId: string): Promise<void> {
  svc.tokens.dropRoom(sessionId);
  for (const t of [...svc.transfers.values()]) {
    if (t.sessionId !== sessionId) continue;
    if (t.purpose === "PRINT" && (await isOpenOffer(svc, t))) await closePrint(svc, t);
    else await svc.abortUpload(t, "room_closed");
  }
}

/** Misafir/teknisyen ayrıldı ya da çıkarıldı: o tarafın indirme belirteçleri düşer (teklif oda kapanana dek açık kalır). */
export function sideGone(svc: FsrvService, sessionId: string, who: "TECH" | "CUSTOMER"): void {
  svc.tokens.dropRoom(sessionId, who);
}

/** İçerik GET'i için audit (`file.download`, her istek). `username`: teknisyenin kullanıcı adı (müşteride yok sayılır). */
export function auditDownload(
  svc: FsrvService,
  row: { id: string; tenantId: string; sessionId: string },
  actor: TokenActor,
  username: string | null,
  ctx: AuditContext,
): void {
  const customer = actor.kind === "CUSTOMER";
  svc.audit(row, customer ? { username: CUSTOMER_USERNAME, ctx } : { userId: actor.userId, username, ctx }, FSRV_AUDIT.DOWNLOAD, true, {
    fid: row.id,
    context: actor.kind === "HISTORY" ? "history" : "session",
    by: customer ? "customer" : "tech",
  });
}
