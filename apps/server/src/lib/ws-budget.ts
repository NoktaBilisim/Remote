// S-P22-1 (mimari-p22 r2 §15.1): WS geçmiş çerçevesi bayt bütçesi — tek yardımcı, iki kullanım (`chat.history`,
// P18 `request.messages`). Go istemci okuma sınırı 64 KiB; çerçeve (zarf dahil) `maxBytes`'ı aşmaz.

/**
 * En yeni öğeden geriye ekler; serileştirilmiş çerçeve (`JSON.stringify(frame(kept, more))`, UTF-8) ≤ `maxBytes` olana dek.
 * `items` artan sıradadır, dönen `items` da artan. `more` = sığmayan (atlanan) öğe var. Tek öğe bile sığmazsa boş dizi.
 */
export function fitNewest<T>(
  items: readonly T[],
  frame: (kept: T[], more: boolean) => unknown,
  maxBytes: number,
): { items: T[]; more: boolean } {
  const size = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), "utf8");
  // Zarf payı: boş dizili çerçevenin en büyüğü (`more` true/false uzunluğu farklı).
  const envelope = Math.max(size(frame([], true)), size(frame([], false)));
  let total = envelope;
  let start = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    const cost = size(items[i]) + (i === items.length - 1 ? 0 : 1); // virgül
    if (total + cost > maxBytes) break;
    total += cost;
    start = i;
  }
  const kept = items.slice(start);
  // Savunma: dizi elemanı serileştirmesi tek başına ölçülenden farklıysa (ör. toJSON) gerçek çerçeveyle doğrula.
  while (kept.length > 0 && size(frame(kept, true)) > maxBytes) kept.shift();
  return { items: kept, more: kept.length < items.length };
}
