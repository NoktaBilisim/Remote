// P19 müşteri CSV içe aktarma (AC-263; mimari-e11 §8c.5; S-P19-4, 8, 14). Önizleme: UTF-8 (fatal) → `parseCsv` (≤ 5 000
// satır, kayıt ≤ 8 KB) → başlık eşleme (`foldKey`) → hücre formül kaçışı tersi → MEVCUT müşteri zod şemaları → sınıf
// (create / conflict / error; dosyada tekrar = error). Sonuç bellekte (kullanıcı başına 1, 15 dk, `previewId` 128 bit,
// kullanıcı + tenant'a bağlı). Uygulama: tenant kilidi → önizleme tüketimi → çakışma YENİDEN hesaplanır → 500'lük partiler,
// parti başına TX: customers `createMany` (INSERT IGNORE; yarışta eklenen ad → skipped) → request_refs → satır audit'i;
// güncelleme yalnız alanlar (ref/durum değişmez, anonim atlanır). Özet audit `customer.imported`.
import {
  CUSTOMER_CSV_COLUMNS,
  CUSTOMER_IMPORT_ERRORS_MAX,
  CUSTOMER_IMPORT_FIELD,
  CUSTOMER_IMPORT_MAX_BYTES,
  CUSTOMER_IMPORT_MAX_RECORD_CHARS,
  CUSTOMER_IMPORT_MAX_ROWS,
  CUSTOMER_IMPORT_MESSAGES,
  CUSTOMER_IMPORT_PREVIEW_ROWS,
  CUSTOMER_IMPORT_PREVIEW_TTL_MS,
  contactNameSchema,
  customerFirmNameSchema,
  customerKeys,
  customerNoteSchema,
  customerSlaMinutesSchema,
  fileLabelSchema,
  foldKey,
  optionalEmailNullable,
  optionalPhoneSchema,
  suggestFileLabel,
  type CustomerCsvColumn,
  type ImportCommitInput,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportResult,
  type ImportRowError,
} from "@remote/contracts/api/customers";
import { REQUEST_PRIORITIES, type RequestPriority } from "@remote/contracts/api/requests";
import { CUSTOMER_AUDIT } from "@remote/contracts/audit";
import { PRIORITY_LABELS } from "@remote/contracts/labels";
import type { FastifyRequest } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { customerAuditView, type CustomerAuditFields } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import { CsvTooManyRowsError, csvUnescapeCell, parseCsv } from "../lib/csv.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newTenantRef } from "../lib/ids.ts";
import { ensureSettings } from "../requests/panel.ts";
import type { RequestService } from "../requests/service.ts";
import * as repo from "./repo.ts";
import { withTxRetry } from "./service.ts";

const ENTITY = "customer";
const BATCH = 500;
const ENVELOPE_SLACK = 16 * 1024;

// ------------------------------------------------------------------ dosya okuma

const fileError = (message: string): AppError => new AppError("VALIDATION", { message, fields: { [CUSTOMER_IMPORT_FIELD]: message } });
const tooLarge = (message: string): AppError => new AppError("PAYLOAD_TOO_LARGE", { message });

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
    if (err instanceof AppError) throw err;
    const code = typeof err === "object" && err !== null ? String((err as { code?: unknown }).code ?? "") : "";
    if (code === "FST_REQ_FILE_TOO_LARGE" || code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT")
      throw tooLarge(CUSTOMER_IMPORT_MESSAGES.tooLarge);
    throw fileError(CUSTOMER_IMPORT_MESSAGES.noFile);
  }
  if (data.length === 0) throw fileError(CUSTOMER_IMPORT_MESSAGES.noFile);
  return data;
}

// ------------------------------------------------------------------ önizleme deposu (S-P19-4)

type Field = "name" | "contactName" | "phone" | "email" | "note" | "fileLabel" | "defaultPriority" | "slaMinutes";

interface ParsedRow {
  line: number;
  name: string;
  nameKey: string;
  /** Dosyada sütunu olan alanlar (boş hücre = null; `fileLabel` boşsa yok — boşaltılamaz). */
  data: Partial<Record<Exclude<Field, "name">, string | number | null>>;
}

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

// ------------------------------------------------------------------ hücre doğrulama

const COLUMN_FIELD: Readonly<Partial<Record<CustomerCsvColumn, Field>>> = {
  Ad: "name",
  "Yetkili kişi": "contactName",
  Telefon: "phone",
  "E-posta": "email",
  Not: "note",
  "Dosya etiketi": "fileLabel",
  "Varsayılan öncelik": "defaultPriority",
  "SLA (dk)": "slaMinutes",
};
const FIELD_COLUMN = Object.fromEntries(Object.entries(COLUMN_FIELD).map(([c, f]) => [f, c])) as Record<Field, CustomerCsvColumn>;
const COLUMN_BY_KEY = new Map(CUSTOMER_CSV_COLUMNS.map((c) => [foldKey(c), c]));
const PRIORITY_BY_KEY = new Map<string, RequestPriority>(
  REQUEST_PRIORITIES.flatMap((p) => [
    [foldKey(p), p],
    [foldKey(PRIORITY_LABELS[p]), p],
  ]),
);
const PRIORITY_INVALID = `Öncelik ${REQUEST_PRIORITIES.map((p) => PRIORITY_LABELS[p]).join(", ")} ya da boş olmalı`;

type Check = { ok: true; value: string | number | null } | { ok: false; message: string };

function viaSchema(schema: z.ZodType<string | number | null>, v: string | number | null): Check {
  const r = schema.safeParse(v);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: r.error.issues[0]?.message ?? "Geçersiz değer" };
}

function checkField(f: Exclude<Field, "name">, raw: string): Check {
  const v = raw.trim();
  switch (f) {
    case "contactName":
      return viaSchema(contactNameSchema, raw);
    case "phone":
      return viaSchema(optionalPhoneSchema, raw);
    case "email":
      return viaSchema(optionalEmailNullable, raw);
    case "note":
      return viaSchema(customerNoteSchema, raw);
    case "fileLabel":
      return v === "" ? { ok: true, value: null } : viaSchema(fileLabelSchema, v);
    case "defaultPriority": {
      if (v === "") return { ok: true, value: null };
      const p = PRIORITY_BY_KEY.get(foldKey(v));
      return p ? { ok: true, value: p } : { ok: false, message: PRIORITY_INVALID };
    }
    case "slaMinutes":
      if (v === "") return { ok: true, value: null };
      if (!/^\d{1,6}$/.test(v)) return { ok: false, message: "Tam sayı olmalı" };
      return viaSchema(customerSlaMinutesSchema, Number(v));
  }
}

// ------------------------------------------------------------------ önizleme

export async function previewImport(
  svc: RequestService,
  store: ImportPreviewStore,
  auth: AuthContext,
  tenantId: string,
  file: Buffer,
): Promise<ImportPreview> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    throw fileError(CUSTOMER_IMPORT_MESSAGES.notUtf8);
  }
  let parsed;
  try {
    parsed = parseCsv(text, { maxRows: CUSTOMER_IMPORT_MAX_ROWS, maxRecordChars: CUSTOMER_IMPORT_MAX_RECORD_CHARS });
  } catch (err) {
    if (err instanceof CsvTooManyRowsError) throw tooLarge(CUSTOMER_IMPORT_MESSAGES.tooManyRows);
    throw err;
  }

  // Başlık eşleme: harf/Türkçe duyarsız; bilinmeyen/tekrarlı sütun uyarı; `Durum` yok sayılır.
  const warnings: string[] = [];
  const colIndex = new Map<Field, number>();
  for (const [i, rawHead] of (parsed.header?.cells ?? []).entries()) {
    const head = csvUnescapeCell(rawHead).trim();
    if (head === "") continue;
    const col = COLUMN_BY_KEY.get(foldKey(head));
    const f = col ? COLUMN_FIELD[col] : undefined;
    if (!col) warnings.push(`Bilinmeyen sütun yok sayıldı: “${[...head].slice(0, 40).join("")}”`);
    else if (!f) warnings.push("“Durum” sütunu içe aktarmada kullanılmaz (yeni müşteriler Aktif eklenir).");
    else if (colIndex.has(f)) warnings.push(`“${col}” sütunu birden fazla; ilki kullanıldı.`);
    else colIndex.set(f, i);
  }
  if (!colIndex.has("name")) throw fileError(CUSTOMER_IMPORT_MESSAGES.noNameColumn);
  const total = parsed.records.length + parsed.errors.length;
  if (total === 0) throw fileError(CUSTOMER_IMPORT_MESSAGES.empty);

  const existing = await repo.nameKeyIndex(svc.d.db, tenantId);
  const errors: ImportRowError[] = parsed.errors.map((e) => ({ line: e.line, column: null, message: e.message }));
  const allRows: ImportPreviewRow[] = parsed.errors.map((e) => ({
    line: e.line,
    kind: "error",
    name: "",
    contactName: null,
    phone: null,
    email: null,
  }));
  const valid: ParsedRow[] = [];
  const seen = new Map<string, number>();
  const counts = { create: 0, conflict: 0, error: parsed.errors.length };

  for (const rec of parsed.records) {
    const cell = (f: Field): string | undefined => {
      const i = colIndex.get(f);
      return i === undefined ? undefined : csvUnescapeCell(rec.cells[i] ?? "");
    };
    const rowErrors: ImportRowError[] = [];
    const rawName = cell("name") ?? "";
    const nameCheck = rawName.trim() === "" ? ({ ok: false, message: "Ad zorunlu" } as const) : viaSchema(customerFirmNameSchema, rawName);
    if (!nameCheck.ok) rowErrors.push({ line: rec.line, column: "Ad", message: nameCheck.message });
    const data: ParsedRow["data"] = {};
    for (const f of ["contactName", "phone", "email", "note", "fileLabel", "defaultPriority", "slaMinutes"] as const) {
      const raw = cell(f);
      if (raw === undefined) continue;
      const c = checkField(f, raw);
      if (!c.ok) rowErrors.push({ line: rec.line, column: FIELD_COLUMN[f], message: c.message });
      else if (!(f === "fileLabel" && c.value === null)) data[f] = c.value;
    }
    const name = nameCheck.ok ? String(nameCheck.value) : rawName.trim();
    const nameKey = nameCheck.ok ? customerKeys(name, null, null).nameKey : "";
    if (nameCheck.ok) {
      const first = seen.get(nameKey);
      if (first !== undefined) rowErrors.push({ line: rec.line, column: null, message: `Bu ad dosyada ${first}. satırda da var` });
      else seen.set(nameKey, rec.line);
    }
    const kind = rowErrors.length > 0 ? "error" : existing.has(nameKey) ? "conflict" : "create";
    counts[kind]++;
    errors.push(...rowErrors);
    const str = (v: string | number | null | undefined): string | null => (typeof v === "string" ? v : null);
    allRows.push({
      line: rec.line,
      kind,
      name: [...name].slice(0, 100).join(""),
      contactName: str(data.contactName),
      phone: str(data.phone),
      email: str(data.email),
    });
    if (kind !== "error") valid.push({ line: rec.line, name, nameKey, data });
  }
  allRows.sort((a, b) => a.line - b.line);
  errors.sort((a, b) => a.line - b.line);
  const previewId = store.put(auth.user.id, { tenantId, total, failed: counts.error, rows: valid });
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

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const UPDATABLE = ["name", "contactName", "phone", "email", "note", "fileLabel", "defaultPriority", "slaMinutes"] as const;

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
    const existing = await repo.nameKeyIndex(svc.d.db, tenantId); // önizleme sayıları tahmin; burada yeniden
    const creates: ParsedRow[] = [];
    const updates: { id: string; row: ParsedRow }[] = [];
    for (const r of p.rows) {
      const id = existing.get(r.nameKey);
      if (id === undefined) creates.push(r);
      else if (input.onConflict === "update") updates.push({ id, row: r });
      else res.skipped++;
    }
    for (const part of chunks(creates, BATCH)) {
      const ids = part.map(() => newId());
      const n = await withTxRetry(() =>
        svc.d.db.$transaction(async (tx) => {
          const now = new Date(svc.d.clock.now());
          const data = part.map((r, k) => {
            const contactName = (r.data.contactName as string | null | undefined) ?? null;
            const phone = (r.data.phone as string | null | undefined) ?? null;
            return {
              id: ids[k] as string,
              tenantId,
              name: r.name,
              ...customerKeys(r.name, contactName, phone),
              fileLabel: (r.data.fileLabel as string | undefined) ?? suggestFileLabel(r.name),
              requestRef: newTenantRef(),
              contactName,
              phone,
              email: (r.data.email as string | null | undefined) ?? null,
              note: (r.data.note as string | null | undefined) ?? null,
              defaultPriority: (r.data.defaultPriority as string | null | undefined) ?? null,
              slaMinutes: (r.data.slaMinutes as number | null | undefined) ?? null,
              status: "ACTIVE",
              createdBy: auth.user.id,
              createdAt: now,
            };
          });
          // INSERT IGNORE: arada aynı adla eklenen müşteri (UQ tenant_id,name_key) → satır atlanır, parti geri alınmaz.
          await tx.customer.createMany({ data, skipDuplicates: true });
          const got = new Set((await repo.findMany(tx, tenantId, ids)).map((c) => c.id));
          const ok = data.filter((d) => got.has(d.id));
          if (ok.length > 0)
            await tx.requestRef.createMany({ data: ok.map((d) => ({ ref: d.requestRef, tenantId, customerId: d.id, createdAt: now })) });
          for (const d of ok)
            await writeAudit(tx, ctx, {
              ...who,
              action: CUSTOMER_AUDIT.CREATED,
              entity: ENTITY,
              entityId: d.id,
              result: "success",
              newValue: {
                ...customerAuditView({
                  name: d.name,
                  fileLabel: d.fileLabel,
                  refPrefix: d.requestRef,
                  ...(d.defaultPriority ? { defaultPriority: d.defaultPriority } : {}),
                  ...(d.slaMinutes ? { slaMinutes: d.slaMinutes } : {}),
                }),
                source: "import",
              },
            });
          return ok.length;
        }),
      );
      res.created += n;
      res.skipped += part.length - n;
    }
    for (const part of chunks(updates, BATCH)) {
      const { updated, skipped } = await svc.d.db.$transaction(async (tx) => {
        const cur = new Map(
          (
            await repo.findMany(
              tx,
              tenantId,
              part.map((u) => u.id),
            )
          ).map((c) => [c.id, c]),
        );
        let u = 0;
        let s = 0;
        for (const { id, row } of part) {
          const c = cur.get(id);
          if (!c || c.anonymizedAt) {
            s++; // anonim müşteri atlanır (AC-195)
            continue;
          }
          const next: Record<(typeof UPDATABLE)[number], string | number | null> = {
            name: row.name,
            contactName: c.contactName,
            phone: c.phone,
            email: c.email,
            note: c.note,
            fileLabel: c.fileLabel,
            defaultPriority: c.defaultPriority,
            slaMinutes: c.slaMinutes,
          };
          for (const [f, v] of Object.entries(row.data)) next[f as keyof typeof row.data] = v;
          const changed = UPDATABLE.filter((f) => next[f] !== c[f]);
          if (changed.length === 0) {
            s++;
            continue;
          }
          const n = await repo.update(
            tx,
            tenantId,
            id,
            {
              ...Object.fromEntries(changed.map((f) => [f, next[f]])),
              ...customerKeys(String(next.name), next.contactName as string | null, next.phone as string | null),
            },
            { anonymizedAt: null },
          );
          if (n === 0) {
            s++;
            continue;
          }
          const pick = (src: CustomerAuditFields): CustomerAuditFields =>
            Object.fromEntries(changed.map((f) => [f, src[f]])) as CustomerAuditFields;
          await writeAudit(tx, ctx, {
            ...who,
            action: CUSTOMER_AUDIT.UPDATED,
            entity: ENTITY,
            entityId: id,
            result: "success",
            oldValue: customerAuditView(pick(c as CustomerAuditFields)),
            newValue: { changed: [...changed], ...customerAuditView(pick(next as CustomerAuditFields)), source: "import" },
          });
          u++;
        }
        return { updated: u, skipped: s };
      });
      res.updated += updated;
      res.skipped += skipped;
    }
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
