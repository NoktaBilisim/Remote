// P28c (AC-369, mimari-p28c §9): geçmiş detayında "katılımcılar" — yalnız audit satırlarından türetilir (ayrı tablo yok).
// Rol son durumdur: devri alan `owner`, devreden `participant`. Ad `actorLabelOf` kuralıyla (silinmiş kullanıcı → "#X").
import { MULTI_AUDIT } from "@remote/contracts/audit";
import type { SessionParticipant } from "@remote/contracts/api/sessions";
import { actorLabelOf } from "../audit/view.ts";
import type { Db } from "../lib/db.ts";
import * as hrepo from "./history-repo.ts";
import { asObject } from "./history-view.ts";

export const PARTICIPANT_ACTIONS = [
  MULTI_AUDIT.PARTICIPANT_JOIN,
  MULTI_AUDIT.SUPERVISE_JOIN,
  MULTI_AUDIT.PARTICIPANT_LEAVE,
  MULTI_AUDIT.PARTICIPANT_REMOVE,
  MULTI_AUDIT.TRANSFER,
] as const;
/** Oturum başına üst sınır: koltuk 3, yeniden katılımlar dahil makul tavan. */
const PARTICIPANT_AUDIT_MAX = 500;

type Row = Awaited<ReturnType<typeof hrepo.auditsOf>>[number];
type Draft = Omit<SessionParticipant, "name">;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Saf türetme (sıralı audit satırları → katılımcı taslakları; ad sonra eklenir). */
export function deriveParticipants(rows: readonly Row[]): Draft[] {
  const byUser = new Map<string, Draft>();
  const get = (userId: string, role: SessionParticipant["role"]): Draft => {
    let d = byUser.get(userId);
    if (!d) {
      d = { userId, role, joinedAt: null, leftAt: null, leaveReason: null, transferredAt: null };
      byUser.set(userId, d);
    }
    return d;
  };
  for (const a of rows) {
    if (a.result !== "success") continue;
    const v = asObject(a.newValue);
    const at = a.createdAt.toISOString();
    const userId = str(v.userId);
    switch (a.action) {
      case MULTI_AUDIT.PARTICIPANT_JOIN:
      case MULTI_AUDIT.SUPERVISE_JOIN:
        if (userId) {
          const d = get(userId, a.action === MULTI_AUDIT.SUPERVISE_JOIN ? "observer" : "participant");
          if (d.role !== "owner") d.role = a.action === MULTI_AUDIT.SUPERVISE_JOIN ? "observer" : "participant";
          d.joinedAt ??= at;
          d.leftAt = null;
          d.leaveReason = null;
        }
        break;
      case MULTI_AUDIT.PARTICIPANT_LEAVE:
      case MULTI_AUDIT.PARTICIPANT_REMOVE:
        if (userId) {
          const d = get(userId, "participant");
          d.leftAt = at;
          d.leaveReason = a.action === MULTI_AUDIT.PARTICIPANT_REMOVE ? "removed" : (str(v.reason) ?? null);
        }
        break;
      case MULTI_AUDIT.TRANSFER: {
        const from = str(v.fromUserId);
        const to = str(v.toUserId);
        if (from) Object.assign(get(from, "participant"), { role: "participant", transferredAt: at });
        if (to) Object.assign(get(to, "owner"), { role: "owner", transferredAt: at });
        break;
      }
    }
  }
  return [...byUser.values()];
}

/** Geçmiş detayı için katılımcılar; tek teknisyenli oturumda `[]` (sorgu tek indeksli okuma). */
export async function participantsOf(db: Db, s: { id: string; tenantId: string }): Promise<SessionParticipant[]> {
  const drafts = deriveParticipants(await hrepo.auditsOf(db, s, PARTICIPANT_ACTIONS, PARTICIPANT_AUDIT_MAX));
  if (drafts.length === 0) return [];
  const users = new Map(
    (
      await hrepo.userNames(
        db,
        drafts.map((d) => d.userId),
      )
    ).map((u) => [u.id, u]),
  );
  return drafts.map((d) => ({ ...d, name: actorLabelOf(d.userId, users) }));
}

/** Zaman çizelgesi aktör kuralı (AC-369): katılımcı/izleyici/devreden de `TECH` sayılır. */
export const techUserIds = (drafts: readonly { userId: string }[]): Set<string> => new Set(drafts.map((d) => d.userId));
