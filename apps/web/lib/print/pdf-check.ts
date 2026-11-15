/*
 * P28a yazdırma belge denetimi (mimari-p28 §4.5, AC-348): yalnız ilk 5 baytı `%PDF-` olan ve en çok 20 MB (20 971 520
 * bayt) dosya gönderilir. Uzantı / MIME türüne bakılmaz (içerik). Asıl doğrulama misafirde (bayt sayısı + SHA-256 + önek).
 */
import { PDF_MAGIC, PRINT_MAX_BYTES, PRINT_MIN_BYTES } from "@remote/contracts/ws-clip-print";

export type PdfCheck = "ok" | "notPdf" | "tooLarge";

export async function checkPdf(file: Blob): Promise<PdfCheck> {
  if (file.size < PRINT_MIN_BYTES) return "notPdf";
  const head = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer());
  for (let i = 0; i < PDF_MAGIC.length; i++) if (head[i] !== PDF_MAGIC.charCodeAt(i)) return "notPdf";
  return file.size > PRINT_MAX_BYTES ? "tooLarge" : "ok";
}
