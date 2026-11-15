/*
 * P19 (AC-263; mimari-e11 §8c.5): müşteri CSV içe aktarma — istemci tarafı yardımcılar. Ayrıştırma ve doğrulama
 * sunucuda (tek kaynak); burada yalnız dosya ön denetimi, hata raporu CSV'si ve API hata → ekran eşlemesi var.
 */
import { CSV_BOM, csvRow } from "@remote/contracts/csv";
import { CUSTOMER_IMPORT_MAX_BYTES, CUSTOMER_IMPORT_MESSAGES, type ImportRowError } from "@remote/contracts/api/customers";
import { ApiError } from "@/lib/api";

export const IMPORT_ACCEPT = ".csv,text/csv";

/** Yükleme öncesi istemci denetimi (sunucu yine denetler): boş/eksik dosya, > 2 MB, uzantı. */
export function checkImportFile(f: File | null | undefined): string | null {
  if (!f || f.size === 0) return CUSTOMER_IMPORT_MESSAGES.noFile;
  if (f.size > CUSTOMER_IMPORT_MAX_BYTES) return CUSTOMER_IMPORT_MESSAGES.tooLarge;
  if (!/\.csv$/i.test(f.name)) return "Yalnız .csv dosyası yüklenebilir.";
  return null;
}

/** Hata raporu: BOM + `Satır;Sütun;Hata` başlığı, CRLF; hücreler formül kaçışlı (`csvRow`). */
export function errorReportCsv(errors: readonly ImportRowError[]): string {
  const lines = [csvRow(["Satır", "Sütun", "Hata"]), ...errors.map((e) => csvRow([String(e.line), e.column ?? "", e.message]))];
  return CSV_BOM + lines.join(""); // csvRow her satırı CRLF ile bitirir
}

type ImportFailure =
  | { kind: "field"; message: string }
  | { kind: "previewExpired"; message: string }
  | { kind: "busy"; message: string }
  | { kind: "other"; message: string };

/** Önizleme/uygulama hatası → ekran: 400 `fields.file`/413 dosya alanına, 428 adım 1'e dönüş, 409 "sürüyor". */
export function importFailure(e: unknown, fallback: string): ImportFailure {
  if (!(e instanceof ApiError)) return { kind: "other", message: fallback };
  if (e.status === 428) return { kind: "previewExpired", message: CUSTOMER_IMPORT_MESSAGES.previewRequired };
  if (e.status === 409) return { kind: "busy", message: e.message || CUSTOMER_IMPORT_MESSAGES.busy };
  if (e.status === 413) return { kind: "field", message: e.message || CUSTOMER_IMPORT_MESSAGES.tooLarge };
  if (e.status === 400 && e.fields?.file) return { kind: "field", message: e.fields.file };
  return { kind: "other", message: e.message || fallback };
}
