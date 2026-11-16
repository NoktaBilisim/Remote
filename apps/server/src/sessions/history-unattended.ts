// P28u geçmiş detayında gözetimsiz bölüm (mimari-p28u §5.4; AC-445, 446): kip, gerekçe (yalnız `silent` ve anonimleştirilmemiş
// oturumda — anonimleştirmede DB'de zaten NULL, K-P28u-15) ve audit satırlarından zaman çizelgesi (≤ 200; mevcut
// `IX(tenant_id, entity, entity_id, created_at)`). `userState` hiçbir zaman yok (D-P28u-6).
import {
  UNATTENDED_TIMELINE_MAX,
  type SessionUnattendedInfo,
  type UnattendedTimelineItem,
  type UnattendedTimelineKind,
} from "@remote/contracts/api/sessions";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import type { ConsentMode, ConsentResultDecision } from "@remote/contracts/unattended-consent";
import type { Db } from "../lib/db.ts";
import * as hrepo from "./history-repo.ts";
import { asObject } from "./history-view.ts";

const ACTIONS = [
  UNATTENDED_AUDIT.CONSENT,
  UNATTENDED_AUDIT.CONTROL_TOGGLE,
  UNATTENDED_AUDIT.LOCK,
  UNATTENDED_AUDIT.LOGOFF,
  UNATTENDED_AUDIT.REJOIN,
] as const;

function kindOf(action: string, v: Record<string, unknown>): UnattendedTimelineKind | null {
  switch (action) {
    case UNATTENDED_AUDIT.CONSENT:
      return "consent";
    case UNATTENDED_AUDIT.CONTROL_TOGGLE:
      return v.to === "control" ? "control_on" : "control_off";
    case UNATTENDED_AUDIT.LOCK:
      return "lock";
    case UNATTENDED_AUDIT.LOGOFF:
      return "logoff";
    case UNATTENDED_AUDIT.REJOIN:
      return "rejoin";
    default:
      return null;
  }
}

const DECISIONS = new Set<string>(["granted", "denied", "timeout"]);

function itemOf(a: { createdAt: Date; action: string; newValue: unknown; result: string }): UnattendedTimelineItem | null {
  const v = asObject(a.newValue);
  const kind = kindOf(a.action, v);
  if (!kind) return null;
  const item: UnattendedTimelineItem = { at: a.createdAt.toISOString(), kind };
  if (kind === "lock" || kind === "logoff" || kind === "rejoin") item.result = a.result === "success" ? "success" : "fail";
  if (kind === "consent") {
    if (typeof v.decision === "string" && DECISIONS.has(v.decision)) item.decision = v.decision as ConsentResultDecision;
    if (typeof v.ms === "number") item.ms = v.ms;
  }
  return item;
}

export async function unattendedInfo(
  db: Db,
  row: { id: string; tenantId: string; consentMode: string | null; silentReason: string | null },
  anonymized: boolean,
): Promise<SessionUnattendedInfo> {
  const audits = await hrepo.auditsOf(db, row, ACTIONS, UNATTENDED_TIMELINE_MAX);
  const mode = (row.consentMode as ConsentMode | null) ?? null;
  return {
    consentMode: mode,
    ...(mode === "silent" && !anonymized && row.silentReason ? { silentReason: row.silentReason } : {}),
    timeline: audits.flatMap((a) => {
      const i = itemOf(a);
      return i ? [i] : [];
    }),
  };
}
