/*
 * P28b sunucu modu indirme (mimari-p28b §4, §9; AC-356): `GET /api/v1/fsrv/files/:fid/content`, kimlik yalnız
 * `Authorization: Bearer <indirme belirteci>` (≤ 5 dk; URL'de asla, çerez yok). Akış `ReadableStream` ile okunur, ALINAN BAYT
 * beyan edilen boyutu aşarsa kesilir; SHA-256 artımlı hesaplanır ve teklifteki özetle karşılaştırılır (doğrulanmadan dosya
 * verilmez). Hedef mevcut bellek sink'i (`lib/dc/file-disk.ts`; sunucu modu tavanı 256 MiB < disk eşiği).
 * Geçmişten indirme (`fetchBlob`) özet bilmez: yalnız boyut sınırı + Blob.
 */
import { API_BASE } from "../api";
import { memorySink, type Sink } from "../dc/file-disk";
import { Sha256 } from "../dc/sha256";

export type DownloadResult = { kind: "ok"; url?: string } | { kind: "corrupt" } | { kind: "failed" } | { kind: "aborted" };

export const contentPath = (fid: string) => `${API_BASE}/fsrv/files/${encodeURIComponent(fid)}/content`;

async function open(fid: string, token: string, f: typeof fetch, signal?: AbortSignal): Promise<Response | null> {
  try {
    const res = await f(contentPath(fid), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    return res.ok && res.body ? res : null;
  } catch {
    return null;
  }
}

/** Akışı `sink`'e yazar; `max` aşılırsa ya da akış koparsa null, aksi alınan bayt sayısı. */
async function pump(res: Response, sink: Sink, hash: Sha256 | null, max: number, onProgress?: (n: number) => void): Promise<number | null> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return got;
      got += value.byteLength;
      if (got > max) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      sink.write(value);
      hash?.update(value);
      onProgress?.(got);
    }
  } catch {
    return null;
  }
}

export interface DownloadOptions {
  fid: string;
  token: string;
  size: number;
  sha256: string;
  onProgress?: (received: number) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Ağ kopmasında aynı belirteçle en çok bu kadar deneme (belirteç 5 dk içinde yeniden kullanılabilir). */
  attempts?: number;
  sink?: () => Sink;
}

/** Teklif edilen dosyayı indirir ve SHA-256 doğrular. */
export async function downloadVerified(o: DownloadOptions): Promise<DownloadResult> {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const tries = o.attempts ?? 3;
  for (let i = 0; i < tries; i++) {
    if (o.signal?.aborted) return { kind: "aborted" };
    const res = await open(o.fid, o.token, f, o.signal);
    if (!res) continue;
    const sink = (o.sink ?? memorySink)();
    const hash = new Sha256();
    const got = await pump(res, sink, hash, o.size, o.onProgress);
    if (o.signal?.aborted) {
      sink.discard();
      return { kind: "aborted" };
    }
    if (got === null) {
      sink.discard();
      continue;
    }
    const ok = got === o.size && hash.hex() === o.sha256;
    const r = await sink.finish(ok);
    return ok && r.ok ? { kind: "ok", ...(r.url ? { url: r.url } : {}) } : { kind: "corrupt" };
  }
  return { kind: "failed" };
}

/** Oturum geçmişinden indirme: içerik Blob olarak döner (çağıran `a[download]` ile kaydeder). */
export async function fetchBlob(fid: string, token: string, max: number, f: typeof fetch = (...a) => fetch(...a)): Promise<Blob | null> {
  const res = await open(fid, token, f);
  if (!res) return null;
  const parts: Uint8Array[] = [];
  const sink: Sink = {
    write: (u) => void parts.push(u.slice()),
    finish: (ok) => Promise.resolve({ ok }),
    discard: () => void (parts.length = 0),
  };
  const got = await pump(res, sink, null, max);
  if (got === null) return null;
  // S-P5-5 kalıbı: tür açıkça octet-stream (blob: adresi yeni sekmede HTML/SVG olarak çizilmez)
  return new Blob(parts as BlobPart[], { type: "application/octet-stream" });
}
