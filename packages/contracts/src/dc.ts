// DataChannel temel sözleşmesi (docs/mimari-protokol.md §4). P4 yalnız temel zarfı ve kanal adlarını tanımlar;
// ctl mesaj tipleri (chat, annot.*, file.*) P5'te `ctlMessageSchema`'ya eklenir. DC'de `control.*` tipi YOKTUR
// (kontrol isteği yalnız WS'den); strict şema bilinmeyen tipi/alanı reddeder (G-09).
import { z } from "zod";

/** Teknisyen offer'da açar. `input` yalnız AGENT; BROWSER misafir bu kanalı kabul etmez/kapatır. */
export const DC_LABELS = { CTL: "ctl", FILE: "file", INPUT: "input" } as const;
export type DcLabel = (typeof DC_LABELS)[keyof typeof DC_LABELS];

/** `ctl` kanalında tek JSON mesajı üst sınırı (UTF-8 bayt). */
export const DC_CTL_MAX_BYTES = 16 * 1024;

/** Her DC JSON mesajının ortak zarfı: `{ t, id? }` (WS ile aynı kalıp). */
export const dcEnvelopeSchema = z.object({ t: z.string().min(1).max(32), id: z.string().max(26).optional() });
export type DcEnvelope = z.infer<typeof dcEnvelopeSchema>;

/** UTF-8 bayt uzunluğu (ortam bağımsız: lib'de TextEncoder/Buffer yok). */
function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Ham `ctl` çerçevesini zarf olarak doğrular; boyut aşımı, ikili veri, geçersiz JSON veya zarfsız nesne → null
 * (alıcı mesajı düşürür). Tipe özgü doğrulama P5 şemalarıyla yapılır.
 */
export function parseDcEnvelope(raw: unknown): DcEnvelope | null {
  if (typeof raw !== "string" || utf8Bytes(raw) > DC_CTL_MAX_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = dcEnvelopeSchema.safeParse(json);
  return r.success ? r.data : null;
}
