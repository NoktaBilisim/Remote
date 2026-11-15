/*
 * P18 (mimari-e11 §8b.3, §8b.8; AC-256, 257, 258) talep kuyruğunun web yardımcıları: sıralama (tek kaynak contracts
 * `compareQueue`), `request.updated` uygulaması, atama filtresi, SLA göstergesi ve sunucu saati ofseti.
 * Alan/şema tanımı yok; hepsi `@remote/contracts/api/requests`'ten.
 */
import { compareQueue, REQUEST_PRIORITIES, slaBreachedAt, type RequestPriority } from "@remote/contracts/api/requests";
import type { SupportRequestItem } from "./contract";

export { REQUEST_PRIORITIES, type RequestPriority };

/** Kuyruk atama filtresi (`GET /support-requests?tab=pending&assigned=`). */
export const ASSIGNED_FILTERS = ["me", "none"] as const;
export type AssignedFilter = (typeof ASSIGNED_FILTERS)[number];

export function parseAssigned(v: string | string[] | undefined): AssignedFilter | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return (ASSIGNED_FILTERS as readonly string[]).includes(s ?? "") ? (s as AssignedFilter) : undefined;
}

/** Eski fikstür / yayından önce açık sekme: P18 alanı yoksa güvenli varsayılan (öncelik NORMAL, atama yok, SLA yok). */
export function withP18Defaults(it: SupportRequestItem): SupportRequestItem {
  return {
    ...it,
    priority: it.priority ?? "NORMAL",
    assignedTo: it.assignedTo ?? null,
    slaDueAt: it.slaDueAt ?? null,
    slaBreached: it.slaBreached ?? false,
    afterHours: it.afterHours ?? false,
  };
}

/** K-P18-4: öncelik ↓ → createdAt ↑ → id ↑ (yeni dizi). */
export const sortQueue = (items: readonly SupportRequestItem[]): SupportRequestItem[] => [...items].sort(compareQueue);

/** Atama filtresine uyuyor mu (`me` = bana atanan, `none` = atanmamış). */
export function matchesAssigned(it: Pick<SupportRequestItem, "assignedTo">, filter: AssignedFilter | undefined, meId: string): boolean {
  if (!filter) return true;
  return filter === "me" ? it.assignedTo?.id === meId : it.assignedTo === null;
}

export interface RequestUpdate {
  id: string;
  priority: RequestPriority;
  assignedTo: { id: string; name: string } | null;
  slaDueAt: string | null;
}

/**
 * `request.updated` olayını listeye uygular ve yeniden sıralar. Dönüş `missing: true` → olay listede olmayan bir talebe
 * ait ve filtreye artık uyuyor (çağıran REST'ten tazeler). Filtreye uymayan öğe düşer.
 */
export function applyUpdate(
  items: readonly SupportRequestItem[],
  u: RequestUpdate,
  filter: AssignedFilter | undefined,
  meId: string,
): { items: SupportRequestItem[]; missing: boolean } {
  const i = items.findIndex((x) => x.id === u.id);
  if (i < 0) return { items: [...items], missing: matchesAssigned(u, filter, meId) && filter !== undefined };
  const next = items.map((x) =>
    x.id === u.id ? { ...x, priority: u.priority, assignedTo: u.assignedTo, slaDueAt: u.slaDueAt, slaBreached: false } : x,
  );
  return { items: sortQueue(next.filter((x) => matchesAssigned(x, filter, meId))), missing: false };
}

/**
 * Sunucu saati ofseti (ms): yanıttaki bekleyen öğelerde `createdAt + waitSec` ≈ sunucunun yanıt anı. `waitSec` aşağı
 * yuvarlandığı için en büyük tahmin alınır. Öğe yoksa 0. Aşırı değer (> 1 gün) yok sayılır (bozuk veri).
 */
export function serverOffset(items: readonly Pick<SupportRequestItem, "createdAt" | "waitSec" | "status">[], receivedAt: number): number {
  let best: number | null = null;
  for (const it of items) {
    if (it.status !== "PENDING") continue;
    const at = Date.parse(it.createdAt) + it.waitSec * 1000;
    if (!Number.isFinite(at)) continue;
    const off = at - receivedAt;
    if (best === null || off > best) best = off;
  }
  return best !== null && Math.abs(best) <= 86_400_000 ? best : 0;
}

export type SlaView =
  | { kind: "none" }
  | { kind: "due"; at: string }
  | { kind: "remaining"; ms: number }
  | { kind: "breached" }
  /** Kapanmış talep hedef içinde karşılandı (geçmiş ekranı, §8b.8). */
  | { kind: "met" };

/**
 * Oturum geçmişi talep bölümü (mimari-e11 §8b.8): sunucunun `slaBreached` kararı olduğu gibi kullanılır (sayaç yok).
 * Hedef yok → `none` (satır gösterilmez); true → aşıldı; false → içinde; hedef var ama karar null → yalnız hedef saati.
 */
export function closedSlaView(r: { slaDueAt: string | null; slaBreached: boolean | null }): SlaView {
  if (!r.slaDueAt) return { kind: "none" };
  if (r.slaBreached === true) return { kind: "breached" };
  if (r.slaBreached === false) return { kind: "met" };
  return { kind: "due", at: r.slaDueAt };
}

/**
 * SLA göstergesi: hedef yoksa yok; sunucu aşıldı dediyse ya da (sunucu saatiyle) şimdi hedefi geçtiyse aşıldı
 * (contracts `slaBreachedAt`: tam hedef anı aşım değil). `now` null (hidrasyon öncesi) → hedef saati (`due`).
 */
export function slaView(
  it: Pick<SupportRequestItem, "status" | "slaDueAt" | "slaBreached" | "closedAt">,
  now: number | null,
  offsetMs: number,
): SlaView {
  if (!it.slaDueAt) return { kind: "none" };
  if (it.slaBreached) return { kind: "breached" };
  if (now === null) return { kind: "due", at: it.slaDueAt };
  const serverNow = now + offsetMs;
  if (slaBreachedAt(it, serverNow)) return { kind: "breached" };
  return { kind: "remaining", ms: Math.max(0, Date.parse(it.slaDueAt) - serverNow) };
}

/** Kalan süre kısa metni: "1 sa 05 dk", "4 dk 09 sn", "12 sn". */
export function formatSlaRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h} sa ${p(m)} dk`;
  if (m > 0) return `${m} dk ${p(sec)} sn`;
  return `${sec} sn`;
}
