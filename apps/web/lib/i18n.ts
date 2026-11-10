import tr from "@/messages/tr.json";

// Basit çeviri yardımcısı (tasarim-kontrol §5: kütüphane yok). İngilizce "Sonra".
export type MessageKey = keyof typeof tr;

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return tr[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
