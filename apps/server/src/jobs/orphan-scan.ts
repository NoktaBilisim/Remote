// P16 G5 — haftalık yetim dosya taraması (AC-243; ADR-0030 m.7, mimari-e11 §7.6, S16-9). Pazar 04:30 Europe/Istanbul.
// Disk listesi (`UploadStore.list`, sembolik bağlantı izlenmez) ÖNCE alınır, referans kümesi SONRA okunur: tarama
// sırasında yüklenip DB'ye bağlanan dosya referanslı görünür. Karşılıksız dosya `.orphans.json`'a ilk görülme anıyla
// yazılır, 7 gün sonra (o turda hâlâ karşılıksızsa) silinir; arada bağlanan dosya listeden düşer. 24 saatten eski `.tmp`
// artıkları silinir. Devre kesici: referans kümesi boşken diskte dosya varsa ya da `found / total > %20` ise o tur HİÇBİR
// şey silinmez, durum dosyası değişmez; audit `fail{reason: "circuit_open"}` + alarm logu.
import { UPLOADS_AUDIT } from "@remote/contracts/audit";
import type { FastifyBaseLogger } from "fastify";
import { writeAudit } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import { readUploadReferences, UPLOAD_REFERENCE_SOURCES, type UploadReferenceSource } from "../uploads/references.ts";
import type { OrphanState, UploadStore } from "../uploads/store.ts";

const DAY_MS = 86_400_000;
/** Karşılıksız dosyanın silinmeden önceki bekleme süresi (AC-243). */
export const ORPHAN_GRACE_DAYS = 7;
/** `save()` geçici artığı bu süreden eskiyse silinir. */
export const TMP_MAX_AGE_MS = DAY_MS;
/** Devre kesici eşiği: bulunan / toplam bu oranı AŞARSA tur silme yapmaz (S16-9). */
export const ORPHAN_CIRCUIT_RATIO = 0.2;

export interface OrphanScanResult {
  outcome: "ok" | "circuit_open";
  total: number;
  found: number;
  deleted: number;
  tmpDeleted: number;
  /** Bekleyen (7 günü dolmamış) yetim sayısı. */
  pending: number;
}

export interface OrphanScanDeps {
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
    const { db, store, metrics, log } = this.d;
    const ctx = { ip: "", userAgent: "orphan-scan", requestId: newId() };
    const listing = await store.list();
    const refs = await readUploadReferences(db, this.d.sources ?? UPLOAD_REFERENCE_SOURCES);
    const orphans = listing.files.filter((f) => !refs.has(f.rel));
    const total = listing.files.length;
    const found = orphans.length;
    const base = { total, found, deleted: 0, tmpDeleted: 0 };

    if (total > 0 && (refs.size === 0 || found / total > ORPHAN_CIRCUIT_RATIO)) {
      metrics.inc("rs_orphan_files_total", { action: "circuit_open" });
      log.error(
        { job: "orphan-scan", alarm: "orphan_scan_circuit_open", total, found, references: refs.size },
        "yetim taraması: devre kesici açık, silme yapılmadı",
      );
      await writeAudit(db, ctx, {
        tenantId: null,
        username: "system",
        action: UPLOADS_AUDIT.ORPHAN_SCAN,
        entity: "uploads",
        result: "fail",
        newValue: { reason: "circuit_open", total, found, references: refs.size },
      });
      return { outcome: "circuit_open", ...base, pending: 0 };
    }

    const prev = await store.readOrphans();
    const next: OrphanState = { v: 1, lastSuccessAt: now.toISOString(), files: {} };
    let deleted = 0;
    for (const f of orphans) {
      const first = prev.files[f.rel] ?? now.toISOString();
      if (now.getTime() - Date.parse(first) >= ORPHAN_GRACE_DAYS * DAY_MS) {
        await store.remove(f.rel);
        deleted++;
      } else next.files[f.rel] = first;
    }
    let tmpDeleted = 0;
    for (const t of listing.tmp)
      if (now.getTime() - t.mtimeMs > TMP_MAX_AGE_MS) {
        await store.removeTmp(t.rel);
        tmpDeleted++;
      }
    await store.writeOrphans(next);
    const pending = Object.keys(next.files).length;
    if (found > 0) metrics.inc("rs_orphan_files_total", { action: "found" }, found);
    if (deleted > 0) metrics.inc("rs_orphan_files_total", { action: "deleted" }, deleted);
    if (tmpDeleted > 0) metrics.inc("rs_orphan_files_total", { action: "tmp_deleted" }, tmpDeleted);
    await writeAudit(db, ctx, {
      tenantId: null,
      username: "system",
      action: UPLOADS_AUDIT.ORPHAN_SCAN,
      entity: "uploads",
      result: "success",
      newValue: { total, found, deleted, tmpDeleted, pending },
    });
    this.lastSuccessSeconds = Math.floor(now.getTime() / 1000);
    return { outcome: "ok", total, found, deleted, tmpDeleted, pending };
  }
}
