// P29 sürüm görünümü (mimari-p29 §3.2 rozet, §4.8 `GET /unattended/versions`, §9.4 `rs_unattended_agent_versions`; AC-486, 490).
// Sürüm karşılaştırması her yerde sayısal üçlü (`compareVersions`; SQL dizgi karşılaştırması 0.22.10 < 0.22.9 der). Dağılım yalnız
// gözetimsiz cihazları kapsar (A-P29-2); tenant kapsamı çağıranda (`tenantId` null yalnız Super Admin `scope=all`).
import type { DeviceUpdateBadge, DeviceVersionRow, DeviceVersionsResponse } from "@remote/contracts/api/unattended";
import { UPDATE_VERSION_PATTERN, type UpdateReason } from "@remote/contracts/api/update";
import type { Db } from "../lib/db.ts";
import { compareVersions } from "../lib/version.ts";
import type { UpdateService } from "./service.ts";

const UPDATING_FRESH_MS = 3 * 60_000;
/** §14 "metrik kardinalitesi": en çok 50 sürüm etiketi, kalanı `other`. */
export const VERSION_GAUGE_MAX = 50;
const ROWS_MAX = 200;

export interface BadgeInput {
  agentVersion: string;
  updateState: string | null;
  updateVersion: string | null;
  updateReason: string | null;
  updateAt: Date | null;
}

/** §3.2 öncelik: BELOW_MIN → UPDATING → FAILED → PENDING → CURRENT. */
export function deviceUpdateBadge(
  r: BadgeInput,
  o: { minVersion: string | undefined; publishedService: string | null; now: number },
): { badge: DeviceUpdateBadge; reason: UpdateReason | null } {
  if (o.minVersion !== undefined && compareVersions(r.agentVersion, o.minVersion) < 0) return { badge: "BELOW_MIN", reason: null };
  if (r.updateState === "INSTALLING" && r.updateAt !== null && r.updateAt.getTime() > o.now - UPDATING_FRESH_MS)
    return { badge: "UPDATING", reason: null };
  const target = r.updateVersion;
  if ((r.updateState === "FAILED" || r.updateState === "ROLLED_BACK") && target !== null && compareVersions(target, r.agentVersion) > 0)
    return { badge: "FAILED", reason: r.updateReason as UpdateReason | null };
  if (
    (o.publishedService !== null && compareVersions(o.publishedService, r.agentVersion) > 0) ||
    r.updateState === "AVAILABLE" ||
    r.updateState === "SKIPPED"
  )
    return { badge: "PENDING", reason: null };
  return { badge: "CURRENT", reason: null };
}

/** `agent_version` → cihaz sayısı (iptal edilmemiş); `tenantId` null = tüm firmalar. */
export async function versionCounts(db: Db, tenantId: string | null): Promise<{ version: string; count: number }[]> {
  const rows = await db.unattendedDevice.groupBy({
    by: ["agentVersion"],
    where: { revokedAt: null, ...(tenantId ? { tenantId } : {}) },
    _count: { _all: true },
  });
  return rows.map((r) => ({ version: r.agentVersion, count: r._count._all }));
}

/** Sürüme göre azalan (sayısal), en çok ROWS_MAX satır; `belowMin` sayısı. */
export function summarize(
  counts: { version: string; count: number }[],
  minVersion: string | undefined,
): { rows: DeviceVersionRow[]; belowMin: number } {
  const sorted = [...counts].sort((a, b) => compareVersions(b.version, a.version));
  const belowMin =
    minVersion === undefined ? 0 : counts.filter((c) => compareVersions(c.version, minVersion) < 0).reduce((n, c) => n + c.count, 0);
  return {
    rows: sorted.slice(0, ROWS_MAX).map((c) => ({ platform: "windows", component: "service", version: c.version, count: c.count })),
    belowMin,
  };
}

/** GET /unattended/versions gövdesi. Super Admin `scope=all` 60 sn önbellekli (§8). */
export class VersionsView {
  private readonly db: Db;
  private readonly updates: UpdateService;
  private readonly minVersion: string | undefined;
  private allCache: { at: number; counts: { version: string; count: number }[] } | undefined;
  /** `rs_unattended_agent_versions` göstergesinin önbelleği (senkron okunur; `refreshGauge` doldurur). */
  private gauge: { labels: { version: string }; value: number }[] = [];

  constructor(d: { db: Db; updates: UpdateService; minVersion: string | undefined }) {
    this.db = d.db;
    this.updates = d.updates;
    this.minVersion = d.minVersion;
  }

  async view(tenantId: string | null): Promise<DeviceVersionsResponse> {
    const [counts, published] = await Promise.all([
      tenantId ? versionCounts(this.db, tenantId) : this.allCounts(),
      this.updates.published(),
    ]);
    return { published, ...summarize(counts, this.minVersion) };
  }

  private async allCounts(): Promise<{ version: string; count: number }[]> {
    const now = this.updates.now();
    if (this.allCache && now - this.allCache.at < 60_000) return this.allCache.counts;
    const counts = await versionCounts(this.db, null);
    this.allCache = { at: now, counts };
    return counts;
  }

  /** §9.4: en çok 50 sürüm (en çok cihazlı), desen dışı ve kalanlar `other`. */
  async refreshGauge(): Promise<void> {
    const counts = await versionCounts(this.db, null);
    const valid = counts.filter((c) => UPDATE_VERSION_PATTERN.test(c.version)).sort((a, b) => b.count - a.count);
    const top = valid.slice(0, VERSION_GAUGE_MAX);
    const other = counts.reduce((n, c) => n + c.count, 0) - top.reduce((n, c) => n + c.count, 0);
    this.gauge = [
      ...top.map((c) => ({ labels: { version: c.version }, value: c.count })),
      ...(other > 0 ? [{ labels: { version: "other" }, value: other }] : []),
    ];
  }

  gaugeSeries(): readonly { labels: { version: string }; value: number }[] {
    return this.gauge;
  }
}
