// P28e kayıt servisi (mimari-p28e r2 §2.1–§2.2, §3.2, §5.1–§5.5, §6.2–§6.5, §11; ADR-0034; AC-381..388, 448, 450). K4 sinyal
// katmanı `RecService` arayüzünü çağırır (rec/types.ts), oda belleğini `room` portuyla verir (FsrvSink kalıbı; null iken parça
// 404). Otorite sunucudur: durum, kota, oran tavanı, durma payı. Parça = bir `.rsf` (P28b `box.ts`/`store.ts` değişmeden).
// `room.stopped` YALNIZ servisin kendi başlattığı durmalarda (kota, oran, içerik, ayar kapatma) çağrılır; K4'ün çağırdığı
// `stop()` yayını K4 yapar (çift yayın yok).
import { randomBytes } from "node:crypto";
import { RECORDING_AUDIT } from "@remote/contracts/audit";
import { DISK_MIN_FREE_RATIO, FSRV_CHUNK_BYTES } from "@remote/contracts/ws-fsrv";
import {
  REC_CONSENT_LINE_SHA256,
  REC_STOP_GRACE_MS,
  recToDb,
  type RecBasis,
  type RecStopErrorCode,
  type RecStopReason,
} from "@remote/contracts/ws-rec";
import type { JsonObject } from "../audit/mask.ts";
import { CUSTOMER_USERNAME, writeAudit, type AuditContext } from "../audit/service.ts";
import { chunkOffset, makeHeader, openBox, sealChunk } from "../fsrv/box.ts";
import type { FileStore } from "../fsrv/store.ts";
import { storageUsage } from "../fsrv/usage.ts";
import type { SecretBox } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { Clock } from "../signaling/types.ts";
import { decidePart, type PartDecision } from "./accept.ts";
import * as repo from "./repo.ts";
import { RecTokenTable, type RecTokenEntry } from "./tokens.ts";
import {
  REC_METRICS,
  type RecActor,
  type RecIssueUploadInput,
  type RecPartResult,
  type RecRoomPort,
  type RecService,
  type RecStartConsentInput,
  type RecStartPolicyInput,
  type RecStartResult,
  type RecStopInput,
  type RecStopResult,
  type RecTokenDropScope,
  type RecUploadTokenEntry,
  type Tx,
} from "./types.ts";
import { checkWebmContinuation, checkWebmHeader } from "./webm.ts";

const DAY_MS = 86_400_000;
const GB = 1024 ** 3;
const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "rec", requestId: "" };

export interface RecDeps {
  db: Db;
  store: FileStore;
  secrets: SecretBox;
  metrics: Metrics;
  log: { info(o: object, m: string): void; warn(o: object, m: string): void; error(o: object, m: string): void };
  clock: Clock;
}

/** Parça yükleme sonucu (rota HTTP'ye çevirir). */
export type PartOutcome = Exclude<PartDecision, { kind: "accept" }> | { kind: "ok"; next: number } | { kind: "quota" };

export interface PartRequest {
  entry: RecUploadTokenEntry;
  s: number;
  p: number;
  durationMs: number;
  seriesStartMs: number | undefined;
}

/** Audit aktörü → satır alanları (müşteri IP'si `writeAudit`'te ağ önekine indirgenir). */
function who(a: RecActor): { userId?: string; username: string; ctx: AuditContext } {
  if (a.kind === "customer") return { username: CUSTOMER_USERNAME, ctx: a.ctx };
  if (a.kind === "user") return { userId: a.userId, username: a.username, ctx: a.ctx };
  return { username: "system", ctx: SYSTEM_CTX };
}

const RESULT_OF: Partial<Record<PartOutcome["kind"], RecPartResult>> = {
  ok: "ok",
  dup: "dup",
  order: "order",
  conflict: "order",
  quota: "quota",
  rate: "rate",
  invalid: "invalid",
};

export class RecServiceImpl implements RecService {
  readonly d: RecDeps;
  readonly tokens = new RecTokenTable();
  /** K4 bağlar (`signaling/rec.ts`); bağlanmadan parça kabul edilmez (oda bilinmiyor → 404). */
  room: RecRoomPort | null = null;

  constructor(d: RecDeps) {
    this.d = d;
  }

  private now(): number {
    return this.d.clock.now();
  }

  async audit(
    db: Db | Tx,
    t: { tenantId: string; sessionId: string },
    actor: RecActor,
    action: string,
    ok: boolean,
    value: JsonObject,
  ): Promise<void> {
    const a = who(actor);
    await writeAudit(db, a.ctx, {
      tenantId: t.tenantId,
      ...(a.userId ? { userId: a.userId } : {}),
      username: a.username,
      action,
      entity: "support_sessions",
      entityId: t.sessionId,
      result: ok ? "success" : "fail",
      newValue: value,
    });
  }

  /** Kota (dosya + kayıt, V50) + disk %10. `extra` = eklenecek bayt. */
  private async capacityOk(db: Db | Tx, tenantId: string, extra: number): Promise<boolean> {
    if ((await this.d.store.freeRatio()) < DISK_MIN_FREE_RATIO) return false;
    const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { storageQuotaGb: true } });
    const used = await storageUsage(db, tenantId);
    const quota = (t?.storageQuotaGb ?? 0) * GB;
    return extra > 0 ? used + extra <= quota : used < quota;
  }

  async canOffer(tenantId: string): Promise<boolean> {
    const s = await repo.settingsOf(this.d.db, tenantId);
    return s.enabled && (await this.capacityOk(this.d.db, tenantId, 0));
  }

  // ------------------------------------------------------------------------------------------------ başlatma

  private async open(
    tx: Tx,
    i: { tenantId: string; sessionId: string; recorderUserId: string | undefined; actor: RecActor },
    basis: RecBasis,
    policy: boolean,
    extra: JsonObject,
  ): Promise<RecStartResult> {
    const s = await repo.lockSettings(tx, i.tenantId, "share");
    if (!s?.enabled || (policy && !s.unattendedEnabled)) return { ok: false, reason: "unavailable" };
    await repo.lockTenantRecording(tx, i.tenantId);
    if (await repo.findBySession(tx, i.tenantId, i.sessionId)) return { ok: false, reason: "unavailable" };
    if (!(await this.capacityOk(tx, i.tenantId, 0))) {
      await this.audit(tx, i, i.actor, RECORDING_AUDIT.START, false, { basis, reason: "quota", ...extra });
      return { ok: false, reason: "quota" };
    }
    const startedAt = new Date(this.now());
    const rid = newId();
    await tx.sessionRecording.create({
      data: {
        id: rid,
        tenantId: i.tenantId,
        sessionId: i.sessionId,
        basis: recToDb(basis),
        state: "ACTIVE",
        recorderUserId: i.recorderUserId ?? null,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + s.retentionDays * DAY_MS),
      },
      select: { id: true },
    });
    if (!policy) await this.consentRow(tx, i, "GRANTED");
    await this.audit(tx, i, i.actor, RECORDING_AUDIT.START, true, { recordingId: rid, basis, ...extra });
    return { ok: true, rid, startedAt, basis };
  }

  /** `session_consents(RECORDING)`: oturumun VIEW GRANTED metni kopyalanır (§3.1), `line_sha256` güncel SHA. */
  private async consentRow(tx: Tx, i: { tenantId: string; sessionId: string; actor: RecActor }, decision: "GRANTED" | "REVOKED") {
    const text = await repo.viewConsentText(tx, i.tenantId, i.sessionId);
    const ctx = i.actor.kind === "system" ? null : i.actor.ctx;
    await tx.sessionConsent.create({
      data: {
        id: newId(),
        sessionId: i.sessionId,
        tenantId: i.tenantId,
        level: "RECORDING",
        decision,
        source: "UI",
        consentTextId: text?.consentTextId ?? null,
        consentSha256: text?.consentSha256 ?? null,
        lineSha256: REC_CONSENT_LINE_SHA256,
        ip: ctx?.ip ? ctx.ip.slice(0, 45) : null,
        userAgent: ctx?.userAgent ? ctx.userAgent.slice(0, 300) : null,
      },
      select: { id: true },
    });
  }

  /** Kapı K4'te (§6.2). Kota sonucunda `recording.start` fail audit'ini BURADA yazar (K4 ayrıca `auditStartFail` çağırmaz). */
  async startConsent(i: RecStartConsentInput): Promise<RecStartResult> {
    if (i.lineSha256 !== REC_CONSENT_LINE_SHA256) return { ok: false, reason: "unavailable" };
    return this.d.db.$transaction((tx) => this.open(tx, i, "consent", false, {}));
  }

  startPolicy(tx: Tx, i: RecStartPolicyInput): Promise<RecStartResult> {
    return this.open(tx, i, "tenant_policy", true, { consentMode: i.consentMode });
  }

  async auditStartFail(i: Parameters<RecService["auditStartFail"]>[0]): Promise<void> {
    await this.audit(this.d.db, i, i.actor, RECORDING_AUDIT.START, false, {
      basis: i.basis,
      reason: i.reason,
      ...(i.code ? { cause: i.code } : {}), // audit anahtarı `cause`: `code` maske kalıbına takılır (mask.ts)
      ...(i.consentMode ? { consentMode: i.consentMode } : {}),
    });
  }

  // ------------------------------------------------------------------------------------------------ durdurma

  /** TX içi durdurma (çağıran kilidi almıştır). Dönen: değişti mi + satır. */
  async stopLocked(tx: Tx, rec: repo.RecRow, reason: RecStopReason, code: RecStopErrorCode | undefined, actor: RecActor, now: Date) {
    if (rec.state !== "ACTIVE" || (await repo.markStopped(tx, rec.id, recToDb(reason), now)) !== 1) return false;
    if (reason === "revoked" && rec.basis === "CONSENT") await this.consentRow(tx, { ...rec, actor }, "REVOKED");
    await this.audit(tx, rec, actor, RECORDING_AUDIT.STOP, true, {
      recordingId: rec.id,
      reason,
      ...(code ? { cause: code } : {}), // `code` değil: maske kalıbı (mask.ts) değeri "***" yapar
      durationMs: rec.durationMs,
      sizeBytes: Number(rec.sizeBytes),
    });
    return true;
  }

  async stop(i: RecStopInput): Promise<RecStopResult> {
    const now = new Date(this.now());
    const r = await this.d.db.$transaction(async (tx) => {
      const [rec] = await repo.lockTenantRecording(tx, i.tenantId, [i.rid]);
      if (!rec) return { changed: false, rec: null };
      return { changed: await this.stopLocked(tx, rec, i.reason, i.code, i.actor, now), rec };
    });
    if (r.changed) this.afterStop(i.rid, i.reason);
    return {
      changed: r.changed,
      durationMs: r.rec?.durationMs ?? 0,
      sizeBytes: Number(r.rec?.sizeBytes ?? 0),
      stoppedAt: r.changed ? now : (r.rec?.stoppedAt ?? now),
    };
  }

  afterStop(rid: string, reason: RecStopReason): void {
    this.d.metrics.inc(REC_METRICS.STOP_TOTAL, { reason });
    this.dropUploadTokens({ by: "rid", rid, graceMs: REC_STOP_GRACE_MS });
  }

  /** Servisin kendi başlattığı durma (kota, oran, içerik): stop + oda yayını. Hata fırlatmaz. */
  private async stopBySelf(e: { tenantId: string; rid: string; sessionId: string }, reason: RecStopReason, code?: RecStopErrorCode) {
    try {
      const r = await this.stop({ tenantId: e.tenantId, rid: e.rid, reason, ...(code ? { code } : {}), actor: { kind: "system" } });
      if (r.changed) this.room?.stopped(e.sessionId, reason, this.now());
    } catch (err) {
      this.d.log.error({ err, ref: newId(), sessionId: e.sessionId }, "kayıt durdurulamadı");
    }
  }

  async sweepOrphans(live: ReadonlySet<string>): Promise<number> {
    const rows = await this.d.db.sessionRecording.findMany({
      where: { state: "ACTIVE" },
      select: { id: true, tenantId: true, sessionId: true },
    });
    let n = 0;
    for (const r of rows) {
      if (live.has(r.sessionId)) continue;
      const out = await this.stop({ tenantId: r.tenantId, rid: r.id, reason: "error", code: "orphan", actor: { kind: "system" } });
      if (out.changed) n++;
    }
    return n;
  }

  // ------------------------------------------------------------------------------------------------ belirteçler

  issueUploadToken(i: RecIssueUploadInput): string {
    return this.tokens.issue({ kind: "recUpload", ...i });
  }

  dropUploadTokens(scope: RecTokenDropScope): void {
    const match = (e: RecTokenEntry): boolean => {
      if (e.kind !== "recUpload") return false;
      switch (scope.by) {
        case "rid":
          return e.rid === scope.rid;
        case "conn":
          return e.connId === scope.connId;
        case "session":
          return e.sessionId === scope.sessionId;
        case "authSession":
          return e.authSessionId === scope.authSessionId;
        case "user":
          return e.userId === scope.userId;
        case "tenant":
          return e.tenantId === scope.tenantId;
      }
    };
    const grace = "graceMs" in scope ? scope.graceMs : undefined;
    if (grace === undefined || grace <= 0) {
      this.tokens.drop(match);
      return;
    }
    // Pay sonrası yalnız ŞU AN eşleşenler düşer (pay içinde verilen yeni belirteç — yeni bölüm — etkilenmez).
    const victims = this.tokens.find(match);
    this.d.clock.setTimeout(() => {
      for (const e of victims) this.tokens.remove(e);
    }, grace);
  }

  // ------------------------------------------------------------------------------------------------ parça kabulü (§5.1)

  private async decide(db: Db | Tx, rec: repo.RecRow, r: PartRequest, size: number): Promise<PartDecision> {
    const [last, exists] = await Promise.all([
      repo.lastSeries(db, rec.id, rec.tenantId),
      repo.partExists(db, rec.id, rec.tenantId, r.s, r.p),
    ]);
    return decidePart({
      rec,
      room: this.room?.get(rec.sessionId),
      last,
      exists,
      s: r.s,
      p: r.p,
      durationMs: r.durationMs,
      size,
      seriesStartMs: r.seriesStartMs,
      now: this.now(),
    });
  }

  /** Durdurma gerektiren karar → stop + metrik; diğerleri yalnız metrik. */
  private async settle(r: PartRequest, out: PartOutcome): Promise<PartOutcome> {
    const e = r.entry;
    if (out.kind === "quota") await this.stopBySelf(e, "quota");
    else if (out.kind === "rate") await this.stopBySelf(e, "error", "rate");
    else if (out.kind === "invalid") await this.stopBySelf(e, "error", "invalid");
    const result = out.kind === "gone" ? out.result : RESULT_OF[out.kind];
    if (result) this.d.metrics.inc(REC_METRICS.PART_TOTAL, { result });
    return out;
  }

  /** `preParsing` ön denetimi (kilitsiz; gövde okunmadan). null → devam. */
  async precheck(r: PartRequest, contentLength: number): Promise<PartOutcome | null> {
    const rec = await repo.findById(this.d.db, r.entry.rid);
    if (!rec || rec.tenantId !== r.entry.tenantId || rec.sessionId !== r.entry.sessionId)
      return this.settle(r, { kind: "gone", result: "gone" });
    const d = await this.decide(this.d.db, rec, r, contentLength);
    if (d.kind === "dup") return null; // idempotent yanıt TX yolunda (yazmaz)
    if (d.kind !== "accept") return this.settle(r, d);
    if (!(await this.capacityOk(this.d.db, rec.tenantId, contentLength))) return this.settle(r, { kind: "quota" });
    return null;
  }

  /** Gövde bellekte: içerik denetimi → şifreli `.rsf` → TX (kilit, kesin denetim, INSERT). Ret → dosya silinir. */
  async acceptPart(r: PartRequest, body: Buffer): Promise<PartOutcome> {
    const e = r.entry;
    const content = r.p === 0 ? checkWebmHeader(body) : checkWebmContinuation(body);
    const rel = this.d.store.newRel(e.tenantId);
    const fid = newId();
    const keyVer = this.d.secrets.currentVersion;
    let written = false;
    try {
      const dup = await repo.partExists(this.d.db, e.rid, e.tenantId, r.s, r.p);
      if (!dup && !content.ok) {
        this.d.log.warn(
          { event: "rec_part_invalid", reason: content.ok ? "" : content.reason, sessionId: e.sessionId },
          "kayıt parçası reddedildi",
        );
        return await this.settle(r, { kind: "invalid" });
      }
      if (!dup) {
        await this.writeBox(rel, keyVer, e.tenantId, fid, body);
        written = true;
      }
      const out = await this.d.db.$transaction(async (tx): Promise<PartOutcome> => {
        const [rec] = await repo.lockTenantRecording(tx, e.tenantId, [e.rid]);
        if (!rec || rec.sessionId !== e.sessionId) return { kind: "gone", result: "gone" };
        const d = await this.decide(tx, rec, r, body.length);
        if (d.kind !== "accept") return d;
        if (!(await this.capacityOk(tx, e.tenantId, body.length))) return { kind: "quota" };
        await repo.insertPart(
          tx,
          {
            id: fid,
            recordingId: rec.id,
            tenantId: rec.tenantId,
            seriesNo: r.s,
            partNo: r.p,
            offsetMs: d.offsetMs,
            durationMs: r.durationMs,
            sizeBytes: body.length,
            storageRel: rel,
            keyVer,
          },
          e.userId,
        );
        return { kind: "ok", next: d.next };
      });
      if (out.kind === "ok") {
        written = false; // satıra bağlandı
        this.room?.partAccepted(e.sessionId, r.s, r.p, this.now());
        this.d.metrics.inc(REC_METRICS.BYTES_TOTAL, {}, body.length);
        this.d.metrics.observe(REC_METRICS.PART_BYTES, body.length); // §11.2 histogram
      }
      return await this.settle(r, out);
    } finally {
      if (written) await this.d.store.remove(rel).catch(() => undefined);
    }
  }

  /** P28b biçimi: tek `.rsf`, 1 MiB'lik yükleme parçaları ardışık (`chunkOffset`), `fsync` + `rename`. */
  private async writeBox(rel: string, keyVer: number, tenantId: string, fid: string, body: Buffer): Promise<void> {
    const salt = randomBytes(32);
    const header = makeHeader(keyVer, body.length, salt);
    const key = this.d.secrets.deriveFileKey(keyVer, salt, tenantId, fid);
    const sealed: Buffer[] = [];
    for (let n = 0; n * FSRV_CHUNK_BYTES < body.length; n++)
      sealed.push(sealChunk(key, header, body.length, n, body.subarray(n * FSRV_CHUNK_BYTES, (n + 1) * FSRV_CHUNK_BYTES)));
    await this.d.store.createPart(rel, header);
    await this.d.store.writePart(rel, chunkOffset(0), Buffer.concat(sealed));
    await this.d.store.commit(rel);
  }

  /** Parçanın düz metni (≤ 2 MiB; bellekte, segment doğrulamalı). */
  async readPart(p: { storageRel: string; keyVer: number; sizeBytes: number; id: string }, tenantId: string): Promise<Buffer> {
    const fh = await this.d.store.open(p.storageRel);
    try {
      const out: Buffer[] = [];
      for await (const seg of openBox(fh, { keys: this.d.secrets, keyVer: p.keyVer, plainSize: p.sizeBytes, tenantId, fid: p.id }))
        out.push(seg);
      return Buffer.concat(out);
    } finally {
      await fh.close();
    }
  }
}
