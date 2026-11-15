/*
 * P28a pano parçalama (mimari-p28 §4.4, AC-345; K-P28a-14): UTF-8 baytları 8 KB parçalar hâlinde standart base64 (dolgulu)
 * `clip.data`. Dönüşüm yok (NFC/CRLF yok) — gidiş-dönüş birebir. Alıcı: `seq` ardışık, toplam ≤ 64 KB, `last` sonrası
 * UTF-8 geçerliliği ve U+0000 yokluğu (aksi `INVALID` / `TOO_LARGE`). İçerik hiçbir zaman loglanmaz / DOM'a basılmaz.
 */
import { CLIP_CHUNK_BYTES, CLIP_MAX_BYTES, CLIP_MAX_CHUNKS } from "@remote/contracts/ws-clip-print";

/** UTF-8 bayt sayısı (64 KB sınırı karakter değil bayt üzerinden, AC-345). */
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export function bytesToB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode(...b.subarray(i, i + 0x2000));
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export interface ClipChunk {
  seq: number;
  last: boolean;
  b64: string;
}

/** Baytlar → `clip.data` parçaları (en çok 8). Boş veya > 64 KB → null (gönderilmez). */
export function splitClip(bytes: Uint8Array): ClipChunk[] | null {
  if (bytes.length === 0 || bytes.length > CLIP_MAX_BYTES) return null;
  const out: ClipChunk[] = [];
  for (let off = 0, seq = 0; off < bytes.length; off += CLIP_CHUNK_BYTES, seq++) {
    out.push({ seq, last: off + CLIP_CHUNK_BYTES >= bytes.length, b64: bytesToB64(bytes.subarray(off, off + CLIP_CHUNK_BYTES)) });
  }
  return out;
}

export type AssembleResult = { kind: "more" } | { kind: "done"; text: string } | { kind: "error"; result: "INVALID" | "TOO_LARGE" };

/** Gelen `clip.data` parçalarını birleştirir (tek cid için; bir kez `done`/`error` döndükten sonra kullanılmaz). */
export class ClipAssembler {
  private parts: Uint8Array[] = [];
  private total = 0;

  push(c: ClipChunk): AssembleResult {
    if (c.seq !== this.parts.length || c.seq >= CLIP_MAX_CHUNKS) return this.fail("INVALID");
    const b = b64ToBytes(c.b64);
    if (!b || b.length === 0 || b.length > CLIP_CHUNK_BYTES) return this.fail("INVALID");
    this.total += b.length;
    if (this.total > CLIP_MAX_BYTES) return this.fail("TOO_LARGE");
    this.parts.push(b);
    if (!c.last) return { kind: "more" };
    const all = new Uint8Array(this.total);
    let off = 0;
    for (const p of this.parts) {
      all.set(p, off);
      off += p.length;
    }
    this.parts = [];
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(all);
    } catch {
      return this.fail("INVALID");
    }
    all.fill(0);
    if (text.includes("\u0000")) return this.fail("INVALID");
    return { kind: "done", text };
  }

  private fail(result: "INVALID" | "TOO_LARGE"): AssembleResult {
    for (const p of this.parts) p.fill(0);
    this.parts = [];
    return { kind: "error", result };
  }
}

/** `cid` / `pid`: 16 bayt rastgele base64url (22 karakter, `CLIP_PRINT_ID_PATTERN`). */
export const newCpId = (): string =>
  bytesToB64(crypto.getRandomValues(new Uint8Array(16)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
