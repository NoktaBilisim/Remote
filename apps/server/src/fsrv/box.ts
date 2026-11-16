// P28b saklanan dosya biçimi (mimari-p28b §6, K-P28b-2; AC-356). Dosya başına HKDF anahtarı (`SecretBox.deriveFileKey`),
// 64 KiB segmentli AES-256-GCM. Başlık 52 B = "RSF1" | key_ver(1) | 0(3) | segBytes u32 BE | plainSize u64 BE | salt(32);
// segmentler `ciphertext (≤ 64 KiB) | tag(16)`. Nonce = 0×7 | segIndex u32 BE | lastFlag(1); AAD = başlığın tamamı →
// kesme, yeniden sıralama, başka dosyaya taşıma ve sürüm uyuşmazlığı çözümde yakalanır. Düz metin diske yazılmaz.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { FSRV_CHUNK_BYTES, FSRV_SEGMENT_BYTES } from "@remote/contracts/ws-fsrv";

export const RSF_MAGIC = "RSF1";
export const RSF_HEADER_BYTES = 52;
const TAG_BYTES = 16;
const SEG_CT_BYTES = FSRV_SEGMENT_BYTES + TAG_BYTES;
const SEGS_PER_CHUNK = FSRV_CHUNK_BYTES / FSRV_SEGMENT_BYTES;

/** Dosya anahtarı türetici (`SecretBox.deriveFileKey` dar arayüzü). */
export interface FileKeys {
  deriveFileKey(ver: number, salt: Uint8Array, tenantId: string, fid: string): Buffer;
}

/** Bozuk / değiştirilmiş / yanlış satıra ait dosya — çağıran `CORRUPT` sayar. */
export class BoxError extends Error {}

export const segmentCount = (plainSize: number): number => Math.ceil(plainSize / FSRV_SEGMENT_BYTES);
/** Şifreli dosyanın toplam boyutu. */
export const boxSize = (plainSize: number): number => RSF_HEADER_BYTES + plainSize + segmentCount(plainSize) * TAG_BYTES;
/** `n`. yükleme parçasının şifreli dosyadaki ofseti (parça = 16 tam segment). */
export const chunkOffset = (n: number): number => RSF_HEADER_BYTES + n * SEGS_PER_CHUNK * SEG_CT_BYTES;

export function makeHeader(keyVer: number, plainSize: number, salt: Buffer = randomBytes(32)): Buffer {
  const h = Buffer.alloc(RSF_HEADER_BYTES);
  h.write(RSF_MAGIC, 0, "ascii");
  h.writeUInt8(keyVer, 4);
  h.writeUInt32BE(FSRV_SEGMENT_BYTES, 8);
  h.writeBigUInt64BE(BigInt(plainSize), 12);
  salt.copy(h, 20);
  return h;
}

interface ParsedHeader {
  keyVer: number;
  plainSize: number;
  salt: Buffer;
}

export function parseHeader(h: Buffer): ParsedHeader {
  if (h.length !== RSF_HEADER_BYTES || h.toString("ascii", 0, 4) !== RSF_MAGIC) throw new BoxError("başlık geçersiz");
  if (h.readUInt8(5) !== 0 || h.readUInt16BE(6) !== 0 || h.readUInt32BE(8) !== FSRV_SEGMENT_BYTES) throw new BoxError("başlık geçersiz");
  const size = h.readBigUInt64BE(12);
  if (size < 1n || size > BigInt(Number.MAX_SAFE_INTEGER)) throw new BoxError("başlık geçersiz");
  return { keyVer: h.readUInt8(4), plainSize: Number(size), salt: Buffer.from(h.subarray(20, 52)) };
}

function nonce(index: number, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  n.writeUInt32BE(index, 7);
  n.writeUInt8(last ? 1 : 0, 11);
  return n;
}

/**
 * `n`. yükleme parçasını (son parça hariç tam 1 MiB) şifreli segmentlere çevirir; dönen tampon `chunkOffset(n)`'e yazılır
 * (konumlu yazım — tekrar gönderilen parça aynı baytları üretmez ama aynı yere yazılır; idempotentlik çağıranda).
 */
export function sealChunk(key: Buffer, header: Buffer, plainSize: number, n: number, plain: Buffer): Buffer {
  const total = segmentCount(plainSize);
  const out: Buffer[] = [];
  for (let off = 0, i = n * SEGS_PER_CHUNK; off < plain.length; off += FSRV_SEGMENT_BYTES, i++) {
    const c = createCipheriv("aes-256-gcm", key, nonce(i, i === total - 1));
    c.setAAD(header);
    out.push(c.update(plain.subarray(off, off + FSRV_SEGMENT_BYTES)), c.final(), c.getAuthTag());
  }
  return Buffer.concat(out);
}

/** Satır bağlamı: başlıktaki sürüm ve boyut DB ile aynı olmalı (aksi `BoxError`). */
export interface BoxContext {
  keys: FileKeys;
  keyVer: number;
  plainSize: number;
  tenantId: string;
  fid: string;
}

export async function readHeaderKey(fh: FileHandle, ctx: BoxContext): Promise<{ header: Buffer; key: Buffer }> {
  const header = Buffer.alloc(RSF_HEADER_BYTES);
  const { bytesRead } = await fh.read(header, 0, RSF_HEADER_BYTES, 0);
  if (bytesRead !== RSF_HEADER_BYTES) throw new BoxError("başlık kısa");
  const p = parseHeader(header);
  if (p.keyVer !== ctx.keyVer || p.plainSize !== ctx.plainSize) throw new BoxError("başlık satırla uyuşmuyor");
  try {
    return { header, key: ctx.keys.deriveFileKey(p.keyVer, p.salt, ctx.tenantId, ctx.fid) };
  } catch {
    throw new BoxError("anahtar sürümü yok");
  }
}

/**
 * Segment segment doğrula-sonra-ver (§6 Okuma). Doğrulanmayan segmentte `BoxError` fırlatır — akış kesilir, alıcı boyut/SHA
 * uyuşmazlığıyla `CORRUPT` görür. Bellekte yalnız bir segment.
 */
export async function* openBox(fh: FileHandle, ctx: BoxContext): AsyncGenerator<Buffer> {
  const { header, key } = await readHeaderKey(fh, ctx);
  const total = segmentCount(ctx.plainSize);
  const buf = Buffer.alloc(SEG_CT_BYTES);
  let pos = RSF_HEADER_BYTES;
  for (let i = 0; i < total; i++) {
    const plainLen = i === total - 1 ? ctx.plainSize - i * FSRV_SEGMENT_BYTES : FSRV_SEGMENT_BYTES;
    const want = plainLen + TAG_BYTES;
    const { bytesRead } = await fh.read(buf, 0, want, pos);
    if (bytesRead !== want) throw new BoxError("segment kısa");
    pos += want;
    const d = createDecipheriv("aes-256-gcm", key, nonce(i, i === total - 1));
    d.setAAD(header);
    d.setAuthTag(buf.subarray(plainLen, want));
    let plain: Buffer;
    try {
      plain = Buffer.concat([d.update(buf.subarray(0, plainLen)), d.final()]);
    } catch {
      throw new BoxError("segment doğrulanamadı");
    }
    yield plain;
  }
  const extra = await fh.read(Buffer.alloc(1), 0, 1, pos);
  if (extra.bytesRead !== 0) throw new BoxError("dosya sonunda fazla bayt");
}
