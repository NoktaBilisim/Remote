// P28e kayıt izleme (mimari-p28e r2 §5 `POST …/recording/view` + `GET /rec/…/parts/:p`, §5.4, §11.1; AC-385, S-P28e-3, T4–T6).
// İzleme belirteci `authSessionId`'ye bağlı, kullanıcı + kayıt başına tek etkin (yeni POST eskisini `replaced` ile düşürür).
// Kayan süre: her GET `idleUntil = now + REC_VIEW_IDLE_MS`; `maxUntil = min(now + durationMs + 30 dk, now + 8 sa)`. Düşen her
// belirteç için `recording.view.end{partsServed, bytesServed, throttled, endReason}` (süpürücü 60 sn). Çekiş bütçesi kovası
// `userId + rid` anahtarında; belirteç değişince sıfırlanmaz.
import { RECORDING_AUDIT } from "@remote/contracts/audit";
import { REC_VIEW_IDLE_MS, REC_VIEW_MAX_EXTRA_MS, REC_VIEW_MAX_MS, type RecViewEndReason } from "@remote/contracts/ws-rec";
import type { RecordingViewResponse } from "@remote/contracts/api/recording";
import type { AuditContext } from "../audit/service.ts";
import { newId } from "../lib/ids.ts";
import { ViewBuckets } from "./limits.ts";
import type { RecServiceImpl } from "./service.ts";
import type { RecViewTokenEntry } from "./types.ts";

export const VIEW_SWEEP_MS = 60_000;

export interface ViewActor {
  userId: string;
  username: string;
  authSessionId: string;
  ctx: AuditContext;
}

export type ServeResult = { kind: "ok"; body: Buffer } | { kind: "notFound" } | { kind: "throttled"; retryAfterSec: number };

export class RecViews {
  private readonly svc: RecServiceImpl;
  readonly buckets = new ViewBuckets();
  /** `view.end` satırının aktörü (belirteci açan kullanıcı). */
  private readonly owners = new WeakMap<RecViewTokenEntry, ViewActor>();

  constructor(svc: RecServiceImpl) {
    this.svc = svc;
  }

  private now(): number {
    return this.svc.d.clock.now();
  }

  /** Belirteci düşürür ve özet satırını yazar (hata fırlatmaz). */
  async end(e: RecViewTokenEntry, reason: RecViewEndReason): Promise<void> {
    if (!this.svc.tokens.remove(e)) return;
    const a = this.owners.get(e);
    try {
      await this.svc.audit(
        this.svc.d.db,
        e,
        a ? { kind: "user", userId: a.userId, username: a.username, ctx: a.ctx } : { kind: "system" },
        RECORDING_AUDIT.VIEW_END,
        true,
        { recordingId: e.rid, partsServed: e.partsServed, bytesServed: e.bytesServed, throttled: e.throttled, endReason: reason },
      );
    } catch (err) {
      this.svc.d.log.error({ err, ref: newId() }, "recording.view.end yazılamadı");
    }
  }

  /** `POST /view` (kapsam + yetki rotada): önceki belirteç `replaced`, yeni belirteç + audit `recording.view`. */
  async open(rec: { id: string; tenantId: string; sessionId: string; durationMs: number }, a: ViewActor): Promise<RecordingViewResponse> {
    const old = this.svc.tokens.find((e) => e.kind === "recView" && e.userId === a.userId && e.rid === rec.id);
    for (const e of old) if (e.kind === "recView") await this.end(e, "replaced");
    const now = this.now();
    const maxUntil = Math.min(now + rec.durationMs + REC_VIEW_MAX_EXTRA_MS, now + REC_VIEW_MAX_MS);
    const entry: RecViewTokenEntry = {
      kind: "recView",
      rid: rec.id,
      sessionId: rec.sessionId,
      tenantId: rec.tenantId,
      userId: a.userId,
      authSessionId: a.authSessionId,
      idleUntil: now + REC_VIEW_IDLE_MS,
      maxUntil,
      partsServed: 0,
      bytesServed: 0,
      throttled: 0,
    };
    const token = this.svc.tokens.issue(entry);
    this.owners.set(entry, a);
    await this.svc.audit(
      this.svc.d.db,
      rec,
      { kind: "user", userId: a.userId, username: a.username, ctx: a.ctx },
      RECORDING_AUDIT.VIEW,
      true,
      {
        recordingId: rec.id,
      },
    );
    return { token, idleTtlMs: REC_VIEW_IDLE_MS, maxUntil: new Date(maxUntil).toISOString() };
  }

  /**
   * Parça GET: süre → `allowed()` (kullanıcı/oturum/yetki/kapsam yeniden; düşmüşse `logout`/`revoked`) → bütçe → parça.
   * `allowed` dönüşü: "ok" | "logout" | "revoked".
   */
  async serve(e: RecViewTokenEntry, s: number, p: number, allowed: () => Promise<"ok" | "logout" | "revoked">): Promise<ServeResult> {
    const now = this.now();
    const expired: RecViewEndReason | null = now > e.maxUntil ? "max" : now > e.idleUntil ? "idle" : null;
    const ok = expired ?? (await allowed());
    if (ok !== "ok") {
      await this.end(e, ok);
      return { kind: "notFound" };
    }
    const wait = this.buckets.take(`${e.userId}:${e.rid}`, now);
    if (wait > 0) {
      e.throttled++;
      return { kind: "throttled", retryAfterSec: wait };
    }
    const part = await this.svc.d.db.sessionRecordingPart.findUnique({
      where: { recordingId_tenantId_seriesNo_partNo: { recordingId: e.rid, tenantId: e.tenantId, seriesNo: s, partNo: p } },
      select: { id: true, storageRel: true, keyVer: true, sizeBytes: true },
    });
    if (!part) return { kind: "notFound" };
    const body = await this.svc.readPart(part, e.tenantId);
    e.idleUntil = this.now() + REC_VIEW_IDLE_MS;
    e.partsServed++;
    e.bytesServed += body.length;
    return { kind: "ok", body };
  }

  /** Süpürücü: süresi dolan izleme belirteçleri (`idle`/`max`). */
  async sweep(): Promise<number> {
    const now = this.now();
    const due = this.svc.tokens.find((e) => e.kind === "recView" && (now > e.idleUntil || now > e.maxUntil));
    for (const e of due) if (e.kind === "recView") await this.end(e, now > e.maxUntil ? "max" : "idle");
    return due.length;
  }

  /** Kayıt silindi: izleme belirteçleri `revoked`. */
  async dropRecording(rid: string): Promise<void> {
    for (const e of this.svc.tokens.find((x) => x.kind === "recView" && x.rid === rid))
      if (e.kind === "recView") await this.end(e, "revoked");
  }
}
