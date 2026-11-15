// Müşteri CSV içe aktarma satır işleme (customers/csv-import.ts önizlemesi): başlık eşleme (`foldKey`), hücre formül
// kaçışı tersi, MEVCUT müşteri zod şemalarıyla alan doğrulama ve satır sınıfı (create / conflict / error; dosyada tekrar =
// error).
import {
  CUSTOMER_CSV_COLUMNS,
  contactNameSchema,
  customerFirmNameSchema,
  customerKeys,
  customerNoteSchema,
  customerSlaMinutesSchema,
  fileLabelSchema,
  foldKey,
  optionalEmailNullable,
  optionalPhoneSchema,
  type CustomerCsvColumn,
  type ImportPreviewRow,
  type ImportRowError,
} from "@remote/contracts/api/customers";
import { REQUEST_PRIORITIES, type RequestPriority } from "@remote/contracts/api/requests";
import { PRIORITY_LABELS } from "@remote/contracts/labels";
import type { z } from "zod";
import { csvUnescapeCell } from "../lib/csv.ts";

export type Field = "name" | "contactName" | "phone" | "email" | "note" | "fileLabel" | "defaultPriority" | "slaMinutes";

export interface ParsedRow {
  line: number;
  name: string;
  nameKey: string;
  /** Dosyada sütunu olan alanlar (boş hücre = null; `fileLabel` boşsa yok — boşaltılamaz). */
  data: Partial<Record<Exclude<Field, "name">, string | number | null>>;
}

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

/** Başlık eşleme: harf/Türkçe duyarsız; bilinmeyen/tekrarlı sütun uyarı; `Durum` yok sayılır. */
export function mapHeader(cells: string[]): { colIndex: Map<Field, number>; warnings: string[] } {
  const warnings: string[] = [];
  const colIndex = new Map<Field, number>();
  for (const [i, rawHead] of cells.entries()) {
    const head = csvUnescapeCell(rawHead).trim();
    if (head === "") continue;
    const col = COLUMN_BY_KEY.get(foldKey(head));
    const f = col ? COLUMN_FIELD[col] : undefined;
    if (!col) warnings.push(`Bilinmeyen sütun yok sayıldı: “${[...head].slice(0, 40).join("")}”`);
    else if (!f) warnings.push("“Durum” sütunu içe aktarmada kullanılmaz (yeni müşteriler Aktif eklenir).");
    else if (colIndex.has(f)) warnings.push(`“${col}” sütunu birden fazla; ilki kullanıldı.`);
    else colIndex.set(f, i);
  }
  return { colIndex, warnings };
}

/** Önizleme birikimi: hatalar, tüm satırlar, geçerli satırlar, dosya içi ad tekrarı ve sınıf sayaçları. */
export interface PreviewAcc {
  errors: ImportRowError[];
  allRows: ImportPreviewRow[];
  valid: ParsedRow[];
  seen: Map<string, number>;
  counts: { create: number; conflict: number; error: number };
}

const str = (v: string | number | null | undefined): string | null => (typeof v === "string" ? v : null);

/** Ad dışındaki alanlar: sütunu olanlar doğrulanır; boş `fileLabel` veriye girmez (boşaltılamaz). */
function readFields(line: number, cell: (f: Field) => string | undefined, rowErrors: ImportRowError[]): ParsedRow["data"] {
  const data: ParsedRow["data"] = {};
  for (const f of ["contactName", "phone", "email", "note", "fileLabel", "defaultPriority", "slaMinutes"] as const) {
    const raw = cell(f);
    if (raw === undefined) continue;
    const c = checkField(f, raw);
    if (!c.ok) rowErrors.push({ line, column: FIELD_COLUMN[f], message: c.message });
    else if (!(f === "fileLabel" && c.value === null)) data[f] = c.value;
  }
  return data;
}

/** Tek veri kaydını doğrular, sınıflandırır ve birikime ekler. */
export function addRecord(
  acc: PreviewAcc,
  rec: { line: number; cells: string[] },
  colIndex: Map<Field, number>,
  existing: Map<string, string>,
): void {
  const cell = (f: Field): string | undefined => {
    const i = colIndex.get(f);
    return i === undefined ? undefined : csvUnescapeCell(rec.cells[i] ?? "");
  };
  const rowErrors: ImportRowError[] = [];
  const rawName = cell("name") ?? "";
  const nameCheck = rawName.trim() === "" ? ({ ok: false, message: "Ad zorunlu" } as const) : viaSchema(customerFirmNameSchema, rawName);
  if (!nameCheck.ok) rowErrors.push({ line: rec.line, column: "Ad", message: nameCheck.message });
  const data = readFields(rec.line, cell, rowErrors);
  const name = nameCheck.ok ? String(nameCheck.value) : rawName.trim();
  const nameKey = nameCheck.ok ? customerKeys(name, null, null).nameKey : "";
  if (nameCheck.ok) {
    const first = acc.seen.get(nameKey);
    if (first !== undefined) rowErrors.push({ line: rec.line, column: null, message: `Bu ad dosyada ${first}. satırda da var` });
    else acc.seen.set(nameKey, rec.line);
  }
  const kind = rowErrors.length > 0 ? "error" : existing.has(nameKey) ? "conflict" : "create";
  acc.counts[kind]++;
  acc.errors.push(...rowErrors);
  acc.allRows.push({
    line: rec.line,
    kind,
    name: [...name].slice(0, 100).join(""),
    contactName: str(data.contactName),
    phone: str(data.phone),
    email: str(data.email),
  });
  if (kind !== "error") acc.valid.push({ line: rec.line, name, nameKey, data });
}
