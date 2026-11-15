// Kalıcı kullanıcı silme TX gövdesi ve imha defteri yazımı (service.ts'ten taşındı, PT-K12; AC-237, AC-241, S16-17/18).
import {
  USER_DELETE_ACTIVE_MESSAGE,
  USER_DELETE_CONFIRM_MISMATCH_MESSAGE,
  USER_DELETE_OPEN_SESSION_MESSAGE,
  confirmNameMatches,
} from "@remote/contracts/api/users";
import { USER_AUDIT, deletedUserLabel } from "@remote/contracts/audit";
import { writeAudit } from "../audit/service.ts";
import { deleteForUser as deleteTrustedDevices } from "../auth/trusted-device-repo.ts";
import { AppError } from "../lib/errors.ts";
import type { UserPhase } from "../ops/erasure-ledger.ts";
import { unassignWithAudit } from "../requests/assign.ts";
import { DeniedError, ENTITY, asManaged, assertManage, effectiveOf, loadOrThrow, lockActor, stale, who, type ManagedRow } from "./guard.ts";
import * as repo from "./repo.ts";
import type { WriteCtx } from "./writes.ts";

/** Yan etkiler: avatar dosyası (commit sonrası) ve imha defteri (niyet TX içinde, done commit sonrası); hata yanıtı bozmaz. */
export interface UserPurgeEffects {
  removeFile(rel: string | null): Promise<void>;
  ledger: { append(e: { type: "user"; id: string; phase: UserPhase; at: string }): Promise<void> };
  log: { error(obj: object, msg: string): void };
}

/** Silme ön koşulları (sıra service.ts `purgeUser` açıklamasındaki gibi); hedef satırı döner. */
async function assertPurgeable(w: WriteCtx, id: string, confirmName: string, expectedVersion: number): Promise<ManagedRow> {
  const { tx, auth, tenantId } = w;
  const scope = { tenantId };
  const actor = await lockActor(tx, auth, tenantId, [id], "users.delete", w.hooks);
  // S16-17: önce kapsam/varlık — kapsamlı sorgu Super Admin'i (tenant_id NULL) ve başka firmayı hiç görmez → 404
  // (rol 403 ile ayırt edilemez, firma audit'ine Super Admin kimliği yazılmaz).
  const cur = asManaged(await loadOrThrow(tx, scope, id));
  if (cur.id === auth.user.id) throw new DeniedError("Kendi hesabınızı silemezsiniz.", ["self"]);
  assertManage(actor, effectiveOf(cur.role, cur.permissions), "Sizden daha geniş yetkili bir hesabı silemezsiniz.");
  if (cur.status !== "PASSIVE") throw new AppError("CONFLICT", { message: USER_DELETE_ACTIVE_MESSAGE });
  if ((await repo.countOpenSessions(tx, scope, id)) > 0) throw new AppError("CONFLICT", { message: USER_DELETE_OPEN_SESSION_MESSAGE });
  if (cur.version !== expectedVersion) throw stale();
  if (!confirmNameMatches(confirmName, cur.fullName))
    throw new AppError("VALIDATION", { fields: { confirmName: USER_DELETE_CONFIRM_MISMATCH_MESSAGE } });
  return cur;
}

/** DELETE /users/:id TX gövdesi; silinen avatar yolunu döner. */
export async function purgeTx(
  w: WriteCtx,
  fx: UserPurgeEffects,
  id: string,
  confirmName: string,
  expectedVersion: number,
  at: Date,
): Promise<string | null> {
  const { tx, ctx, auth, tenantId } = w;
  const cur = await assertPurgeable(w, id, confirmName, expectedVersion);
  // S16-18: niyet satırı denetimler geçtikten sonra, mezar taşından önce (commit ile defter arasında çökme penceresi yok).
  // TX'ten önce yazılmaz: reddedilecek istek (409/400/403) deftere girip geri yüklemede silinmesin.
  await appendUserLedger(fx, id, "intent", at);
  if ((await repo.tombstone(tx, id, expectedVersion, deletedUserLabel(id), at)) !== 1) throw stale();
  const counts = await repo.deleteUserChildren(tx, id);
  // P27a (AC-334, D-P27a-4): pasife alma cihazları zaten sildi; savunma (FK RESTRICT takılmasın). Audit'e ayrı alan yok.
  await deleteTrustedDevices(tx, id);
  // S-P18-T5: kullanıcı zaten PASSIVE (pasife almada atamalar kalktı); savunma amaçlı aynı TX'te tekrar (yayın yok —
  // pasife almada yapıldı; satır kalmış olamaz).
  await unassignWithAudit(tx, ctx, { userId: auth.user.id, username: auth.user.email }, { userId: id });
  await writeAudit(tx, ctx, {
    ...who(auth, tenantId),
    action: USER_AUDIT.DELETED,
    entity: ENTITY,
    entityId: id,
    result: "success",
    oldValue: { status: "PASSIVE" },
    newValue: { status: "DELETED", ...counts },
  });
  return cur.avatarPath;
}

/** Defter yazım hatası silmeyi durdurmaz; alarm loglanır (sayaç `ErasureLedger` içinde). */
export async function appendUserLedger(fx: UserPurgeEffects, id: string, phase: UserPhase, at: Date): Promise<void> {
  try {
    await fx.ledger.append({ type: "user", id, phase, at: at.toISOString() });
  } catch (err) {
    fx.log.error({ err, alarm: "erasure_ledger_write_failed", userId: id, phase }, "imha defterine yazılamadı");
  }
}
