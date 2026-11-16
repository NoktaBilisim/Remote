/*
 * P28b sunucu modu yükleme (mimari-p28b §4, §9; K-P28b-4): dosya `File.slice` ile 1 MiB parçalara bölünür ve SIRAYLA
 * `PUT /api/v1/fsrv/uploads/:fid/chunks/:n` ile gönderilir. Kimlik yalnız `Authorization: Bearer <yükleme belirteci>`
 * başlığında; URL'de asla (Caddy yol loglar). Çerez gönderilmez (`credentials: "omit"`).
 * Yanıtlar: 200 `{next}` → sıradaki parça `next` (n < next → idempotent); 202 → son parça alındı, tarama başladı;
 * 409 `{next}` → sunucunun beklediği parçadan devam (kopmada kaldığı yerden); 409 `STORAGE_QUOTA` zarfı → kota;
 * 404/400/401 → kalıcı hata. Ağ hatası ve 5xx/429 → aynı parça en çok 3 kez yeniden denenir (artan bekleme).
 */
import { FSRV_CHUNK_BYTES, fsrvChunkCount } from "@remote/contracts/ws-fsrv";
import { API_BASE } from "../api";

export type UploadResult = "ok" | "quota" | "failed" | "aborted";

export interface UploadOptions {
  fid: string;
  token: string;
  file: Blob;
  /** Gönderilen bayt (ilerleme). */
  onProgress?: (sent: number) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Yeniden deneme bekleme (ms); testte 0. */
  retryDelayMs?: (attempt: number) => number;
}

/** Parça başına en çok deneme (ilk + 3 yeniden). */
export const UPLOAD_RETRIES = 3;
const defaultDelay = (attempt: number) => 500 * 2 ** attempt;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(id), resolve()), { once: true });
  });

/** Yükleme ucunun yolu (yalnız kimlikler; belirteç yolda YOK). */
export const chunkPath = (fid: string, n: number) => `${API_BASE}/fsrv/uploads/${encodeURIComponent(fid)}/chunks/${n}`;

async function readNext(res: Response): Promise<number | null> {
  const body: unknown = await res.json().catch(() => null);
  if (body && typeof body === "object" && "next" in body && Number.isInteger((body as { next: unknown }).next))
    return (body as { next: number }).next;
  return null;
}
async function isQuota(res: Response): Promise<boolean> {
  const body: unknown = await res.json().catch(() => null);
  return Boolean(body && typeof body === "object" && (body as { error?: { code?: string } }).error?.code === "STORAGE_QUOTA");
}

type Step = { kind: "next"; next: number } | { kind: "done" } | { kind: "retry" } | { kind: "fatal"; result: UploadResult };

async function putChunk(o: UploadOptions, n: number, f: typeof fetch): Promise<Step> {
  const start = n * FSRV_CHUNK_BYTES;
  const body = o.file.slice(start, Math.min(start + FSRV_CHUNK_BYTES, o.file.size));
  let res: Response;
  try {
    res = await f(chunkPath(o.fid, n), {
      method: "PUT",
      headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/octet-stream" },
      body,
      credentials: "omit",
      cache: "no-store",
      signal: o.signal,
    });
  } catch {
    return o.signal?.aborted ? { kind: "fatal", result: "aborted" } : { kind: "retry" };
  }
  if (res.status === 202) return { kind: "done" };
  if (res.status === 200) {
    const next = await readNext(res);
    return next === null ? { kind: "retry" } : { kind: "next", next };
  }
  if (res.status === 409) {
    // Gövde zarf değilse `{next}`: sunucunun beklediği parçadan devam; zarfsa kota/disk
    const copy = res.clone();
    const next = await readNext(res);
    if (next !== null) return { kind: "next", next };
    return { kind: "fatal", result: (await isQuota(copy)) ? "quota" : "failed" };
  }
  if (res.status === 429 || res.status >= 500) return { kind: "retry" };
  return { kind: "fatal", result: "failed" };
}

/** Parçaları sırayla gönderir; `next` sunucudan gelir (tekrarlanan/atlanan parça yok). */
export async function uploadChunks(o: UploadOptions): Promise<UploadResult> {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const delay = o.retryDelayMs ?? defaultDelay;
  const count = fsrvChunkCount(o.file.size);
  let n = 0;
  let failures = 0;
  while (n < count) {
    if (o.signal?.aborted) return "aborted";
    const step = await putChunk(o, n, f);
    if (step.kind === "fatal") return step.result;
    if (step.kind === "done") {
      o.onProgress?.(o.file.size);
      return "ok";
    }
    if (step.kind === "retry") {
      if (failures >= UPLOAD_RETRIES) return "failed";
      await sleep(delay(failures++), o.signal);
      continue;
    }
    failures = 0;
    // Sunucu aralık dışı `next` dönerse güvenli yön: başarısız say (sonsuz döngü yok)
    if (step.next < 0 || step.next > count) return "failed";
    n = step.next;
    o.onProgress?.(Math.min(n * FSRV_CHUNK_BYTES, o.file.size));
  }
  // Sunucu `next = count` dedi: tüm parçalar alınmış (202 yanıtı kopmada kaybolmuş olabilir) — tarama sonucu WS'ten gelir
  return "ok";
}
