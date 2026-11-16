// Oturum geçmişi saf izdüşümleri (history.ts'ten taşındı, PT-K12): liste satırı, zaman çizelgesi ayrıntıları, kontrol
// dönemleri, dosya raporu tekilleştirme. DB erişimi yok. history.ts dışa açık adları buradan yeniden dışa verir.
import {
  type ConsentRecordSource,
  type ControlPeriod,
  type SessionFileRecord,
  type SessionListItem,
  type SessionMode,
  type TimelineActor,
  type TimelineDetailValue,
  TIMELINE_DETAIL_KEYS,
} from "@remote/contracts/api/sessions";
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import type { CustomerFirmRef, CustomerStatus } from "@remote/contracts/api/customers";
import { FILE_CUSTOMER_REPORT_LABEL, FILE_VERIFIED_LABEL } from "@remote/contracts/labels";
import type * as hrepo from "./history-repo.ts";
import { toView } from "./service.ts";
import type { ConsentMode } from "@remote/contracts/unattended-consent";

export const durationSec = (r: { consumedAt: Date | null; endedAt: Date | null }): number | null =>
  r.consumedAt && r.endedAt ? Math.max(0, Math.floor((r.endedAt.getTime() - r.consumedAt.getTime()) / 1000)) : null;

/** Talep→kabul saniyesi (AC-158); TECH kaynağında null. */
export const waitSecOf = (r: { request: { createdAt: Date; acceptedAt: Date | null } | null }): number | null =>
  r.request?.acceptedAt ? Math.max(0, Math.floor((r.request.acceptedAt.getTime() - r.request.createdAt.getTime()) / 1000)) : null;

/** P8c müşteri firma özeti (talep ve oturum listeleri aynı biçim). */
const firmOf = (c: { id: string; name: string; status: string } | null): CustomerFirmRef | null =>
  c ? { id: c.id, name: c.name, status: c.status as CustomerStatus } : null;

export function toListItem(r: hrepo.HistoryListRow, scope: hrepo.HistoryScope, viewerId: string): Omit<SessionListItem, "waitingGuests"> {
  return {
    ...toView(r, viewerId),
    mode: (r.mode as SessionMode | null) ?? null,
    startedAt: r.consumedAt?.toISOString() ?? null,
    durationSec: durationSec(r),
    customerName: r.customerName,
    ticketNo: r.ticketNo,
    tenant: scope.kind === "all" ? { id: r.tenant.id, name: r.tenant.name } : null,
    source: r.requestId ? "REQUEST" : "TECH",
    waitSec: waitSecOf(r),
    customerFirm: firmOf(r.customer),
    anonymized: r.anonymizedAt !== null,
    consentMode: (r.consentMode as ConsentMode | null) ?? null,
    hasRecording: r.recording !== null && r.recording.state !== "DELETED",
  };
}

// ---- Detay (AC-62) ----

export type Json = unknown;
export const asObject = (v: Json): Record<string, Json> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
const MASKED = "***";
const NUMERIC_KEYS: ReadonlySet<string> = new Set(["ttlMin", "request", "monitorId"]);

function primitive(key: string, v: Json): TimelineDetailValue | undefined {
  if (v === MASKED) return undefined; // maskeli değer hiç dönmez
  if (NUMERIC_KEYS.has(key)) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d{1,9}$/.test(v)) return Number(v);
    return undefined;
  }
  if (typeof v === "string") return v.slice(0, 200);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  return undefined;
}

const selfElevatedOf = (v: Json): boolean | null => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);

/** Eylem başına izinli alan izdüşümü (§3); ham `new_value` dönmez. */
export function projectDetails(action: string, oldValue: Json, newValue: Json): Record<string, TimelineDetailValue> {
  const keys: readonly string[] = (TIMELINE_DETAIL_KEYS as Record<string, readonly string[]>)[action] ?? [];
  const nv = asObject(newValue);
  const out: Record<string, TimelineDetailValue> = {};
  for (const key of keys) {
    if (key === "selfElevated") {
      out[key] = selfElevatedOf(nv[key]);
      continue;
    }
    const raw = key === "oldCaps" ? asObject(oldValue).caps : key === "newCaps" ? nv.caps : nv[key];
    const val = primitive(key, raw);
    if (val !== undefined) out[key] = val;
  }
  if (action === CONTROL_AUDIT.CANCELLED && out.by === undefined) out.by = "tech"; // alan yoksa teknisyen (§3)
  return out;
}

export function actorOf(a: { userId: string | null; username: string | null }, technicianId: string): TimelineActor {
  if (a.userId) return a.userId === technicianId ? "TECH" : "ADMIN";
  return a.username === "customer" ? "CUSTOMER" : "SYSTEM";
}

export const CONTROL_PERIOD_ACTIONS = [CONTROL_AUDIT.GRANTED, CONTROL_AUDIT.REVOKED, CONTROL_AUDIT.RELEASED] as const;
const MATCH_SLACK_MS = 1000;

/** Listede `from`'dan itibaren zamanı (≥ at − 1 sn) uyan ilk öğe ve sonraki başlangıç indisi (her öğe bir kez eşleşir). */
function takeMatch<T extends { createdAt: Date }>(list: readonly T[], from: number, at: Date): [T | undefined, number] {
  for (let i = from; i < list.length; i++) {
    const item = list[i];
    if (item && item.createdAt.getTime() >= at.getTime() - MATCH_SLACK_MS) return [item, i + 1];
  }
  return [undefined, from];
}

/**
 * Kontrol dönemleri (§3): CONTROL satırları sırayla; her GRANTED ardından gelen ilk REVOKED ile kapanır. Kapanış yoksa
 * null (tahmin yok). `revokedReason`/`selfElevated` sıradaki ilk uygun audit'ten (≥ zaman − 1 sn); her audit bir kez eşleşir.
 */
export function deriveControlPeriods(
  consents: readonly { createdAt: Date; level: string; decision: string; source: string }[],
  audits: readonly { createdAt: Date; action: string; newValue: Json }[],
): ControlPeriod[] {
  const granted = audits.filter((a) => a.action === CONTROL_AUDIT.GRANTED);
  const closes = audits.filter((a) => a.action === CONTROL_AUDIT.REVOKED || a.action === CONTROL_AUDIT.RELEASED);
  let gi = 0;
  let ci = 0;
  const out: ControlPeriod[] = [];
  let open: ControlPeriod | null = null;
  for (const c of consents) {
    if (c.level !== "CONTROL") continue;
    if (c.decision === "GRANTED") {
      if (open) out.push(open);
      const [a, next] = takeMatch(granted, gi, c.createdAt);
      gi = next;
      open = {
        grantedAt: c.createdAt.toISOString(),
        revokedAt: null,
        revokedSource: null,
        revokedReason: null,
        selfElevated: a ? selfElevatedOf(asObject(a.newValue).selfElevated) : null,
      };
    } else if (c.decision === "REVOKED" && open) {
      const [a, next] = takeMatch(closes, ci, c.createdAt);
      ci = next;
      const reason = a ? (a.action === CONTROL_AUDIT.RELEASED ? "tech" : asObject(a.newValue).reason) : null;
      out.push({
        ...open,
        revokedAt: c.createdAt.toISOString(),
        revokedSource: c.source as ConsentRecordSource,
        revokedReason: typeof reason === "string" ? reason : null,
      });
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

// ---- P15 (AC-238): dosya raporlarının tekilleştirilmesi ----

export type FileReportRow = {
  id: string;
  reportedBy: string;
  matchKey: string | null;
  direction: string;
  sha256: string;
  sizeBytes: bigint | number;
};

/**
 * match_key'e göre grupla (NULL = eski satır, kendi başına bir grup). Teknisyen satırı varsa grup doğrulanmıştır.
 * P15 düzeltme 1 (QA 2): fid'siz istemci (0.10.x Go) alıcı raporu kendi `match_key`'ini taşır ve teknisyenin fid'li
 * gönderen raporuyla eşleşmez. Bu yüzden yalnız müşteri satırından oluşan her grup (fid'li ya da fid'siz; ayrım
 * yapılmaz), aynı yön + SHA-256 + boyuttaki, henüz müşteri eşi olmayan bir teknisyen grubuyla (sırayla, bire bir)
 * birleştirilir: teknisyen raporu varsa "doğrulanmış". fid'li müşteri satırına da uygulanması zararsızdır (doğrulama
 * yine teknisyen satırına bağlı; yalnız sayım etkilenir — guvenlik-raporu P15 kod turu 2). Eşi olmayan müşteri raporu
 * "Müşteri bildirimi" kalır. Gösterilen satır her zaman teknisyeninki.
 */
export function groupFileReports<T extends FileReportRow>(rows: readonly T[]): { row: T; verified: boolean }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.matchKey ?? `id:${r.id}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const content = (r: T) => `${r.direction}\n${r.sha256}\n${String(r.sizeBytes)}`;
  const isTech = (r: T) => r.reportedBy !== "CUSTOMER";
  const unpairedTech = new Map<string, T[][]>();
  for (const g of groups.values()) {
    const t = g.find(isTech);
    if (!t || g.length > 1) continue;
    const q = unpairedTech.get(content(t));
    if (q) q.push(g);
    else unpairedTech.set(content(t), [g]);
  }
  const out: T[][] = [];
  for (const g of groups.values()) {
    const first = g[0] as T;
    const partner = g.some(isTech) ? undefined : unpairedTech.get(content(first))?.shift();
    if (partner) partner.push(...g);
    else out.push(g);
  }
  return out.map((g) => {
    const tech = g.find(isTech);
    return { row: tech ?? (g[0] as T), verified: tech !== undefined };
  });
}

export function collapseFileReports(files: Awaited<ReturnType<typeof hrepo.filesOf>>): SessionFileRecord[] {
  return groupFileReports(files).map(({ row: f, verified }): SessionFileRecord => ({
    id: f.id,
    direction: f.direction as SessionFileRecord["direction"],
    fileName: f.fileName,
    sizeBytes: Number(f.sizeBytes),
    sha256: f.sha256,
    result: f.result as SessionFileRecord["result"],
    createdAt: f.createdAt.toISOString(),
    reportedBy: f.reportedBy === "CUSTOMER" ? "CUSTOMER" : "TECH",
    verified,
  }));
}

/** CSV "Dosyalar" hücresi: "N doğrulanmış; M müşteri bildirimi" (sıfır olan kısım yazılmaz; dosya yoksa boş). */
export function fileSummaryCell(rows: readonly FileReportRow[]): string {
  const g = groupFileReports(rows);
  const v = g.filter((x) => x.verified).length;
  const c = g.length - v;
  return [
    v ? `${v} ${FILE_VERIFIED_LABEL.toLocaleLowerCase("tr")}` : "",
    c ? `${c} ${FILE_CUSTOMER_REPORT_LABEL.toLocaleLowerCase("tr")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}
