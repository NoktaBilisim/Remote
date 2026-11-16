// P28b sunucu dosya servisi — yükleme ve tarama hattı (mimari-p28b §3.2, §4, §5.2, §6, §7; AC-355..362). Kapı 1–6 WS
// katmanında (`signaling/fsrv.ts`), 7–8 burada (rezervasyon TX'i). Parçalar konumlu yazılır (`chunkOffset`), SHA-256 sırayla
// güncellenir; son parçada beyanla karşılaştırılır → `.part` → `.rsf` → tarama. Durum geçişleri koşullu (repo). Bellekteki
// `Transfer` kaydı saklama gününü yükleme anındaki değerle tutar. Teslim/ret/iptal/oda kapanışı `lifecycle.ts`'te.
import { createHash, randomBytes, type Hash } from "node:crypto";
import { sanitizeFileName } from "@remote/contracts/files";
import { FSRV_AUDIT } from "@remote/contracts/audit";
import type { ServerOutbound } from "@remote/contracts/ws";
import {
  AV_SIGNATURE_PATTERN,
  DISK_MIN_FREE_RATIO,
  FSRV_CHUNK_BYTES,
  FSRV_PRINT_FILE_NAME,
  FSRV_PROGRESS_INTERVAL_MS,
  FSRV_UPLOAD_IDLE_MS,
  fsrvChunkCount,
  fsrvChunkSize,
  type FsrvDirection,
  type FsrvGateReason,
  type FsrvPurpose,
} from "@remote/contracts/ws-fsrv";
import type { JsonObject } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import { fileExtOf } from "../signaling/collab.ts";
import type { Clock } from "../signaling/types.ts";
import { chunkOffset, makeHeader, openBox, sealChunk } from "./box.ts";
import * as repo from "./repo.ts";
import type { Scanner } from "./scan.ts";
import type { FileStore } from "./store.ts";
import { TokenTable } from "./tokens.ts";

export type Side = "tech" | "guest";

/** WS çıkışı (signaling bağlar): odanın tarafına mesaj; P28a yazdırma sonucu (PRINT taranamadı/virüslü). */
export interface FsrvSink {
  send(sessionId: string, side: Side, msg: ServerOutbound): void;
  printFailed(sessionId: string, pid: string): void;
}

export interface AuditActor {
  userId?: string;
  username: string | null;
  ctx: AuditContext;
}

export interface Transfer {
  fid: string;
  xid: string;
  sessionId: string;
  tenantId: string;
  direction: FsrvDirection;
  purpose: FsrvPurpose;
  pid?: string;
  name: string;
  ext: string;
  size: number;
  sha256: string;
  rel: string;
  keyVer: number;
  header?: Buffer;
  key?: Buffer;
  next: number;
  hash?: Hash;
  retentionDays: number;
  idleTimer?: unknown;
  progressAt: number;
  /** Verilen indirme belirteci ve başarısız indirme sayısı (≤ 3). */
  downloads: number;
  failures: number;
  sender: AuditActor;
}

export interface FsrvDeps {
  db: Db;
  store: FileStore;
  secrets: SecretBox;
  scanner: Scanner;
  metrics: Metrics;
  log: { info(o: object, m: string): void; warn(o: object, m: string): void; error(o: object, m: string): void };
  clock: Clock;
}

export const senderSide = (d: FsrvDirection): Side => (d === "TO_CUSTOMER" ? "tech" : "guest");
export const recipientSide = (d: FsrvDirection): Side => (d === "TO_CUSTOMER" ? "guest" : "tech");

export interface BeginInput {
  sessionId: string;
  tenantId: string;
  direction: FsrvDirection;
  purpose: FsrvPurpose;
  xid: string;
  name: string;
  size: number;
  sha256: string;
  pid?: string;
  retentionDays: number;
  sender: AuditActor;
}

export type ChunkResult =
  | { status: 200; body: { next: number; received: number } }
  | { status: 202; body: { state: "SCANNING" } }
  | { status: 409; body: { next: number } }
  | { status: 400 | 404 }
  | { status: 409; quota: true };

export function registerFsrvMetrics(m: Metrics): void {
  m.counter("rs_fsrv_upload_total", "Sunucu dosya yüklemeleri (P28b; result: scanning|corrupt|cancelled)");
  m.counter("rs_fsrv_denied_total", "Sunucu dosya kapı retleri ve yok sayılan mesajlar (P28b; reason)");
}

export class FsrvService {
  readonly d: FsrvDeps;
  readonly tokens: TokenTable;
  readonly transfers = new Map<string, Transfer>();
  sink: FsrvSink | null = null;

  constructor(d: FsrvDeps) {
    this.d = d;
    this.tokens = new TokenTable(() => d.clock.now());
  }

  now(): Date {
    return new Date(this.d.clock.now());
  }

  send(t: Pick<Transfer, "sessionId">, side: Side, msg: ServerOutbound): void {
    this.sink?.send(t.sessionId, side, msg);
  }

  /** Yön başına etkin aktarım var mı (kapı 4: UPLOADING|SCANNING|teklifi açık CLEAN — bellekteki kayıt = etkin). */
  busy(sessionId: string, direction: FsrvDirection): boolean {
    for (const t of this.transfers.values()) if (t.sessionId === sessionId && t.direction === direction) return true;
    return false;
  }

  /** Kapı 7–8 + satır + `.part` + yükleme belirteci. Dönen: `fsrv.upload` alanları ya da ret nedeni. */
  async begin(i: BeginInput): Promise<{ fid: string; token: string; chunks: number } | { reject: FsrvGateReason }> {
    if ((await this.d.store.freeRatio()) < DISK_MIN_FREE_RATIO) return { reject: "QUOTA" };
    const fid = newId();
    const name = i.purpose === "PRINT" ? FSRV_PRINT_FILE_NAME : sanitizeFileName(i.name);
    const ext = (fileExtOf(name) ?? "").slice(0, 16);
    const rel = this.d.store.newRel(i.tenantId);
    const keyVer = this.d.secrets.currentVersion;
    const reason = await repo.reserveAndInsert(this.d.db, {
      id: fid,
      tenantId: i.tenantId,
      sessionId: i.sessionId,
      direction: i.direction,
      purpose: i.purpose,
      uploadedByUserId: i.direction === "TO_CUSTOMER" ? (i.sender.userId ?? null) : null,
      fileName: name,
      ext,
      sizeBytes: i.size,
      sha256: i.sha256,
      storageRel: rel,
      keyVer,
      createdAt: this.now(),
    });
    if (reason) return { reject: reason };
    const salt = randomBytes(32);
    const header = makeHeader(keyVer, i.size, salt);
    const t: Transfer = {
      fid,
      xid: i.xid,
      sessionId: i.sessionId,
      tenantId: i.tenantId,
      direction: i.direction,
      purpose: i.purpose,
      ...(i.pid ? { pid: i.pid } : {}),
      name,
      ext,
      size: i.size,
      sha256: i.sha256,
      rel,
      keyVer,
      header,
      key: this.d.secrets.deriveFileKey(keyVer, salt, i.tenantId, fid),
      next: 0,
      hash: createHash("sha256"),
      retentionDays: i.retentionDays,
      progressAt: 0,
      downloads: 0,
      failures: 0,
      sender: i.sender,
    };
    try {
      await this.d.store.createPart(rel, header);
    } catch (err) {
      await repo.toFinal(this.d.db, fid, ["UPLOADING"], "CANCELLED", this.now());
      throw err;
    }
    this.transfers.set(fid, t);
    this.touch(t);
    const token = this.tokens.issue({ kind: "upload", fid, sessionId: i.sessionId, tenantId: i.tenantId });
    return { fid, token, chunks: fsrvChunkCount(i.size) };
  }

  /** 10 dk hareketsizlik → CANCELLED (§4). */
  private touch(t: Transfer): void {
    this.d.clock.clearTimeout(t.idleTimer);
    t.idleTimer = this.d.clock.setTimeout(() => void this.abortUpload(t, "idle"), FSRV_UPLOAD_IDLE_MS);
  }

  /** Yükleme/tarama iptali (hareketsizlik, gönderen iptali, oda kapanışı): satır CANCELLED, `.part` silinir. */
  async abortUpload(t: Transfer, why: string): Promise<void> {
    this.forget(t);
    const n = await repo.toFinal(this.d.db, t.fid, ["UPLOADING", "SCANNING", "CLEAN"], "CANCELLED", this.now());
    await this.d.store.remove(t.rel).catch(() => undefined);
    if (n !== 1) return;
    this.d.metrics.inc("rs_fsrv_upload_total", { result: "cancelled" });
    this.audit(t, t.sender, FSRV_AUDIT.UPLOAD, false, this.uploadValue(t, "CANCELLED"));
    for (const side of ["tech", "guest"] as const) this.send(t, side, { t: "fsrv.status", fid: t.fid, state: "CANCELLED" });
    this.d.log.info({ event: "fsrv_cancelled", why, sessionId: t.sessionId }, "sunucu dosya aktarımı iptal edildi");
  }

  forget(t: Transfer): void {
    this.d.clock.clearTimeout(t.idleTimer);
    this.transfers.delete(t.fid);
    this.tokens.dropFid(t.fid);
  }

  uploadValue(t: Transfer, result: string): JsonObject {
    return { fid: t.fid, direction: t.direction, purpose: t.purpose, sizeBytes: t.size, ext: t.ext, result };
  }

  audit(t: Pick<Transfer, "sessionId" | "tenantId">, a: AuditActor, action: string, ok: boolean, value: JsonObject): void {
    void writeAudit(this.d.db, a.ctx, {
      tenantId: t.tenantId,
      ...(a.userId ? { userId: a.userId } : {}),
      username: a.username,
      action,
      entity: "support_sessions",
      entityId: t.sessionId,
      result: ok ? "success" : "fail",
      newValue: value,
    }).catch((err: unknown) => this.d.log.error({ err, action }, "fsrv audit yazılamadı"));
  }

  /** PUT parça (§4). Belirteç `onRequest`'te doğrulandı; burada sıra/boy/disk. */
  async putChunk(fid: string, n: number, body: Buffer): Promise<ChunkResult> {
    const t = this.transfers.get(fid);
    if (!t?.key || !t.header || !t.hash) return { status: 404 };
    if (n < t.next) return { status: 200, body: { next: t.next, received: Math.min(t.next * FSRV_CHUNK_BYTES, t.size) } };
    if (n > t.next) return { status: 409, body: { next: t.next } };
    if (body.length !== fsrvChunkSize(t.size, n)) return { status: 400 };
    if ((await this.d.store.freeRatio()) < DISK_MIN_FREE_RATIO) return { status: 409, quota: true };
    await this.d.store.writePart(t.rel, chunkOffset(n), sealChunk(t.key, t.header, t.size, n, body));
    if (t.next !== n) return { status: 409, body: { next: t.next } }; // eşzamanlı aynı parça
    t.hash.update(body);
    t.next = n + 1;
    this.touch(t);
    const received = Math.min(t.next * FSRV_CHUNK_BYTES, t.size);
    if (t.next < fsrvChunkCount(t.size)) {
      this.progress(t, received);
      return { status: 200, body: { next: t.next, received } };
    }
    return this.complete(t);
  }

  private progress(t: Transfer, received: number): void {
    const now = this.d.clock.now();
    if (now - t.progressAt < FSRV_PROGRESS_INTERVAL_MS) return;
    t.progressAt = now;
    const progress = Math.floor((received / t.size) * 100);
    this.send(t, recipientSide(t.direction), { t: "fsrv.status", fid: t.fid, state: "UPLOADING", progress });
  }

  private async complete(t: Transfer): Promise<ChunkResult> {
    this.tokens.dropUpload(t.fid);
    this.d.clock.clearTimeout(t.idleTimer);
    const digest = t.hash?.digest("hex");
    t.hash = undefined;
    t.key = undefined;
    t.header = undefined;
    if (digest !== t.sha256) {
      this.forget(t);
      await repo.toFinal(this.d.db, t.fid, ["UPLOADING"], "CORRUPT", this.now());
      await this.d.store.remove(t.rel).catch(() => undefined);
      this.d.metrics.inc("rs_fsrv_upload_total", { result: "corrupt" });
      this.audit(t, t.sender, FSRV_AUDIT.UPLOAD, false, this.uploadValue(t, "CORRUPT"));
      for (const side of ["tech", "guest"] as const) this.send(t, side, { t: "fsrv.status", fid: t.fid, state: "CORRUPT" });
      return { status: 202, body: { state: "SCANNING" } };
    }
    await this.d.store.commit(t.rel);
    if ((await repo.toScanning(this.d.db, t.fid)) !== 1) {
      await this.d.store.remove(t.rel).catch(() => undefined);
      this.forget(t);
      return { status: 404 };
    }
    this.d.metrics.inc("rs_fsrv_upload_total", { result: "scanning" });
    this.audit(t, t.sender, FSRV_AUDIT.UPLOAD, true, this.uploadValue(t, "SCANNING"));
    for (const side of ["tech", "guest"] as const) this.send(t, side, { t: "fsrv.status", fid: t.fid, state: "SCANNING" });
    void this.scanAndOffer(t).catch((err: unknown) => this.d.log.error({ err, sessionId: t.sessionId }, "fsrv tarama hattı hatası"));
    return { status: 202, body: { state: "SCANNING" } };
  }

  /** Tarama → CLEAN (teklif) / INFECTED / SCAN_FAILED (disk hemen silinir; iki tarafa ≤ 5 sn). */
  private async scanAndOffer(t: Transfer): Promise<void> {
    const out = await this.d.scanner.scan(t.tenantId, t.size, () => this.plain(t));
    const v = out.verdict;
    const now = this.now();
    const scanValue: JsonObject = {
      fid: t.fid,
      result: v.state,
      ...(v.state === "SCAN_FAILED" ? { reason: v.reason } : {}),
      durationMs: out.durationMs,
    };
    if (v.state === "CLEAN") {
      if ((await repo.toClean(this.d.db, t.fid, now)) !== 1) return void this.d.store.remove(t.rel).catch(() => undefined);
      this.audit(t, SYSTEM_ACTOR, FSRV_AUDIT.SCAN, true, scanValue);
      if (!this.transfers.has(t.fid)) return; // oda kapandı: iptal yolu diski siler
      this.send(t, senderSide(t.direction), { t: "fsrv.status", fid: t.fid, state: "CLEAN" });
      this.send(t, recipientSide(t.direction), {
        t: "fsrv.offer",
        fid: t.fid,
        name: t.name,
        size: t.size,
        sha256: t.sha256,
        purpose: t.purpose,
        ...(t.purpose === "PRINT" && t.pid ? { pid: t.pid } : {}),
      });
      return;
    }
    this.forget(t);
    await this.d.store.remove(t.rel).catch(() => undefined);
    const extra = v.state === "INFECTED" ? { signature: v.signature, scanned: true } : { scanReason: v.reason };
    if ((await repo.toFinal(this.d.db, t.fid, ["SCANNING"], v.state, now, extra)) !== 1) return;
    this.audit(t, SYSTEM_ACTOR, FSRV_AUDIT.SCAN, false, scanValue);
    if (v.state === "INFECTED")
      this.audit(t, SYSTEM_ACTOR, FSRV_AUDIT.INFECTED, false, {
        fid: t.fid,
        signature: v.signature ?? "unknown",
        ext: t.ext,
        sizeBytes: t.size,
      });
    const msg: ServerOutbound =
      v.state === "INFECTED"
        ? {
            t: "fsrv.status",
            fid: t.fid,
            state: "INFECTED",
            ...(v.signature && AV_SIGNATURE_PATTERN.test(v.signature) ? { signature: v.signature } : {}),
          }
        : { t: "fsrv.status", fid: t.fid, state: "SCAN_FAILED", reason: v.reason };
    for (const side of ["tech", "guest"] as const) this.send(t, side, msg);
    if (t.purpose === "PRINT" && t.pid) this.sink?.printFailed(t.sessionId, t.pid);
  }

  /** Şifreli dosyadan akışla düz metin (tarama ve içerik GET). */
  async *plain(t: Pick<Transfer, "rel" | "keyVer" | "size" | "tenantId" | "fid">): AsyncGenerator<Buffer> {
    const fh = await this.d.store.open(t.rel);
    try {
      yield* openBox(fh, { keys: this.d.secrets, keyVer: t.keyVer, plainSize: t.size, tenantId: t.tenantId, fid: t.fid });
    } finally {
      await fh.close();
    }
  }
}

export const SYSTEM_ACTOR: AuditActor = { username: "system", ctx: { ip: "", userAgent: "fsrv", requestId: "" } };
