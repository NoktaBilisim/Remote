/*
 * `file` DataChannel parça pompası — dosya gönderimi (P5, file-send.ts) ve uzaktan yazdırma (P28a, lib/print/print-send.ts)
 * ortak çerçeveleme + akış kontrolü: `fidIndex(uint16) | seq(uint32) | payload ≤ 16 KB`, `bufferedAmount` yüksekse
 * `bufferedamountlow` beklenir. `idx` çağıranın verdiği teklif sırasıdır (dosya + yazdırma ortak sayaç, O-P28a-2).
 */
import { encodeFileChunk, FILE_BUFFERED_MAX as BUFFER_HIGH, FILE_CHUNK_MAX_PAYLOAD as CHUNK_BYTES } from "@remote/contracts/dc";
import type { FileChannelLike } from "./file-model";

function waitLow(ch: FileChannelLike): Promise<void> {
  return new Promise((res) => {
    const fn = () => {
      ch.removeEventListener("bufferedamountlow", fn);
      res();
    };
    ch.addEventListener("bufferedamountlow", fn);
  });
}

export interface PumpOptions {
  /** true → pompa durur (iptal / kanal kapandı). */
  aborted: () => boolean;
  onProgress: (done: number) => void;
  /** Yalnız e2e: parça başına gecikme (ms). */
  delayMs?: () => number;
}

/** Blob'u parça parça gönderir; tamamı gittiyse true, iptal / kanal kapanışıyla durduysa false. */
export async function pumpChunks(ch: FileChannelLike, idx: number, blob: Blob, o: PumpOptions): Promise<boolean> {
  let seq = 0;
  for (let off = 0; off < blob.size; off += CHUNK_BYTES) {
    if (o.aborted() || ch.readyState !== "open") return false;
    if (ch.bufferedAmount > BUFFER_HIGH) await waitLow(ch);
    const delay = o.delayMs?.() ?? 0;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (o.aborted() || ch.readyState !== "open") return false;
    const part = new Uint8Array(await blob.slice(off, off + CHUNK_BYTES).arrayBuffer());
    ch.send(encodeFileChunk(idx, seq++, part) as Uint8Array<ArrayBuffer>);
    o.onProgress(Math.min(off + part.byteLength, blob.size));
  }
  return !o.aborted();
}
