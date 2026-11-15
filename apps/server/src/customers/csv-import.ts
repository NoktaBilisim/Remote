// P19 müşteri CSV içe aktarma (AC-263; mimari-e11 §8c.5; S-P19-4, 8, 14). Önizleme: UTF-8 (fatal) → `parseCsv` (≤ 5 000
// satır, kayıt ≤ 8 KB) → başlık eşleme (`foldKey`) → hücre formül kaçışı tersi → MEVCUT müşteri zod şemaları → sınıf
// (create / conflict / error; dosyada tekrar = error). Sonuç bellekte (kullanıcı başına 1, 15 dk, `previewId` 128 bit,
// kullanıcı + tenant'a bağlı). Uygulama: tenant kilidi → önizleme tüketimi → çakışma YENİDEN hesaplanır → 500'lük partiler,
// parti başına TX: customers `createMany` (INSERT IGNORE; yarışta eklenen ad → skipped) → request_refs → satır audit'i;
// güncelleme yalnız alanlar (ref/durum değişmez, anonim atlanır). Özet audit `customer.imported`.
import {
  CUSTOMER_IMPORT_ERRORS_MAX,
  CUSTOMER_IMPORT_FIELD,
  CUSTOMER_IMPORT_MAX_BYTES,
  CUSTOMER_IMPORT_MAX_RECORD_CHARS,
  CUSTOMER_IMPORT_MAX_ROWS,
  CUSTOMER_IMPORT_MESSAGES,
  CUSTOMER_IMPORT_PREVIEW_ROWS,
  CUSTOMER_IMPORT_PREVIEW_TTL_MS,
  type ImportCommitInput,
  type ImportPreview,
  type ImportResult,
} from "@remote/contracts/api/customers";
import { CUSTOMER_AUDIT } from "@remote/contracts/audit";
import type { FastifyRequest } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { CsvTooManyRowsError, parseCsv } from "../lib/csv.ts";
import { AppError } from "../lib/errors.ts";
import { ensureSettings } from "../requests/panel.ts";
import type { RequestService } from "../requests/service.ts";
import { applyCreates, applyUpdates } from "./import-apply.ts";
import { addRecord, mapHeader, type ParsedRow, type PreviewAcc } from "./import-rows.ts";
import * as repo from "./repo.ts";

const ENTITY = "customer";
const ENVELOPE_SLACK = 16 * 1024;

// ------------------------------------------------------------------ dosya okuma

const fileError = (message: string): AppError => new AppError("VALIDATION", { message, fields: { [CUSTOMER_IMPORT_FIELD]: message } });
const tooLarge = (message: string): AppError => new AppError("PAYLOAD_TOO_LARGE", { message });

/** multipart okuma hatası → zarf: AppError aynen, sınır aşımı 413, diğerleri "dosya yok". */
function uploadError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const code = typeof err === "object" && err !== null ? String((err as { code?: unknown }).code ?? "") : "";
  if (code === "FST_REQ_FILE_TOO_LARGE" || code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT")
    return tooLarge(CUSTOMER_IMPORT_MESSAGES.tooLarge);
  return fileError(CUSTOMER_IMPORT_MESSAGES.noFile);
}

/** multipart tek dosya `file` ≤ 2 MB (aşım 413). Dosya adı ve bildirilen MIME kullanılmaz. */
export async function readCsvUpload(req: FastifyRequest): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > CUSTOMER_IMPORT_MAX_BYTES + ENVELOPE_SLACK) throw tooLarge(CUSTOMER_IMPORT_MESSAGES.tooLarge);
  if (!req.isMultipart()) throw fileError(CUSTOMER_IMPORT_MESSAGES.noFile);
  let data: Buffer;
  try {
    const part = await req.file({ limits: { fileSize: CUSTOMER_IMPORT_MAX_BYTES, files: 1, fields: 0, parts: 1 } });
    if (!part || part.fieldname !== CUSTOMER_IMPORT_FIELD) {
      part?.file.resume();
      throw fileError(CUSTOMER_IMPORT_MESSAGES.noFile);
    }
    data = await part.toBuffer();
  } catch (err) {
    throw uploadError(err);
  }
  if (data.length === 0) throw fileError(CUSTOMER_IMPORT_MESSAGES.noFile);
  return data;
}

// ------------------------------------------------------------------ önizleme deposu (S-P19-4)

interface StoredPreview {
  id: string;
  tenantId: string;
  expiresAt: number;
  total: number;
  failed: number;
  rows: ParsedRow[];
}

/** Kullanıcı başına tek önizleme (yenisi eskisini ezer); süresi dolanlar her yazımda temizlenir. */
export class ImportPreviewStore {
  private readonly m = new Map<string, StoredPreview>();
  private readonly now: () => number;
  constructor(now: () => number) {
    this.now = now;
  }
  put(userId: string, p: Omit<StoredPreview, "id" | "expiresAt">): string {
    const t = this.now();
    for (const [k, v] of this.m) if (v.expiresAt <= t) this.m.delete(k);
    const id = randomBytes(16).toString("base64url");
    this.m.set(userId, { ...p, id, expiresAt: t + CUSTOMER_IMPORT_PREVIEW_TTL_MS });
    return id;
  }
  /** Tek kullanımlık: eşleşirse silinip döner; yok/süresi dolmuş/başka tenant/yanlış id → null. */
  take(userId: string, tenantId: string, previewId: string): StoredPreview | null {
    const p = this.m.get(userId);
    if (!p) return null;
    if (p.expiresAt <= this.now()) {
      this.m.delete(userId);
      return null;
    }
    const a = Buffer.from(p.id);
    const b = Buffer.from(previewId);
    if (a.length !== b.length || !timingSafeEqual(a, b) || p.tenantId !== tenantId) return null;
    this.m.delete(userId);
    return p;
  }
}

// ------------------------------------------------------------------ önizleme

/** UTF-8 (fatal) çözme + `parseCsv` (≤ 5 000 satır, kayıt ≤ 8 KB). */
function parseUpload(file: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    throw fileError(CUSTOMER_IMPORT_MESSAGES.notUtf8);
  }
  try {
    return parseCsv(text, { maxRows: CUSTOMER_IMPORT_MAX_ROWS, maxRecordChars: CUSTOMER_IMPORT_MAX_RECORD_CHARS });
  } catch (err) {
    if (err instanceof CsvTooManyRowsError) throw tooLarge(CUSTOMER_IMPORT_MESSAGES.tooManyRows);
    throw err;
  }
}

export async function previewImport(
  svc: RequestService,
  store: ImportPreviewStore,
  auth: AuthContext,
  tenantId: string,
  file: Buffer,
): Promise<ImportPreview> {
  const parsed = parseUpload(file);
  const { colIndex, warnings } = mapHeader(parsed.header?.cells ?? []);
  if (!colIndex.has("name")) throw fileError(CUSTOMER_IMPORT_MESSAGES.noNameColumn);
  const total = parsed.records.length + parsed.errors.length;
  if (total === 0) throw fileError(CUSTOMER_IMPORT_MESSAGES.empty);

  const existing = await repo.nameKeyIndex(svc.d.db, tenantId);
  const acc: PreviewAcc = {
    errors: parsed.errors.map((e) => ({ line: e.line, column: null, message: e.message })),
    allRows: parsed.errors.map((e) => ({ line: e.line, kind: "error", name: "", contactName: null, phone: null, email: null })),
    valid: [],
    seen: new Map<string, number>(),
    counts: { create: 0, conflict: 0, error: parsed.errors.length },
  };
  for (const rec of parsed.records) addRecord(acc, rec, colIndex, existing);
  const { errors, allRows, counts } = acc;
  allRows.sort((a, b) => a.line - b.line);
  errors.sort((a, b) => a.line - b.line);
  const previewId = store.put(auth.user.id, { tenantId, total, failed: counts.error, rows: acc.valid });
  return {
    previewId,
    total,
    counts,
    rows: allRows.slice(0, CUSTOMER_IMPORT_PREVIEW_ROWS),
    errors: errors.slice(0, CUSTOMER_IMPORT_ERRORS_MAX),
    errorsTruncated: errors.length > CUSTOMER_IMPORT_ERRORS_MAX,
    warnings,
  };
}

// ------------------------------------------------------------------ uygulama

/** Önizleme sayıları tahmin; çakışma burada YENİDEN hesaplanır. `skip` çakışmalar doğrudan `res.skipped`'e. */
async function planImport(
  svc: RequestService,
  tenantId: string,
  rows: ParsedRow[],
  onConflict: ImportCommitInput["onConflict"],
  res: ImportResult,
) {
  const existing = await repo.nameKeyIndex(svc.d.db, tenantId); // önizleme sayıları tahmin; burada yeniden
  const creates: ParsedRow[] = [];
  const updates: { id: string; row: ParsedRow }[] = [];
  for (const r of rows) {
    const id = existing.get(r.nameKey);
    if (id === undefined) creates.push(r);
    else if (onConflict === "update") updates.push({ id, row: r });
    else res.skipped++;
  }
  return { creates, updates };
}

export async function commitImport(
  svc: RequestService,
  store: ImportPreviewStore,
  locks: Set<string>,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: ImportCommitInput,
): Promise<ImportResult> {
  // S-P19-14: güncelleme ayrıca Düzenle ister (gövde okunduktan sonra; mevcut 403 zarfı).
  if (input.onConflict === "update" && !auth.permissions.has("customers.edit")) throw new AppError("FORBIDDEN");
  if (locks.has(tenantId)) throw new AppError("CONFLICT", { message: CUSTOMER_IMPORT_MESSAGES.busy });
  const p = store.take(auth.user.id, tenantId, input.previewId);
  if (!p) throw new AppError("PREVIEW_REQUIRED", { message: CUSTOMER_IMPORT_MESSAGES.previewRequired });
  locks.add(tenantId);
  const who = { tenantId, userId: auth.user.id, username: auth.user.email };
  const res: ImportResult = { total: p.total, created: 0, updated: 0, skipped: 0, failed: p.failed };
  let outcome: "success" | "fail" = "success";
  try {
    await ensureSettings(svc, tenantId);
    const { creates, updates } = await planImport(svc, tenantId, p.rows, input.onConflict, res);
    await applyCreates(svc, { ctx, who }, creates, res);
    await applyUpdates(svc, { ctx, who }, updates, res);
    return res;
  } catch (err) {
    outcome = "fail";
    throw err;
  } finally {
    locks.delete(tenantId);
    if (res.created > 0) svc.refreshCustomersGauge();
    await writeAudit(svc.d.db, ctx, {
      ...who,
      action: CUSTOMER_AUDIT.IMPORTED,
      entity: ENTITY,
      result: outcome,
      newValue: { ...res, onConflict: input.onConflict },
    });
  }
}
