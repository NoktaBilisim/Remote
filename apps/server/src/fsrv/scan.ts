// P28b tarayıcı (mimari-p28b §7.2–7.3, K-P28b-22..24; AC-357..359, 361): adil kuyruk + clamd INSTREAM + 60 sn bütçe +
// öz-sınama bayrağı + metrikler. Hedef her taramada `target()` ile okunur (panel > env); yoksa fail-closed `UNAVAILABLE`.
// Öz-sınama (10 dk + açılış): VERSION → imza yaşı, EICAR + şifreli zip INSTREAM (kuyruğa girmez). Erişilemezlik yalnız
// `rs_av_up=0`; kesin yanlış yanıt `avMisconfigured=true` → yeni taramalar `SCAN_FAILED/ERROR` (geçişte `onMisconfigured`).
import { AV_SELFTEST_ENCRYPTED_ZIP_B64, avEicar } from "@remote/contracts/api/clamav";
import { AV_SCAN_TIMEOUT_MS, AV_STALE_DAYS } from "@remote/contracts/ws-fsrv";
import type { Metrics } from "../ops/metrics.ts";
import { ClamdClient, parseVersion, selfTestJudgement, type ClamdTarget, type ScanVerdict } from "./clamd.ts";
import type { ScanQueue } from "./scan-queue.ts";

const DAY_MS = 86_400_000;

export interface ScanOutcome {
  verdict: ScanVerdict;
  durationMs: number;
}

export interface SelfTestResult {
  reachable: boolean;
  eicarDetected: boolean;
  encryptedDetected: boolean;
  version: string | null;
  dbDate: Date | null;
  judgement: "ok" | "misconfigured" | "unreachable";
}

interface ScannerDeps {
  client: ClamdClient;
  queue: ScanQueue;
  target(): Promise<ClamdTarget | null>;
  metrics: Metrics;
  log: { warn(o: object, m: string): void; error(o: object, m: string): void };
  now(): number;
  scanTimeoutMs?: number;
  /** Öz-sınama yanlış yapılandırmaya GEÇTİĞİNDE (lastTest ok:false yazımı). */
  onMisconfigured?(): Promise<void>;
}

const metricResult = (v: ScanVerdict): string =>
  v.state === "CLEAN" ? "clean" : v.state === "INFECTED" ? "infected" : `failed_${v.reason.toLowerCase()}`;

async function* once(b: Buffer): AsyncGenerator<Buffer> {
  yield b;
}

export function registerScanMetrics(m: Metrics, s: () => Scanner | undefined): void {
  m.counter(
    "rs_av_scan_total",
    "Virüs taramaları (P28b; result: clean|infected|failed_unavailable|failed_timeout|failed_encrypted|failed_limit|failed_busy|failed_error)",
  );
  m.counter("rs_av_scan_duration_seconds_sum", "Tarama süresi toplamı (sn; P28b)");
  m.counter("rs_av_scan_duration_seconds_count", "Tarama sayısı (P28b; süre ortalaması için)");
  m.gauge("rs_av_up", "clamd son yoklamada erişilebilir mi (1/0; P28b)", () => s()?.up ?? 0);
  m.gauge("rs_av_selftest_ok", "Son öz-sınama EICAR + şifreli zip doğru mu (1/0; P28b)", () => (s()?.misconfigured ? 0 : 1));
  m.gauge("rs_av_queue_depth", "Bekleyen tarama işleri (P28b)", () => s()?.queueDepth ?? 0);
  m.gauge("rs_av_signature_age_seconds", "İmza veritabanı yaşı (sn; bilinmiyorsa -1; P28b)", () => s()?.signatureAgeSeconds ?? -1);
}

export class Scanner {
  misconfigured = false;
  up = 0;
  signatureAgeSeconds = -1;
  private downStreak = 0;
  private readonly d: ScannerDeps;

  constructor(d: ScannerDeps) {
    this.d = d;
  }

  get queueDepth(): number {
    return this.d.queue.depth;
  }

  get stale(): boolean {
    return this.signatureAgeSeconds >= 0 && this.signatureAgeSeconds > AV_STALE_DAYS * 86_400;
  }

  private record(v: ScanVerdict, durationMs: number): ScanOutcome {
    this.d.metrics.inc("rs_av_scan_total", { result: metricResult(v) });
    this.d.metrics.inc("rs_av_scan_duration_seconds_sum", {}, durationMs / 1000);
    this.d.metrics.inc("rs_av_scan_duration_seconds_count");
    return { verdict: v, durationMs };
  }

  /** Bir dosyayı tarar; `source` yuva alındıktan sonra açılır (şifreli dosyadan akışla çözülmüş düz metin). */
  async scan(tenantId: string, sizeBytes: number, source: () => AsyncIterable<Buffer>): Promise<ScanOutcome> {
    const t0 = this.d.now();
    if (this.misconfigured) return this.record({ state: "SCAN_FAILED", reason: "ERROR" }, 0);
    const slot = await this.d.queue.acquire(tenantId, sizeBytes);
    if (slot === "BUSY") return this.record({ state: "SCAN_FAILED", reason: "BUSY" }, this.d.now() - t0);
    const started = this.d.now();
    try {
      const target = await this.d.target();
      if (!target) return this.record({ state: "SCAN_FAILED", reason: "UNAVAILABLE" }, 0);
      const v = await this.d.client.instream(target, source(), started + (this.d.scanTimeoutMs ?? AV_SCAN_TIMEOUT_MS));
      if (v.state === "SCAN_FAILED" && v.reason === "UNAVAILABLE")
        this.d.log.warn({ event: "av_unavailable" }, "virüs tarama servisine ulaşılamadı (fail-closed)");
      return this.record(v, this.d.now() - started);
    } finally {
      slot();
    }
  }

  /** EICAR + şifreli zip + VERSION (test ucu ve yoklama). Kuyruğa girmez. */
  async selfTest(target: ClamdTarget): Promise<SelfTestResult> {
    const deadline = this.d.now() + (this.d.scanTimeoutMs ?? AV_SCAN_TIMEOUT_MS);
    let version: ReturnType<typeof parseVersion> = null;
    try {
      version = parseVersion(await this.d.client.once(target, "VERSION"));
    } catch {
      return { reachable: false, eicarDetected: false, encryptedDetected: false, version: null, dbDate: null, judgement: "unreachable" };
    }
    const eicar = await this.d.client.instream(target, once(Buffer.from(avEicar(), "ascii")), deadline);
    const zip = await this.d.client.instream(target, once(Buffer.from(AV_SELFTEST_ENCRYPTED_ZIP_B64, "base64")), deadline);
    const judgement = selfTestJudgement(eicar, zip);
    return {
      reachable: judgement !== "unreachable",
      eicarDetected: eicar.state === "INFECTED",
      encryptedDetected: zip.state === "SCAN_FAILED" && zip.reason === "ENCRYPTED",
      version: version?.version ?? null,
      dbDate: version?.dbDate ?? null,
      judgement,
    };
  }

  /** 10 dk yoklama (§7.3). Hata fırlatmaz. */
  async poll(): Promise<void> {
    const target = await this.d.target().catch(() => null);
    if (!target) {
      this.up = 0;
      return;
    }
    const r = await this.selfTest(target).catch(() => null);
    if (!r || r.judgement === "unreachable") {
      this.up = 0;
      this.downStreak++;
      if (this.downStreak >= 2) this.d.log.error({ alarm: "av_down" }, "virüs tarama servisi art arda iki yoklamada erişilemedi");
      return;
    }
    this.up = 1;
    this.downStreak = 0;
    this.signatureAgeSeconds = r.dbDate ? Math.max(0, Math.floor((this.d.now() - r.dbDate.getTime()) / 1000)) : -1;
    if (r.judgement === "misconfigured") {
      const was = this.misconfigured;
      this.misconfigured = true;
      if (!was) {
        this.d.log.error({ alarm: "av_selftest_failed" }, "virüs tarama öz-sınaması başarısız: şifreli arşiv/EICAR algılanmadı");
        await this.d.onMisconfigured?.().catch((err: unknown) => this.d.log.error({ err }, "ClamAV lastTest yazılamadı"));
      }
    } else this.misconfigured = false;
  }

  /** İmza yaşı (gün) — ayar ekranı / health. */
  signatureAgeDays(): number | null {
    return this.signatureAgeSeconds < 0 ? null : Math.floor((this.signatureAgeSeconds * 1000) / DAY_MS);
  }
}
