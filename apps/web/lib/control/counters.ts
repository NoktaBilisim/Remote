/** Sekme deposundan geri yüklenen sayaç değerlerinin doğrulaması (bozuk değer 0/null olur; TEST-P7-3). */
export const num = (v: unknown, max: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
export const ts = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
/** İki zamandan büyük olanı (yarışta geri sayım/hak geri gitmez). */
export const later = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));
