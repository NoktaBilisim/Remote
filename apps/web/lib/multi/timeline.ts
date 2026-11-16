/*
 * P28c (mimari-p28c §9, AC-369/370): geçmiş zaman çizelgesi ve katılımcı listesi metinleri. contracts `describeTimelineEvent`
 * `session.*` çoklu teknisyen eylemlerini bilmez → etiket `MULTI_AUDIT_LABELS`'tan, not `TIMELINE_DETAIL_KEYS` ayrıntılarından
 * (rol, neden, sonuç gerekçesi, davet edilen). Bilinmeyen değer ham gösterilir (uydurma yok).
 */
import { MULTI_AUDIT_LABELS, MULTI_INVITE_EXPIRE_REASON_LABELS, MULTI_LEAVE_REASON_LABELS } from "@remote/contracts/audit";
import type { SESSION_PARTICIPANT_ROLES, TimelineEvent } from "@remote/contracts/api/sessions";
import { describeTimelineEvent, labelOf, type TimelineText } from "@remote/contracts/labels";
import { t, type MessageKey } from "@/lib/i18n";

type ParticipantRole = (typeof SESSION_PARTICIPANT_ROLES)[number];

export const PARTICIPANT_ROLE_KEY: Readonly<Record<ParticipantRole, MessageKey>> = {
  owner: "mt.h.role.owner",
  participant: "mt.h.role.participant",
  observer: "mt.h.role.observer",
};

const MULTI: Readonly<Record<string, string>> = MULTI_AUDIT_LABELS;
const LEAVE: Readonly<Record<string, string>> = MULTI_LEAVE_REASON_LABELS;
const EXPIRE: Readonly<Record<string, string>> = MULTI_INVITE_EXPIRE_REASON_LABELS;
const TRANSFER_FAIL: Readonly<Record<string, string>> = {
  conflict: "Eşzamanlı başka bir değişiklik vardı",
  target_gone: "Devralan teknisyen ayrıldı, devir geri alındı",
};

/** `participants[].leaveReason`: `removed` = müşteri çıkardı; diğerleri `MULTI_LEAVE_REASON_LABELS`. */
export function leaveReasonLabel(reason: string): string {
  return reason === "removed" ? t("mt.h.removed") : labelOf(LEAVE, reason);
}

function roleLabel(role: string): string {
  return Object.hasOwn(PARTICIPANT_ROLE_KEY, role) ? t(PARTICIPANT_ROLE_KEY[role as ParticipantRole]) : role;
}

const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Zaman çizelgesi satır metni: contracts etiketi; P28c eyleminde `MULTI_AUDIT_LABELS` + ayrıntı notu. */
export function describeEvent(ev: Pick<TimelineEvent, "action" | "details">): TimelineText {
  const base = describeTimelineEvent(ev);
  if (!Object.hasOwn(MULTI, ev.action) || base.label !== ev.action) return base;
  const d = ev.details;
  const notes: string[] = [];
  const invitee = s(d.inviteeName);
  if (invitee) notes.push(t("mt.tl.invitee", { name: invitee }));
  const role = s(d.role);
  if (role) notes.push(t("mt.tl.role", { role: roleLabel(role) }));
  const reason = s(d.reason);
  if (reason) {
    if (ev.action === "session.invite_expire") notes.push(labelOf(EXPIRE, reason));
    else if (ev.action === "session.participant_leave") notes.push(leaveReasonLabel(reason));
    else notes.push(reason);
  }
  const fail = s(d.failReason);
  if (fail) notes.push(ev.action === "session.transfer" ? labelOf(TRANSFER_FAIL, fail) : fail);
  return { label: MULTI[ev.action]!, note: notes.length > 0 ? notes.join(" · ") : null, warn: false };
}
