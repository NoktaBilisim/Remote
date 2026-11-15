// P16 G5 — haftalık yetim dosya taraması (AC-243; ADR-0030 m.7, mimari-e11 §7.6, S16-9). Pazar 04:30 Europe/Istanbul.
// Disk listesi (`UploadStore.list`, sembolik bağlantı izlenmez) ÖNCE alınır, referans kümesi SONRA okunur: tarama
// sırasında yüklenip DB'ye bağlanan dosya referanslı görünür. Karşılıksız dosya `.orphans.json`'a ilk görülme anıyla
// yazılır, 7 gün sonra (o turda hâlâ karşılıksızsa) silinir; arada bağlanan dosya listeden düşer. 24 saatten eski `.tmp`
// artıkları silinir. Devre kesici: referans kümesi boşken diskte dosya varsa ya da `found / total > %20` ise o tur HİÇBİR
// şey silinmez, durum dosyası değişmez; audit `fail{reason: "circuit_open"}` + alarm logu.
import { UPLOADS_AUDIT } from "@remote/contracts/audit";
import type { FastifyBaseLogger } from "fastify";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import { readUploadReferences, UPLOAD_REFERENCE_SOURCES, type UploadReferenceSource } from "../uploads/references.ts";
import type { OrphanState, UploadStore } from "../uploads/store.ts";

const DAY_MS = 86_400_000;
/** Karşılıksız dosyanın silinmeden önceki bekleme süresi (AC-243). */
const ORPHAN_GRACE_DAYS = 7;
/** `save()` geçici artığı bu süreden eskiyse silinir. */
const TMP_MAX_AGE_MS = DAY_MS;
/** Devre kesici eşiği: bulunan / toplam bu oranı AŞARSA tur silme yapmaz (S16-9). */
const ORPHAN_CIRCUIT_RATIO = 0.2;

interface OrphanScanResult {
  outcome: "ok" | "circuit_open";
  total: number;
  found: number;
  deleted: number;
  tmpDeleted: number;
  /** Bekleyen (7 günü dolmamış) yetim sayısı. */
  pending: number;
}

interface OrphanScanDeps {
  db: Db;
  store: UploadStore;
  metrics: Metrics;
  log: FastifyBaseLogger;
  /** Yalnız testler: referans kaynakları (varsayılan `UPLOAD_REFERENCE_SOURCES`). */
  sources?: readonly UploadReferenceSource[];
}

/** Bir sonraki pazar 04:30 Europe/Istanbul (UTC+3, DST yok) = pazar 01:30 UTC. */
export function nextOrphanScanAt(nowMs: number): number {
  const d = new Date(nowMs);
  const daysToSunday = (7 - d.getUTCDay()) % 7;
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToSunday, 1, 30, 0, 0);
  return at > nowMs ? at : at + 7 * DAY_MS;
}

/** Tek süreç (ADR-0005) içinde tek örnek; eşzamanlı ikinci `run` çalışmadan `null` döner. */
export class OrphanScanJob {
  private running = false;
  /** `rs_orphan_scan_last_success_timestamp_seconds` (alarm > 8 g). Açılışta durum dosyasından yüklenir (`init`). */
  lastSuccessSeconds = 0;
  private readonly d: OrphanScanDeps;

  constructor(d: OrphanScanDeps) {
    this.d = d;
    d.metrics.counter("rs_orphan_files_total", "Yetim dosya taraması (P16 AC-243; action: found|deleted|tmp_deleted|circuit_open)");
    d.metrics.gauge(
      "rs_orphan_scan_last_success_timestamp_seconds",
      "Yetim dosya taramasının son başarılı turu (unix sn; alarm > 8 g; P16 AC-243)",
      () => this.lastSuccessSeconds,
    );
  }

  /** Haftalık iş olduğundan son başarı yeniden başlatmada kaybolmasın (yoksa gösterge 7 güne kadar 0 kalır). */
  async init(): Promise<void> {
    const s = await this.d.store.readOrphans();
    if (s.lastSuccessAt) this.lastSuccessSeconds = Math.floor(Date.parse(s.lastSuccessAt) / 1000);
  }

  async run(now = new Date()): Promise<OrphanScanResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runOnce(now);
    } finally {
      this.running = false;
    }
  }

  private async runOnce(now: Date): Promise<OrphanScanResult> {
    const { db, store } = this.d;
    const ctx = { ip: "", userAgent: "orphan-scan", requestId: newId() };
    const listing = await store.list();
    const refs = await readUploadReferences(db, this.d.sources ?? UPLOAD_REFERENCE_SOURCES);
    const orphans = listing.files.filter((f) => !refs.has(f.rel));
    const total = listing.files.length;
    const found = orphans.length;
    const base = { total, found, deleted: 0, tmpDeleted: 0 };

    if (total > 0 && (refs.size === 0 || found / total > ORPHAN_CIRCUIT_RATIO)) {
      await this.circuitOpen(ctx, total, found, refs.size);
      return { outcome: "circuit_open", ...base, pending: 0 };
    }

    const prev = await store.readOrphans();
    const next: OrphanState = { v: 1, lastSuccessAt: now.toISOString(), files: {} };
    const deleted = await this.removeExpired(orphans, prev, next, now);
    const tmpDeleted = await this.removeOldTmp(listing.tmp, now);
    await store.writeOrphans(next);
    const pending = Object.keys(next.files).length;
    await this.recordSuccess(ctx, { total, found, deleted, tmpDeleted, pending });
    this.lastSuccessSeconds = Math.floor(now.getTime() / 1000);
    return { outcome: "ok", total, found, deleted, tmpDeleted, pending };
  }

  /** Devre kesici açık: hiçbir şey silinmez; metrik + alarm logu + audit `fail`. */
  private async circuitOpen(ctx: AuditContext, total: number, found: number, references: number): Promise<void> {
    this.d.metrics.inc("rs_orphan_files_total", { action: "circuit_open" });
    this.d.log.error(
      { job: "orphan-scan", alarm: "orphan_scan_circuit_open", total, found, references },
      "yetim taraması: devre kesici açık, silme yapılmadı",
    );
    await writeAudit(this.d.db, ctx, {
      tenantId: null,
      username: "system",
      action: UPLOADS_AUDIT.ORPHAN_SCAN,
      entity: "uploads",
      result: "fail",
      newValue: { reason: "circuit_open", total, found, references },
    });
  }

  /** 7 günü dolan yetimler silinir, kalanlar ilk görülme anıyla `next`'e yazılır. Dönen: silinen sayı. */
  private async removeExpired(orphans: { rel: string }[], prev: OrphanState, next: OrphanState, now: Date): Promise<number> {
    let deleted = 0;
    for (const f of orphans) {
      const first = prev.files[f.rel] ?? now.toISOString();
      if (now.getTime() - Date.parse(first) >= ORPHAN_GRACE_DAYS * DAY_MS) {
        await this.d.store.remove(f.rel);
        deleted++;
      } else next.files[f.rel] = first;
    }
    return deleted;
  }

  /** 24 saatten eski `.tmp` artıkları. Dönen: silinen sayı. */
  private async removeOldTmp(tmp: { rel: string; mtimeMs: number }[], now: Date): Promise<number> {
    let tmpDeleted = 0;
    for (const t of tmp)
      if (now.getTime() - t.mtimeMs > TMP_MAX_AGE_MS) {
        await this.d.store.removeTmp(t.rel);
        tmpDeleted++;
      }
    return tmpDeleted;
  }

  private async recordSuccess(
    ctx: AuditContext,
    r: { total: number; found: number; deleted: number; tmpDeleted: number; pending: number },
  ): Promise<void> {
    const { metrics } = this.d;
    if (r.found > 0) metrics.inc("rs_orphan_files_total", { action: "found" }, r.found);
    if (r.deleted > 0) metrics.inc("rs_orphan_files_total", { action: "deleted" }, r.deleted);
    if (r.tmpDeleted > 0) metrics.inc("rs_orphan_files_total", { action: "tmp_deleted" }, r.tmpDeleted);
    await writeAudit(this.d.db, ctx, {
      tenantId: null,
      username: "system",
      action: UPLOADS_AUDIT.ORPHAN_SCAN,
      entity: "uploads",
      result: "success",
      newValue: { total: r.total, found: r.found, deleted: r.deleted, tmpDeleted: r.tmpDeleted, pending: r.pending },
    });
  }
}
