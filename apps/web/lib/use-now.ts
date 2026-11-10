"use client";

import { useEffect, useState } from "react";

/**
 * Geri sayımlar için "şimdi" (ms); her `intervalMs`'de günceller. Sunucu çiziminde ve ilk
 * hidrasyonda null (saat farkı hidrasyon uyuşmazlığı üretmesin); bağlandıktan hemen sonra dolar.
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

/** Panoya kopyala; başarısızsa false (izin yok / güvenli bağlam değil). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
